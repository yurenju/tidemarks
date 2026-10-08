// The chrome's rules stated in one place, where a browser is not needed to ask them.
//
// Two kinds of question live here, and they are the two a screen answers slowly or not at all.
// **Which of two things wins the same frame** — a panel standing open when a selection arrives,
// [[Contents]] pressed while [[Type]] is showing, a note being edited when the reader taps the page
// away. Each rule is obvious alone; the answer used to be reading order across eleven
// `setChrome` calls, and the only way to ask it was three browsers. And **what a value's whole
// life looks like** — every way into [[Reflect]] and every way out of it,
// which a browser could walk one at a time for the price of a book opening each time.
//
// What this layer cannot say is that anything moved on screen, that the panel was not remounted
// mid-switch, or that a passage was really filled in with ink: those are
// packages/app/tests/browser/reader/chrome-placement.spec.ts and .../highlights.spec.ts.
import { describe, expect, it } from "vitest";
import {
  chromeShowing,
  initialChrome,
  nextChrome,
  type ChromeEvent,
  type ChromeState,
} from "./chrome";

/** A state to start a case from, spelled out only where the case is about it. */
const at = (over: Partial<ChromeState> = {}): ChromeState => ({ ...initialChrome, ...over });

/** Replays a run of events, which is how an interleaving is stated. */
const run = (state: ChromeState, ...events: ChromeEvent[]): ChromeState =>
  events.reduce(nextChrome, state);

describe("Marking displaces whatever Find was showing", () => {
  it.each(["up", "layout", "toc", "down"] as const)("puts the chrome away from %s", (chrome) => {
    expect(nextChrome(at({ chrome }), { kind: "selectionArrived" }).chrome).toBe("down");
  });

  it("leaves Reflect standing, the one exception", () => {
    // A reader looking over what they marked who sees one more thing worth marking is doing what
    // [[Reflect]] is for. The colour row stands over the book, and the panel stays beside it.
    const after = nextChrome(at({ chrome: "reflect", face: "notes", selected: "a" }), {
      kind: "selectionArrived",
    });
    expect(after).toMatchObject({ chrome: "reflect", selected: null });
  });
});

describe("two things wanting the chrome at once", () => {
  it("switches straight from one panel to another, never through the bare bar", () => {
    const after = nextChrome(at({ chrome: "layout", face: "layout" }), {
      kind: "togglePanel",
      panel: "toc",
    });
    expect(after).toMatchObject({ chrome: "toc", face: "toc" });
  });

  it("remembers which face it was showing after a selection closes it", () => {
    const after = nextChrome(at({ chrome: "layout", face: "layout" }), {
      kind: "selectionArrived",
    });
    expect(after).toMatchObject({ chrome: "down", face: "layout" });
  });

  it("remembers which face it was showing after a page turn closes it", () => {
    const after = nextChrome(at({ chrome: "toc", face: "toc" }), { kind: "turned" });
    expect(after).toMatchObject({ chrome: "down", face: "toc" });
  });

  it("ignores a panel dismissing itself after something else already put the chrome away", () => {
    // The shape of the bug this file exists for: a panel's own `onClose` arriving late and
    // writing over a state somebody else had already moved on from.
    const after = run(
      at({ chrome: "toc", face: "toc" }),
      { kind: "turned" },
      {
        kind: "panelDismissed",
      },
    );
    expect(after.chrome).toBe("down");
  });

  it("takes the whole panel away with it where the panel is over the book", () => {
    const after = nextChrome(at({ chrome: "toc", face: "toc" }), {
      kind: "jumped",
      keepPanel: false,
    });
    expect(after.chrome).toBe("down");
  });

  it("leaves Contents standing where the book keeps a column of its own", () => {
    // A chapter pressed on a desk is one of a list the reader may be working through, and the
    // book they were sent to is still on screen beside the panel. Closing it would cost a press
    // per chapter to get back — the same argument `notePressed` already makes for a passage.
    const after = nextChrome(at({ chrome: "toc", face: "toc" }), {
      kind: "jumped",
      keepPanel: true,
    });
    expect(after.chrome).toBe("toc");
  });
});

// The rows of the spec's transition table that lead into and out of [[Reflect]], one case each.
// [[Marking]]'s own rows — writing a note in place, and coming back to [[Read]] from it — belong
// to the ticket that moves the note out of [[Reflect]]; what is here is where a note is written today.
describe("into Reflect and out of it", () => {
  it("goes in from Read on a tap on a marked passage, pointed at it and not writing", () => {
    expect(nextChrome(at(), { kind: "markPicked", id: "a" })).toMatchObject({
      chrome: "reflect",
      face: "notes",
      selected: "a",
      editing: null,
    });
  });

  it.each(["up", "toc", "layout"] as const)(
    "goes in from %s on [[Notes]], with nothing pointed at",
    (chrome) => {
      const after = nextChrome(at({ chrome, selected: "a" }), { kind: "notesToggled" });
      expect(after).toMatchObject({ chrome: "reflect", face: "notes", selected: null });
    },
  );

  it("goes in from Read on `N`, with nothing pointed at", () => {
    expect(nextChrome(at(), { kind: "notesToggled" })).toMatchObject({
      chrome: "reflect",
      selected: null,
    });
  });

  it("comes out to Read on `N` pressed again, the same as Escape", () => {
    const state = at({ chrome: "reflect", face: "notes" });
    expect(nextChrome(state, { kind: "notesToggled" })).toEqual(
      nextChrome(state, { kind: "panelDismissed" }),
    );
    expect(nextChrome(state, { kind: "notesToggled" }).chrome).toBe("down");
  });

  it("comes out to Read, not to the bare bars, when the panel is dismissed", () => {
    // The ✕, Escape and the back button all arrive as `panelDismissed`. [[Reflect]] was not raised
    // from the bar, so there is no bar to drop back to.
    const after = nextChrome(at({ chrome: "reflect", face: "notes" }), { kind: "panelDismissed" });
    expect(after.chrome).toBe("down");
  });

  it("comes out to Read on a tap on the page, and only the next tap raises the bars", () => {
    const after = run(at({ chrome: "reflect", face: "notes" }), { kind: "tapped" });
    expect(after.chrome).toBe("down");
    expect(nextChrome(after, { kind: "tapped" }).chrome).toBe("up");
  });

  it("stays through a page turn", () => {
    const after = nextChrome(at({ chrome: "reflect", face: "notes" }), { kind: "turned" });
    expect(after.chrome).toBe("reflect");
  });

  it("stays on a tap on another marked passage, and points at that one instead", () => {
    const after = nextChrome(at({ chrome: "reflect", face: "notes", selected: "a" }), {
      kind: "markPicked",
      id: "b",
    });
    expect(after).toMatchObject({ chrome: "reflect", selected: "b" });
  });

  it("stays while a passage is marked in it, and points at the new mark", () => {
    const after = run(
      at({ chrome: "reflect", face: "notes", selected: "a" }),
      { kind: "selectionArrived" },
      { kind: "marked", id: "b", withNote: false },
    );
    expect(after).toMatchObject({ chrome: "reflect", selected: "b", editing: null });
  });

  it("stays while a passage is marked in it with a note, and writes it there", () => {
    const after = run(
      at({ chrome: "reflect", face: "notes" }),
      { kind: "selectionArrived" },
      { kind: "marked", id: "b", withNote: true },
    );
    expect(after).toMatchObject({ chrome: "reflect", selected: "b", editing: "b" });
  });

  it("stays when Edit is pressed in the list, with that note open for writing", () => {
    const after = nextChrome(at({ chrome: "reflect", face: "notes" }), {
      kind: "editNote",
      id: "a",
    });
    expect(after).toMatchObject({ chrome: "reflect", editing: "a", selected: "a" });
  });

  it("leaves Read where it is when a passage is marked there without a note", () => {
    const state = at();
    expect(nextChrome(state, { kind: "marked", id: "a", withNote: false })).toBe(state);
  });
});

// **The passage stops being pointed at when a turn leaves it behind**, and only then. The machine
// cannot see the page, so whoever measured the marks on it says which ones they are.
describe("the passage pointed at across a page turn", () => {
  it("is kept when it is still on the page the turn landed on", () => {
    // A passage that runs over the page. The reader turned to read the rest of it.
    const after = run(
      at({ chrome: "reflect", face: "notes", selected: "a" }),
      { kind: "turned" },
      { kind: "turnLanded", showing: ["a", "b"] },
    );
    expect(after).toMatchObject({ chrome: "reflect", selected: "a" });
  });

  it("is let go of when the page the turn landed on does not have it", () => {
    const after = run(
      at({ chrome: "reflect", face: "notes", selected: "a" }),
      { kind: "turned" },
      { kind: "turnLanded", showing: ["b"] },
    );
    expect(after).toMatchObject({ chrome: "reflect", selected: null });
  });
});

// **A note written on the spot keeps the reader in [[Marking]]**, with no chrome around it, and
// [[Done]] takes them back to the book (ADR-0020). It is written on [[Reflect]]'s face, so that a
// note has one place to be written at either width — but the reader asked to write one thing, not
// to be left in a list.
describe("the note written on the spot", () => {
  const writing = () => run(at(), { kind: "marked", id: "a", withNote: true });

  it("stays in Marking with the note open and pointed at", () => {
    // Pointed at so the page shows which words the note is about, and so its card in the list
    // carries [[Delete]] for a reader who changes their mind.
    expect(writing()).toMatchObject({
      chrome: "marking",
      face: "notes",
      editing: "a",
      selected: "a",
    });
  });

  it("stays in Marking from Find as well, the bars having gone with the selection", () => {
    const after = run(
      at({ chrome: "toc", face: "toc" }),
      { kind: "selectionArrived" },
      { kind: "marked", id: "a", withNote: true },
    );
    expect(after).toMatchObject({ chrome: "marking", editing: "a" });
  });

  it.each([
    ["Done is pressed", { kind: "noteSaved" } as const],
    ["the reader taps the page", { kind: "tapped" } as const],
    ["the panel dismisses itself", { kind: "panelDismissed" } as const],
    ["a page is turned", { kind: "turned" } as const],
    ["a selection arrives", { kind: "selectionArrived" } as const],
    ["the mark under it is deleted", { kind: "pickDropped" } as const],
    ["a marked passage is tapped, most often this one", { kind: "markPicked", id: "a" } as const],
  ])("goes back to Read when %s, with nothing open and nothing pointed at", (_what, event) => {
    expect(nextChrome(writing(), event)).toMatchObject({
      chrome: "down",
      editing: null,
      selected: null,
    });
  });

  it.each([
    ["a quote is pressed in the list beside it", { kind: "notePressed", id: "b", keepPanel: true }],
    ["Edit is pressed on another card", { kind: "editNote", id: "b" }],
  ] as const)("becomes Reflect when %s, which is looking back", (_what, event) => {
    // Whatever is open afterwards is the card pressed, never the new note left standing beside it.
    const after = nextChrome(writing(), event);
    expect(after).toMatchObject({ chrome: "reflect", selected: "b" });
    expect(after.editing).not.toBe("a");
  });

  it("keeps pointing where a quote pressed on a narrow window sends the reader", () => {
    // The panel is over the book there, so the press takes it away — and the wash it leaves is
    // the passage the reader pressed, not the note they were writing.
    const after = nextChrome(writing(), { kind: "notePressed", id: "b", keepPanel: false });
    expect(after).toMatchObject({ chrome: "down", editing: null, selected: "b" });
  });

  it("is written in Reflect instead when the passage was marked there, and stays there", () => {
    // The one place [[Mark and note]] does not leave the reader in [[Marking]]: selecting in
    // [[Reflect]] does not put it away, so the note joins the list the reader came to look at.
    const after = run(
      at({ chrome: "reflect", face: "notes" }),
      { kind: "selectionArrived" },
      { kind: "marked", id: "b", withNote: true },
      { kind: "noteSaved" },
    );
    expect(after).toMatchObject({ chrome: "reflect", editing: null, selected: "b" });
  });
});

// What the page holds on to when the book reflows beside a panel. Whether frond really keeps it on
// screen is for a browser (`tests/browser/reader/highlights.spec.ts`); what is here is which
// passage that is, and when it stops being one.
describe("the passage kept through a reflow", () => {
  const writing = () => run(at(), { kind: "marked", id: "a", withNote: true });

  it("is the one pointed at, wherever something is", () => {
    expect(writing().kept).toBe("a");
    expect(nextChrome(at(), { kind: "markPicked", id: "b" }).kept).toBe("b");
  });

  // The book takes its column back in the same frame the note closes, and that reflow is the one
  // that used to put the passage on the next page.
  it.each([
    ["Done is pressed", { kind: "noteSaved" } as const],
    ["the reader taps the page", { kind: "tapped" } as const],
    ["the panel dismisses itself", { kind: "panelDismissed" } as const],
  ])("outlives Marking's note when %s, though nothing is pointed at", (_what, event) => {
    expect(nextChrome(writing(), event)).toMatchObject({
      chrome: "down",
      selected: null,
      kept: "a",
    });
  });

  it("is let go by the next thing that happens in Read", () => {
    const done = nextChrome(writing(), { kind: "noteSaved" });
    expect(nextChrome(done, { kind: "turned" }).kept).toBeNull();
    expect(nextChrome(done, { kind: "tapped" }).kept).toBeNull();
  });

  it("follows the pointer out of Reflect, rather than outliving it", () => {
    const state = at({ chrome: "reflect", face: "notes", selected: "a", kept: "a" });
    expect(nextChrome(state, { kind: "turnLanded", showing: [] }).kept).toBeNull();
    expect(nextChrome(state, { kind: "panelDismissed" }).kept).toBe("a");
  });
});

// **A note stops being edited the moment Reflect stops standing**, and nothing has to be lost
// with it: the words are committed when the box loses focus, so what closes here is the editor
// and not the writing (ADR-0044, on what it costs). Held any longer, `editing` would still be set the next
// time [[Notes]] was raised, and the box that remounts takes the focus — which on a phone means
// pressing [[Notes]] to read a list and getting a keyboard.
describe("the note being changed in Reflect", () => {
  const writing = () =>
    nextChrome(at({ chrome: "reflect", face: "notes" }), { kind: "editNote", id: "a" });

  it.each([
    ["the reader taps the page", { kind: "tapped" } as const],
    ["the panel dismisses itself", { kind: "panelDismissed" } as const],
    ["`N` is pressed", { kind: "notesToggled" } as const],
    ["a selection arrives", { kind: "selectionArrived" } as const],
    ["another passage is tapped", { kind: "markPicked", id: "b" } as const],
    ["the address steps back to the list", { kind: "pickDropped" } as const],
  ])("stops editing when %s", (_what, event) => {
    expect(nextChrome(writing(), event).editing).toBeNull();
  });

  it("raises a bare list rather than a box with the focus, having been left mid-note", () => {
    // The whole of the report this rule came from: a note left half written, [[Notes]] pressed
    // some time later to read the list, and a keyboard covering it.
    const after = run(writing(), { kind: "tapped" }, { kind: "tapped" }, { kind: "notesToggled" });
    expect(after).toMatchObject({ chrome: "reflect", editing: null });
  });

  it("has nothing being edited once the note is saved, and goes on pointing at it", () => {
    // Saving closes the editor, not the panel: the reader is still looking at the passage.
    const after = nextChrome(writing(), { kind: "noteSaved" });
    expect(after).toMatchObject({ chrome: "reflect", editing: null, selected: "a" });
  });
});

// Which marked passage [[Reflect]] is pointing at — the value the wash over the book is drawn
// from. **The lifecycle is the whole of it**: what a browser can show is that one passage is
// filled in, and what it cannot show cheaply is every way out leaving the right thing pointed at.
describe("the passage Reflect is pointing at", () => {
  it("is the one that was pressed, with the panel left standing where the book has room", () => {
    const after = nextChrome(at({ chrome: "reflect", face: "notes" }), {
      kind: "notePressed",
      id: "a",
      keepPanel: true,
    });
    expect(after).toMatchObject({ chrome: "reflect", selected: "a" });
  });

  it("takes the panel away where the panel is over the book, and keeps pointing", () => {
    // Narrower than the column the panel covers the page (`styles/device.css`), so a panel kept
    // standing would hide the passage it was kept standing for. It goes — and the wash stays,
    // because the passage it names is exactly what the reader pressed to be shown.
    const after = nextChrome(at({ chrome: "reflect", face: "notes" }), {
      kind: "notePressed",
      id: "a",
      keepPanel: false,
    });
    expect(after).toMatchObject({ chrome: "down", selected: "a" });
  });

  it.each([
    ["a chapter pressed in [[Contents]]", { kind: "jumped", keepPanel: false } as const],
    ["a selection arriving", { kind: "selectionArrived" } as const],
    ["the address stepping back to the list", { kind: "pickDropped" } as const],
  ])("stops pointing after %s", (_what, event) => {
    const after = nextChrome(at({ chrome: "reflect", face: "notes", selected: "a" }), event);
    expect(after.selected).toBeNull();
  });

  it.each([
    ["a tap on the page", { kind: "tapped" } as const],
    ["the panel dismissing itself", { kind: "panelDismissed" } as const],
    ["`N` pressed to leave", { kind: "notesToggled" } as const],
    ["a page turn, until it lands", { kind: "turned" } as const],
  ])("goes on pointing through %s, which leaves the reader on the same page", (_what, event) => {
    // **The wash outlives the panel**, because on a narrow window pressing a quote is how a
    // reader asks to be shown the passage — and the panel has to go for them to see it.
    const after = nextChrome(at({ chrome: "reflect", face: "notes", selected: "a" }), event);
    expect(after.selected).toBe("a");
  });

  it("stops pointing when Reflect is raised again, having been pressed last time", () => {
    // The reader who reopens [[Notes]] has pressed nothing in it. A passage still lit from the
    // last time they had it open is the app answering a question nobody asked.
    const after = run(
      at({ chrome: "reflect", face: "notes" }),
      { kind: "notePressed", id: "a", keepPanel: true },
      { kind: "panelDismissed" },
      { kind: "notesToggled" },
    );
    expect(after).toMatchObject({ chrome: "reflect", selected: null });
  });

  it("points at the note being written, not at the one pressed before it", () => {
    const after = run(
      at({ chrome: "reflect", face: "notes" }),
      { kind: "notePressed", id: "a", keepPanel: true },
      { kind: "marked", id: "b", withNote: true },
    );
    expect(after).toMatchObject({ selected: "b", editing: "b" });
  });
});

// ⚠️ `toBe`, not `toEqual`. React skips the render when the state is the same object, and the
// reader spends most of a book with the chrome already down — so a page turn hits this path every
// time. A fresh object here is one whole extra Reader render per page, which nothing would report
// and only `tests/browser/reader/turn-pacing.spec.ts` would notice.
describe("an event that changes nothing returns the same object", () => {
  it("does when a page is turned with the chrome already down", () => {
    const state = at();
    expect(nextChrome(state, { kind: "turned" })).toBe(state);
  });

  it("does when a turn lands with nothing pointed at", () => {
    const state = at();
    expect(nextChrome(state, { kind: "turnLanded", showing: ["a"] })).toBe(state);
  });

  // [[Reflect]] stays through a turn, so a reader working through their notes sends both of these
  // on every page, and neither may cost a render when it changes nothing.
  it("does when a page is turned in Reflect", () => {
    const state = at({ chrome: "reflect", face: "notes", selected: "a", kept: "a" });
    expect(nextChrome(state, { kind: "turned" })).toBe(state);
  });

  it("does when a turn lands in Reflect with the passage still on the page", () => {
    const state = at({ chrome: "reflect", face: "notes", selected: "a", kept: "a" });
    expect(nextChrome(state, { kind: "turnLanded", showing: ["a"] })).toBe(state);
  });

  it("does when a panel dismisses itself with no panel showing", () => {
    const state = at({ chrome: "up" });
    expect(nextChrome(state, { kind: "panelDismissed" })).toBe(state);
  });
});

/**
 * Coming back to an address that already names a face: a refresh, a pasted link, a tab reopened
 * (ADR-0046).
 *
 * Computed before the first render rather than applied by an effect afterwards, because the
 * address and this value mirror each other — a first frame in which the chrome is down while the
 * address says [[Notes]] is a frame in which the mirror reads a disagreement and answers it by
 * clearing the address the reader just typed.
 */
describe("the chrome an address already naming a face comes back to", () => {
  it("stands the panel the address names", () => {
    expect(chromeShowing("layout", null)).toEqual({
      chrome: "layout",
      face: "layout",
      editing: null,
      selected: null,
      kept: null,
    });
  });

  it("comes back to Reflect pointed at the note the address names, not writing in it", () => {
    expect(chromeShowing("notes", "n1")).toEqual({
      chrome: "reflect",
      face: "notes",
      editing: null,
      selected: "n1",
      kept: "n1",
    });
  });

  // A note id can only mean anything to [[Reflect]], and the address cannot spell one anywhere
  // else — but nothing downstream should have to know that.
  it("ignores a note id given with any other face", () => {
    expect(chromeShowing("toc", "n1").selected).toBeNull();
  });

  it("is the plain opening state when the address names no face", () => {
    expect(chromeShowing(null, null)).toBe(initialChrome);
  });
});
