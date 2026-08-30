// The chrome's rules stated in one place, where a browser is not needed to ask them.
//
// Two kinds of question live here, and they are the two a screen answers slowly or not at all.
// **Which of two things wins the same frame** — a panel standing open when a selection arrives,
// [[Notes]] pressed while [[Type]] is showing, a note being edited when the reader taps the page
// away. Each rule is obvious alone; the answer used to be reading order across eleven
// `setChrome` calls, and the only way to ask it was three browsers. And **what a value's whole
// life looks like** — every way into the notes panel and every one of the eight ways out of it,
// which a browser could walk one at a time for the price of a book opening each time.
//
// What this layer cannot say is that anything moved on screen, that the panel was not remounted
// mid-switch, or that a passage was really filled in with ink: those are
// packages/app/tests/browser/reader/chrome-placement.spec.ts and .../highlights.spec.ts.
import { describe, expect, it } from "vitest";
import { initialChrome, nextChrome, type ChromeEvent, type ChromeState } from "./chrome";

/** A state to start a case from, spelled out only where the case is about it. */
const at = (over: Partial<ChromeState> = {}): ChromeState => ({ ...initialChrome, ...over });

/** Replays a run of events, which is how an interleaving is stated. */
const run = (state: ChromeState, ...events: ChromeEvent[]): ChromeState =>
  events.reduce(nextChrome, state);

describe("[[Marking]] displaces whatever [[Find]] was showing", () => {
  it.each(["up", "layout", "down"] as const)("puts the chrome away from %s", (chrome) => {
    expect(nextChrome(at({ chrome }), { kind: "selectionArrived" }).chrome).toBe("down");
  });
});

describe("two things wanting the chrome at once", () => {
  it("switches straight from one panel to another, never through the bare bar", () => {
    const after = nextChrome(at({ chrome: "layout", panelKind: "layout" }), {
      kind: "togglePanel",
      panel: "notes",
    });
    expect(after).toMatchObject({ chrome: "notes", panelKind: "notes" });
  });

  it("remembers which panel it was showing after a selection closes it", () => {
    const after = nextChrome(at({ chrome: "layout", panelKind: "layout" }), {
      kind: "selectionArrived",
    });
    expect(after).toMatchObject({ chrome: "down", panelKind: "layout" });
  });

  it("remembers which panel it was showing after a page turn closes it", () => {
    const after = nextChrome(at({ chrome: "toc", panelKind: "toc" }), { kind: "turned" });
    expect(after).toMatchObject({ chrome: "down", panelKind: "toc" });
  });

  it("leaves the notes panel open when a second note asks for it", () => {
    const after = run(at(), { kind: "openNote", id: "a" }, { kind: "openNote", id: "b" });
    expect(after).toMatchObject({ chrome: "notes", editing: "b" });
  });

  it("ignores a panel dismissing itself after something else already put the chrome away", () => {
    // The shape of the bug this file exists for: a panel's own `onClose` arriving late and
    // writing over a state somebody else had already moved on from.
    const after = run(
      at({ chrome: "toc", panelKind: "toc" }),
      { kind: "turned" },
      {
        kind: "panelDismissed",
      },
    );
    expect(after.chrome).toBe("down");
  });

  it("takes the whole panel away with it where the panel is over the book", () => {
    const after = nextChrome(at({ chrome: "toc", panelKind: "toc" }), {
      kind: "jumped",
      keepPanel: false,
    });
    expect(after.chrome).toBe("down");
  });

  it("leaves [[Contents]] standing where the book keeps a column of its own", () => {
    // A chapter pressed on a desk is one of a list the reader may be working through, and the
    // book they were sent to is still on screen beside the panel. Closing it would cost a press
    // per chapter to get back — the same argument `notePressed` already makes for a passage.
    const after = nextChrome(at({ chrome: "toc", panelKind: "toc" }), {
      kind: "jumped",
      keepPanel: true,
    });
    expect(after.chrome).toBe("toc");
  });
});

// **A note stops being edited the moment the panel stops standing**, and nothing has to be lost
// with it: the words are committed when the box loses focus, so what closes here is the editor
// and not the writing (ADR-0044's 代價). Held any longer, `editing` would still be set the next
// time [[Notes]] was raised, and the box that remounts takes the focus — which on a phone means
// pressing [[Notes]] to read a list and getting a keyboard.
describe("the note being written", () => {
  it("opens the panel and starts editing in one move", () => {
    expect(nextChrome(at(), { kind: "openNote", id: "a" })).toMatchObject({
      chrome: "notes",
      panelKind: "notes",
      editing: "a",
    });
  });

  it.each([
    ["the reader taps the chrome away", { kind: "tapped" } as const],
    ["a page turn puts the chrome away", { kind: "turned" } as const],
    ["the panel dismisses itself", { kind: "panelDismissed" } as const],
    ["[[Layout]] takes the panel over", { kind: "togglePanel", panel: "layout" } as const],
    ["a selection arrives", { kind: "selectionArrived" } as const],
  ])("stops editing when %s", (_what, event) => {
    const after = run(at(), { kind: "openNote", id: "a" }, event);
    expect(after.editing).toBeNull();
  });

  it("raises a bare list rather than a box with the focus, having been left mid-note", () => {
    // The whole of the report this rule came from: a note left half written, [[Notes]] pressed
    // some time later to read the list, and a keyboard covering it.
    const after = run(
      at(),
      { kind: "openNote", id: "a" },
      { kind: "tapped" },
      { kind: "togglePanel", panel: "notes" },
    );
    expect(after).toMatchObject({ chrome: "notes", editing: null });
  });

  it("has nothing being edited once the note is saved", () => {
    const after = run(at(), { kind: "openNote", id: "a" }, { kind: "noteSaved" });
    expect(after.editing).toBeNull();
  });
});

// Which marked passage the panel is pointing at — the value the wash over the book is drawn
// from. **The lifecycle is the whole of it**: what a browser can show is that one passage is
// filled in, and what it cannot show cheaply is that every one of the eight ways out of the
// panel leaves nothing pointed at. Held outside this file it needed a writer per exit, and the
// ones that were missed lit a passage on a panel the reader had only just reopened.
describe("the passage the notes panel is pointing at", () => {
  it("is the one that was pressed, with the panel left standing where the book has room", () => {
    const after = nextChrome(at({ chrome: "notes" }), {
      kind: "notePressed",
      id: "a",
      keepPanel: true,
    });
    expect(after.selected).toBe("a");
    expect(after.chrome).toBe("notes");
  });

  it("takes the panel away where the panel is over the book, and keeps pointing", () => {
    // Narrower than the column the panel covers the page (`styles/device.css`), so a panel kept
    // standing would hide the passage it was kept standing for. It goes — and the wash stays,
    // because the passage it names is exactly what the reader pressed to be shown.
    const after = nextChrome(at({ chrome: "notes" }), {
      kind: "notePressed",
      id: "a",
      keepPanel: false,
    });
    expect(after.chrome).toBe("down");
    expect(after.selected).toBe("a");
  });

  it.each([
    ["a page turn", { kind: "turned" } as const],
    ["a chapter pressed in [[Contents]]", { kind: "jumped", keepPanel: false } as const],
    ["a selection arriving", { kind: "selectionArrived" } as const],
  ])("stops pointing after %s", (_what, event) => {
    const after = nextChrome(at({ chrome: "notes", selected: "a" }), event);
    expect(after.selected).toBeNull();
  });

  it.each([
    ["a tap on the page", { kind: "tapped" } as const],
    ["the panel dismissing itself", { kind: "panelDismissed" } as const],
    ["[[Notes]] pressed again to close it", { kind: "togglePanel", panel: "notes" } as const],
    ["[[Layout]] taking the panel over", { kind: "togglePanel", panel: "layout" } as const],
    ["[[Contents]] taking the panel over", { kind: "togglePanel", panel: "toc" } as const],
  ])("goes on pointing through %s, which leaves the reader on the same page", (_what, event) => {
    // **The wash outlives the panel now**, because on a narrow window pressing a quote is how a
    // reader asks to be shown the passage — and the panel has to go for them to see it. What
    // ends it is leaving the page the passage is on, not the panel closing. Closing [[Notes]] by
    // pressing it again is that same move made from the bar rather than from the quote.
    const after = nextChrome(at({ chrome: "notes", selected: "a" }), event);
    expect(after.selected).toBe("a");
  });

  it("stops pointing when the panel is raised again, having been pressed last time", () => {
    // The reader who reopens [[Notes]] has pressed nothing in it. A passage still lit from the
    // last time they had it open is the app answering a question nobody asked.
    const after = run(
      at({ chrome: "notes" }),
      { kind: "notePressed", id: "a", keepPanel: true },
      { kind: "panelDismissed" },
      { kind: "togglePanel", panel: "notes" },
    );
    expect(after.chrome).toBe("notes");
    expect(after.selected).toBeNull();
  });

  it("points at the note a tap on the page opened, not at the one pressed before it", () => {
    // Two ways in: tapping a mark on the page, and having ticked [[Mark and note]]. Both send
    // `openNote`, and both used to leave the wash on whichever passage was pressed last —
    // lighting one passage while the note being written belonged to another.
    const after = run(
      at({ chrome: "notes" }),
      { kind: "notePressed", id: "a", keepPanel: true },
      { kind: "openNote", id: "b" },
    );
    expect(after.selected).toBe("b");
    expect(after.editing).toBe("b");
  });

  it("keeps pointing at the note that was just saved", () => {
    // Saving closes the editor, not the panel: the reader is still looking at the passage.
    const after = run(
      at({ chrome: "notes" }),
      { kind: "openNote", id: "a" },
      { kind: "noteSaved" },
    );
    expect(after.selected).toBe("a");
    expect(after.editing).toBeNull();
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

  it("does when a panel dismisses itself with no panel showing", () => {
    const state = at({ chrome: "up" });
    expect(nextChrome(state, { kind: "panelDismissed" })).toBe(state);
  });
});
