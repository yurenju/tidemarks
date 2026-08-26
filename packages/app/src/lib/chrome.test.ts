// What happens when two things want the chrome in the same frame — a panel standing open when a
// selection arrives, 〈Notes〉 pressed while 〈Type〉 is showing, a note being edited when the reader
// taps the page away. Each of those rules is obvious alone; the answer to "which of them wins"
// used to be reading order across eleven `setChrome` calls, and the only way to ask it was three
// browsers. What this layer cannot say is that anything moved on screen or that the panel was not
// remounted mid-switch: that is packages/app/tests/browser/reader/chrome-placement.spec.ts.
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
