// What has to be true about the reader's place in the book as the events arrive in every order
// they can arrive in.
//
// **This layer is about ordering, and that is the whole point of it.** Whether a jump begins a
// visit is `visit.test.ts`, and whether an arriving row is worth a banner is
// `elsewhere.test.ts`; both are exhausted there and neither can see the thing that actually
// broke — *when* those questions were asked. A pull landing between the saved position and the
// first layout, a visit still standing as the next book opens, the ground covered while
// progress was being held back: each of those is a sequence, and a sequence is what a reducer
// can be handed whole.
//
// What it cannot say is that anything appeared on screen. That the banner really stands over
// the book, and that the page it names is the page frond moves to, are
// packages/app/tests/browser/reader/elsewhere.spec.ts and .../visit.spec.ts.
import { describe, expect, it } from "vitest";
import { bannerOffer, nextPlace, placeFor, type Place, type PlaceEvent } from "./place";
import type { Progress } from "./types";

const BOOK = "book-1";

// A page of a made-up book running from `/4/2` to `/4/8`, and points inside and beyond it — the
// same shapes `visit.test.ts` uses, so a case here reads against the rule it depends on.
const PAGE = "epubcfi(/6/4!/4,/2/1:0,/8/1:40)";
const ON_PAGE = "epubcfi(/6/4!/4/2/1:10)";
// A passage behind the page the reader stopped at — where a visit goes, and the only direction
// one can go: a mark further on is somewhere they have not read, and jumping to it is reading.
const BEHIND = "epubcfi(/6/2!/4/2/1:0)";
const FAR = "epubcfi(/6/4!/12/2/1:0)";
const FURTHER = "epubcfi(/6/8!/4/2/1:0)";

const progress = (over: Partial<Progress> = {}): Progress => ({
  bookId: BOOK,
  cfi: ON_PAGE,
  pageRange: PAGE,
  percentage: 0.5,
  chapterLabel: null,
  lastReadAt: 1000,
  ...over,
});

/** Replays a run of events, which is how an interleaving is stated. */
const run = (state: Place, ...events: PlaceEvent[]): Place =>
  events.reduce((now, event) => nextPlace(now, event).state, state);

/** Everything one event asked for, in the order it asked. */
const effectsOf = (state: Place, event: PlaceEvent) => nextPlace(state, event).effects;

/** A book open at the saved position, which is where most cases start. */
const reading = (saved = progress()): Place =>
  run(placeFor(BOOK), { kind: "recalled", bookId: BOOK, saved }, { kind: "ready", bookId: BOOK });

describe("opening a book", () => {
  it("keeps nothing from the book before it", () => {
    const before = run(reading(), {
      kind: "pulled",
      bookId: BOOK,
      position: progress({ cfi: FAR, pageRange: null, lastReadAt: 9000 }),
      now: 9000,
    });
    expect(before.offer).not.toBeNull();

    const after = nextPlace(before, { kind: "opened", bookId: "book-2" }).state;
    expect(after).toEqual(placeFor("book-2"));
  });

  it("opens a visit when the address names a passage the reader had not reached", () => {
    const saved = progress();
    const state = nextPlace(placeFor(BOOK), {
      kind: "recalled",
      bookId: BOOK,
      saved,
      at: { kind: "cfi", cfi: FAR },
    }).state;
    expect(state.visit).toEqual(saved);
  });

  it("opens no visit for a passage on the page the reader stopped at", () => {
    const state = nextPlace(placeFor(BOOK), {
      kind: "recalled",
      bookId: BOOK,
      saved: progress(),
      at: { kind: "cfi", cfi: ON_PAGE },
    }).state;
    expect(state.visit).toBeNull();
  });

  it.each([
    ["a chapter offset", { kind: "chars", sectionIndex: 3, characters: 40 } as const],
    ["a whole-book fraction", { kind: "fraction", fraction: 0.8 } as const],
  ])("opens no visit for %s — going to a place is reading", (_name, at) => {
    expect(
      nextPlace(placeFor(BOOK), { kind: "recalled", bookId: BOOK, saved: progress(), at }).state
        .visit,
    ).toBeNull();
  });

  it("holds the passage against the saved position, not against a later relocate", () => {
    // The layout that follows emits a `relocate` for the passage itself. Deciding the visit
    // first is what keeps that `relocate` from writing the passage over the reader's progress.
    const saved = progress();
    const state = run(
      placeFor(BOOK),
      { kind: "recalled", bookId: BOOK, saved, at: { kind: "cfi", cfi: BEHIND } },
      { kind: "ready", bookId: BOOK },
      { kind: "relocated", bookId: BOOK, position: progress({ cfi: BEHIND, pageRange: null }) },
    );
    expect(state.position).toEqual(saved);
    expect(state.visit).toEqual(saved);
  });
});

describe("a row that belongs to another book", () => {
  it.each([
    ["recalled", { kind: "recalled", bookId: "other", saved: progress() } as const],
    ["ready", { kind: "ready", bookId: "other" } as const],
    [
      "relocated",
      { kind: "relocated", bookId: "other", position: progress({ cfi: FAR }) } as const,
    ],
    [
      "pulled",
      {
        kind: "pulled",
        bookId: "other",
        position: progress({ cfi: FAR, lastReadAt: 9000 }),
        now: 9000,
      } as const,
    ],
    [
      "passageAsked",
      { kind: "passageAsked", bookId: "other", target: FAR, pageRange: PAGE } as const,
    ],
  ])("is ignored by %s", (_name, event) => {
    const state = reading();
    expect(nextPlace(state, event)).toEqual({ state, effects: [] });
  });
});

describe("reading on", () => {
  it("writes the position and reports the ground covered, in that order", () => {
    const moved = progress({ cfi: FAR, percentage: 0.6 });
    expect(
      effectsOf(reading(), { kind: "relocated", bookId: BOOK, position: moved, fraction: 0.6 }),
    ).toEqual([
      { kind: "groundCovered", fraction: 0.6 },
      { kind: "recordPosition", position: moved },
    ]);
  });

  it("writes the position with no ground covered before the whole-book index exists", () => {
    const moved = progress({ cfi: FAR });
    expect(effectsOf(reading(), { kind: "relocated", bookId: BOOK, position: moved })).toEqual([
      { kind: "recordPosition", position: moved },
    ]);
  });

  it("keeps the screen and the position on the same row", () => {
    const moved = progress({ cfi: FAR });
    const state = nextPlace(reading(), { kind: "relocated", bookId: BOOK, position: moved }).state;
    expect(state.screen).toBe(state.position);
  });
});

describe("during a visit", () => {
  const visiting = (): Place =>
    run(reading(), { kind: "passageAsked", bookId: BOOK, target: BEHIND, pageRange: PAGE });

  it("moves the screen and leaves the position where the reader had read", () => {
    const saved = progress();
    const state = nextPlace(visiting(), {
      kind: "relocated",
      bookId: BOOK,
      position: progress({ cfi: BEHIND, pageRange: null, percentage: 0.1 }),
    }).state;
    expect(state.position).toEqual(saved);
    expect(state.screen?.cfi).toBe(BEHIND);
  });

  it("writes nothing at all while it holds", () => {
    expect(
      effectsOf(visiting(), {
        kind: "relocated",
        bookId: BOOK,
        position: progress({ cfi: BEHIND, pageRange: null, percentage: 0.1 }),
        fraction: 0.1,
      }),
    ).toEqual([]);
  });

  it("ends once the reader has read past what they had reached", () => {
    const past = progress({ cfi: FURTHER, pageRange: null, percentage: 0.9 });
    const step = nextPlace(visiting(), {
      kind: "relocated",
      bookId: BOOK,
      position: past,
      fraction: 0.9,
    });
    expect(step.state.visit).toBeNull();
    expect(step.effects).toEqual([
      { kind: "groundCovered", fraction: 0.9 },
      { kind: "recordPosition", position: past },
    ]);
  });

  it("stays open for a second passage", () => {
    const saved = progress();
    const state = run(visiting(), {
      kind: "passageAsked",
      bookId: BOOK,
      target: FURTHER,
      pageRange: null,
    });
    expect(state.visit).toEqual(saved);
  });

  it("takes the reader back from the Scrubber's mark, and does not end there", () => {
    const state = visiting();
    expect(effectsOf(state, { kind: "markPressed" })).toEqual([{ kind: "goToCfi", cfi: ON_PAGE }]);
    expect(nextPlace(state, { kind: "markPressed" }).state).toBe(state);
  });

  it("has no mark to press while the reader is simply reading", () => {
    expect(effectsOf(reading(), { kind: "markPressed" })).toEqual([]);
  });
});

describe("going back to a passage", () => {
  it("jumps whether or not it opens a visit", () => {
    expect(
      effectsOf(reading(), {
        kind: "passageAsked",
        bookId: BOOK,
        target: ON_PAGE,
        pageRange: PAGE,
      }),
    ).toEqual([{ kind: "goToCfi", cfi: ON_PAGE }]);
  });

  it("opens no visit for a passage on the page in front of the reader", () => {
    const state = run(reading(), {
      kind: "passageAsked",
      bookId: BOOK,
      target: ON_PAGE,
      pageRange: PAGE,
    });
    expect(state.visit).toBeNull();
  });

  it("opens no visit before the first relocate of a book never read", () => {
    // Nothing to defend: the jump writes the passage as the position, which is right when
    // there is no progress to lose.
    const opened = run(
      placeFor(BOOK),
      { kind: "recalled", bookId: BOOK },
      { kind: "ready", bookId: BOOK },
    );
    expect(
      run(opened, { kind: "passageAsked", bookId: BOOK, target: FAR, pageRange: PAGE }).visit,
    ).toBeNull();
  });

  it("opens no visit when there is no page to compare against", () => {
    expect(
      run(reading(), { kind: "passageAsked", bookId: BOOK, target: FAR, pageRange: null }).visit,
    ).toBeNull();
  });
});

describe("a position from another device", () => {
  const arrival = {
    kind: "pulled",
    bookId: BOOK,
    position: progress({ cfi: FAR, pageRange: null, lastReadAt: 9000 }),
    now: 9000,
  } as const;

  it("is offered once this device knows where it is", () => {
    expect(bannerOffer(run(reading(), arrival))?.position.cfi).toBe(FAR);
  });

  it("says nothing while the book is still opening", () => {
    // The open is still downloading or parsing: the position is about to be picked up by the
    // open itself, and a refusal would have nothing of this device's to write in its place.
    expect(run(placeFor(BOOK), arrival).offer).toBeNull();
  });

  it("is held rather than shown until the book is on screen", () => {
    // The banner is drawn over the whole reader, and both its buttons need a renderer. Shown
    // early, [[Go there]] navigates nothing and the offer is gone for good.
    const early = run(
      placeFor(BOOK),
      { kind: "recalled", bookId: BOOK, saved: progress() },
      arrival,
    );
    expect(early.offer).not.toBeNull();
    expect(bannerOffer(early)).toBeNull();
    expect(bannerOffer(run(early, { kind: "ready", bookId: BOOK }))).not.toBeNull();
  });

  it("is not taken away by a later round that has nothing to say", () => {
    const standing = run(reading(), arrival);
    const echo = { ...arrival, position: progress({ lastReadAt: 500 }) };
    expect(run(standing, echo).offer).toEqual(standing.offer);
  });

  it("is replaced by a fresher one", () => {
    const standing = run(reading(), arrival);
    const fresher = {
      ...arrival,
      position: progress({ cfi: FURTHER, pageRange: null, lastReadAt: 12000 }),
      now: 12000,
    };
    expect(run(standing, fresher).offer?.position.cfi).toBe(FURTHER);
  });

  it("reads how long ago it was written once, on arrival", () => {
    const state = run(reading(), { ...arrival, now: 9000 + 3 * 60_000 });
    expect(state.offer?.elapsed).toEqual({ unit: "minutes", count: 3 });
  });
});

describe("answering the offer", () => {
  const offered = (from: Place = reading()): Place =>
    run(from, {
      kind: "pulled",
      bookId: BOOK,
      position: progress({ cfi: FAR, pageRange: null, lastReadAt: 9000 }),
      now: 9000,
    });

  it("Go there moves the book and clears the banner", () => {
    const step = nextPlace(offered(), { kind: "offerTaken" });
    expect(step.effects).toEqual([{ kind: "goToCfi", cfi: FAR }]);
    expect(step.state.offer).toBeNull();
  });

  it("Go there ends a visit, or the relocate it causes would be swallowed", () => {
    const during = offered(
      run(reading(), { kind: "passageAsked", bookId: BOOK, target: BEHIND, pageRange: PAGE }),
    );
    expect(nextPlace(during, { kind: "offerTaken" }).state.visit).toBeNull();
  });

  it("Stay here writes the page on screen rather than dismissing the banner", () => {
    const step = nextPlace(offered(), { kind: "stayedHere", now: 5000 });
    expect(step.effects).toEqual([
      { kind: "recordPosition", position: progress({ lastReadAt: 5000, dirtyAt: 5000 }) },
    ]);
    expect(step.state.offer).toBeNull();
  });

  it("Stay here writes where the reader is looking, not what the device claims", () => {
    const during = run(
      reading(),
      { kind: "passageAsked", bookId: BOOK, target: BEHIND, pageRange: PAGE },
      {
        kind: "relocated",
        bookId: BOOK,
        position: progress({ cfi: BEHIND, pageRange: null, percentage: 0.1 }),
      },
    );
    const step = nextPlace(offered(during), { kind: "stayedHere", now: 5000 });
    expect(step.state.position?.cfi).toBe(BEHIND);
    expect(step.state.visit).toBeNull();
  });

  it("Stay here during a visit brings the ground covered back with the progress", () => {
    // Otherwise a reader who answers the banner and closes the book straight after is recorded
    // as having read to the page they have just disowned.
    const during = run(
      reading(),
      { kind: "passageAsked", bookId: BOOK, target: BEHIND, pageRange: PAGE },
      {
        kind: "relocated",
        bookId: BOOK,
        position: progress({ cfi: BEHIND, pageRange: null, percentage: 0.1 }),
        fraction: 0.1,
      },
    );
    expect(effectsOf(offered(during), { kind: "stayedHere", now: 5000 })).toEqual([
      { kind: "groundCovered", fraction: 0.1 },
      { kind: "recordPosition", position: expect.objectContaining({ percentage: 0.1 }) },
    ]);
  });

  it("Stay here says nothing about the ground covered while the index is still building", () => {
    // `percentage` stands in the last fraction the reader had until the index answers, and 0 for
    // a book never opened. Reporting one would place a sitting nothing could place, which is
    // exactly the row `stats.ts` drops rather than read as "moved nowhere".
    const during = run(
      reading(),
      { kind: "passageAsked", bookId: BOOK, target: BEHIND, pageRange: PAGE },
      {
        kind: "relocated",
        bookId: BOOK,
        position: progress({ cfi: BEHIND, pageRange: null, percentage: 0.5 }),
      },
    );
    expect(effectsOf(offered(during), { kind: "stayedHere", now: 5000 })).toEqual([
      { kind: "recordPosition", position: expect.anything() },
    ]);
  });

  it("Stay here outside a visit says nothing about the ground covered", () => {
    // The last `relocate` already reported it, and the page has not moved since.
    expect(effectsOf(offered(), { kind: "stayedHere", now: 5000 })).toEqual([
      { kind: "recordPosition", position: expect.anything() },
    ]);
  });

  it("keeps the screen and the position together afterwards", () => {
    const state = nextPlace(offered(), { kind: "stayedHere", now: 5000 }).state;
    expect(state.screen).toBe(state.position);
  });

  it("does nothing before this device knows where it is", () => {
    const state = placeFor(BOOK);
    expect(nextPlace(state, { kind: "stayedHere", now: 5000 })).toEqual({ state, effects: [] });
    expect(nextPlace(state, { kind: "offerTaken" })).toEqual({ state, effects: [] });
  });
});
