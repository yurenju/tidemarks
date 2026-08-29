// The chrome's rules stated in one place, where a browser is not needed to ask them.
//
// Two kinds of question live here, and they are the two a screen answers slowly or not at all.
// **Which of two things wins the same frame** — a panel standing open when a selection arrives,
// 〈Notes〉 pressed while 〈Type〉 is showing, a note being edited when the reader taps the page
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

describe("〈標〉 displaces whatever 〈找〉 was showing", () => {
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

  it("takes the whole panel away with it when a jump is made from inside one", () => {
    expect(nextChrome(at({ chrome: "toc", panelKind: "toc" }), { kind: "jumped" }).chrome).toBe(
      "down",
    );
  });
});

describe("the note being written", () => {
  it("opens the panel and starts editing in one move", () => {
    expect(nextChrome(at(), { kind: "openNote", id: "a" })).toMatchObject({
      chrome: "notes",
      panelKind: "notes",
      editing: "a",
    });
  });

  it("keeps unsaved words when the reader taps the chrome away", () => {
    const after = run(at(), { kind: "openNote", id: "a" }, { kind: "tapped" });
    expect(after).toMatchObject({ chrome: "down", editing: "a" });
  });

  it("keeps unsaved words when a page turn puts the chrome away", () => {
    const after = run(at(), { kind: "openNote", id: "a" }, { kind: "turned" });
    expect(after).toMatchObject({ chrome: "down", editing: "a" });
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

  it("takes the panel away where the panel is over the book, and points at nothing", () => {
    // Narrower than 1024px the panel covers the page (`styles/device.css`), so a panel kept
    // standing would hide the passage it was kept standing for. It goes, and the wash with it —
    // there is no panel left for a pointed-at passage to belong to.
    const after = nextChrome(at({ chrome: "notes" }), {
      kind: "notePressed",
      id: "a",
      keepPanel: false,
    });
    expect(after.chrome).toBe("down");
    expect(after.selected).toBeNull();
  });

  it.each([
    ["a page turn", { kind: "turned" } as const],
    ["a tap on the page", { kind: "tapped" } as const],
    ["a chapter pressed in 〈目錄〉", { kind: "jumped" } as const],
    ["a selection arriving", { kind: "selectionArrived" } as const],
    ["the panel dismissing itself", { kind: "panelDismissed" } as const],
    ["〈排版〉 taking the panel over", { kind: "togglePanel", panel: "layout" } as const],
    ["〈Notes〉 pressed again to close it", { kind: "togglePanel", panel: "notes" } as const],
  ])("stops pointing after %s", (_what, event) => {
    const after = nextChrome(at({ chrome: "notes", selected: "a" }), event);
    expect(after.selected).toBeNull();
  });

  it("stops pointing when the panel is raised again, having been pressed last time", () => {
    // The reader who reopens 〈Notes〉 has pressed nothing in it. A passage still lit from the
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
    // Two ways in: tapping a mark on the page, and having ticked 〈標記並註記〉. Both send
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
