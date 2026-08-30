// What a *run* of pointer events adds up to — the three things that had no test at all while
// these rules lived as twelve shared `let`s inside a thousand-line effect:
//
// 1. **The interleaving.** A press that hesitates and then swipes, a drag that turns back on
//    itself, a selection that a page turn arrives in the middle of. Each rule is right on its own
//    (touch.test.ts) and the question here is what happens when two of them want the same press.
// 2. **Calling off the long press.** One `setTimeout` and six routes that have to cancel it. The
//    risk was never the threshold, it was a route that forgot — and a forgotten one is silent.
// 3. **A page turn puts the chrome away, by every route.** Dragging had one browser test proving
//    it; the page buttons and the arrow keys had nothing.
//
// The thresholds themselves are src/lib/touch.test.ts and which page a direction asks for is
// src/lib/navigator.test.ts. Neither of them, and nothing here, can say that anything moved: that
// is packages/app/tests/browser/reader/drag.spec.ts.
import { describe, expect, it } from "vitest";
import { createGestureMachine, type GestureEvent, type GestureIntent } from "./gesture";
import { createNavigator } from "./navigator";
import type { SelectionEnds } from "./selection-handles";
import { LONG_PRESS_MS, TAP_SELECTION_GRACE_MS } from "./touch";

/** A finger, with everything a press needs and nothing it does not. */
const press = (over: Partial<Extract<GestureEvent, { kind: "press" }>> = {}): GestureEvent => ({
  kind: "press",
  x: 200,
  y: 300,
  at: 0,
  pointerType: "touch",
  isLink: false,
  hasSelection: false,
  ...over,
});

const release = (over: Partial<Extract<GestureEvent, { kind: "release" }>> = {}): GestureEvent => ({
  kind: "release",
  x: 200,
  y: 300,
  at: 90,
  isLink: false,
  hasSelection: false,
  showingSelection: false,
  onHighlight: null,
  turn: null,
  ...over,
});

/** A page 600px wide with somewhere to go, which is what most of these gestures are aimed at. */
const PAGE = { extent: 600, atBoundary: false };

function machine(opts: { rtl?: boolean; ownSelection?: boolean } = {}) {
  return createGestureMachine(createNavigator({ rtl: opts.rtl ?? false }), {
    ownSelection: () => opts.ownSelection ?? true,
  });
}

const kinds = (intents: readonly GestureIntent[]): string[] => intents.map((i) => i.kind);

describe("Whose press this is, at the moment it lands", () => {
  it("takes the browser's own tap away from a finger, so #36's search bar never opens", () => {
    // Chrome for Android selects a word out of a plain tap and raises a search bar over the book,
    // and that bar belongs to the browser — nothing on the page takes it back down. This press is
    // the only moment early enough to stop it.
    expect(machine().send(press()).preventDefault).toBe(true);
  });

  it("a stylus is a finger here too", () => {
    expect(machine().send(press({ pointerType: "pen" })).preventDefault).toBe(true);
  });

  it("leaves a mouse alone: its click turns no page, and it has no tap to cancel", () => {
    expect(machine().send(press({ pointerType: "mouse" })).preventDefault).toBe(false);
  });

  it("leaves a link alone, or every footnote marker in the book stops opening", () => {
    // The condition carrying the most weight: a suppressed press loses its `click`, and the click
    // is how frond recognises a link.
    expect(machine().send(press({ isLink: true })).preventDefault).toBe(false);
  });

  it("says nothing about where it landed — every press has something to protect", () => {
    // Position used to be the third condition, back when a tap in the middle band turned nothing.
    // A tap raises the chrome now, so there is no band left with nothing at stake.
    const far = machine().send(press({ x: 5, y: 5 }));
    const middle = machine().send(press({ x: 400, y: 400 }));
    expect(far.preventDefault).toBe(middle.preventDefault);
  });
});

describe("Calling off the long press — one clock, and every route that has to stop it", () => {
  it("starts the clock on a finger, where the selection is ours to draw", () => {
    expect(kinds(machine().send(press()).intents)).toEqual(["armLongPress"]);
  });

  it("does not start it under a mouse: there the browser is still doing this", () => {
    expect(kinds(machine().send(press({ pointerType: "mouse" })).intents)).toEqual([]);
  });

  it("nor on a device that gets the browser's own selection (ADR-0036)", () => {
    expect(kinds(machine({ ownSelection: false }).send(press()).intents)).toEqual([]);
  });

  it("and it asks again on every press, because a machine with both hands changes its answer", () => {
    // The whole of why the machine takes a function rather than a value. A touchscreen desktop
    // has both, and the reader moves between them mid-book: a copy taken when the machine was
    // built would keep arming the long press over a document the mouse has just made selectable,
    // which is the book selecting two ways at once.
    let ours = true;
    const m = createGestureMachine(createNavigator({ rtl: false }), {
      ownSelection: () => ours,
    });

    expect(kinds(m.send(press()).intents)).toEqual(["armLongPress"]);

    ours = false;
    expect(kinds(m.send(press()).intents)).toEqual(["cancelLongPress"]);
  });

  it("stops it when the finger leaves the patch a still one stays in", () => {
    const m = machine();
    m.send(press());
    // Downwards, which turns no page at all — so this cannot be the drag calling it off.
    expect(kinds(m.send({ kind: "move", x: 200, y: 320, at: 16, turn: null }).intents)).toEqual([
      "cancelLongPress",
    ]);
  });

  it("but not for the few pixels a press drifts while it settles", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send({ kind: "move", x: 203, y: 302, at: 16, turn: null }).intents)).toEqual([]);
  });

  it("stops it when the press becomes a page turn", () => {
    const m = machine();
    m.send(press());
    const asked = kinds(m.send({ kind: "move", x: 160, y: 300, at: 16, turn: null }).intents);
    expect(asked).toContain("cancelLongPress");
    expect(asked).toContain("beginTurn");
  });

  it("stops it when the finger lifts", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send(release()).intents)).toContain("cancelLongPress");
  });

  it("stops it when the system takes the touch away", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send({ kind: "cancel" }).intents)).toEqual(["cancelLongPress"]);
  });

  it("stops the one still running when a second press lands", () => {
    // The stray-release case: a finger let go over a page button beside the book reaches no
    // surface of ours, so the clock from that press is still running when the next one starts.
    const m = machine();
    m.send(press());
    expect(kinds(m.send(press({ at: 200 })).intents)).toEqual(["cancelLongPress", "armLongPress"]);
  });

  it("asks for nothing when there is no clock left to stop", () => {
    // What makes the six routes above answerable at all: a cancellation is asked for only when
    // there is one outstanding, so an intent that is missing is a route that forgot.
    const m = machine();
    m.send(press());
    m.send(release());
    expect(kinds(m.send({ kind: "cancel" }).intents)).toEqual([]);
  });
});

describe("A still finger held past the clock", () => {
  it("selects the word where it landed, not where it has drifted to", () => {
    // The distance half was asked on every move; by the time the clock runs out the press has been
    // judged already, and the word it is about is the one it came down on.
    const m = machine();
    m.send(press({ x: 200, y: 300 }));
    m.send({ kind: "move", x: 204, y: 303, at: 100, turn: null });

    expect(m.send({ kind: "longPressFired" }).intents).toEqual([
      { kind: "beginSelection", at: { x: 200, y: 300 } },
    ]);
  });

  it("does nothing if the press is already turning a page", () => {
    // Both halves of the belt: the clock was called off when the drag began, and if it fires
    // anyway — a timer already queued — the drag still owns the press.
    const m = machine();
    m.send(press());
    m.send({ kind: "move", x: 100, y: 300, at: 16, turn: null });
    expect(m.send({ kind: "longPressFired" }).intents).toEqual([]);
  });

  it("does nothing if the finger has already lifted", () => {
    const m = machine();
    m.send(press());
    m.send(release());
    expect(m.send({ kind: "longPressFired" }).intents).toEqual([]);
  });

  it("extends the selection as the finger goes on, away from where it began", () => {
    const m = machine();
    m.send(press({ x: 200, y: 300 }));
    m.send({ kind: "longPressFired" });

    expect(m.send({ kind: "move", x: 400, y: 300, at: 600, turn: PAGE }).intents).toEqual([
      { kind: "extendSelection", from: { x: 200, y: 300 }, to: { x: 400, y: 300 } },
    ]);
  });

  it("and that stroke never turns a page, however far sideways it goes", () => {
    // The interleaving this whole file exists for: the same 200px of travel is a page turn on a
    // press that was not selecting, and an extension on one that was.
    const m = machine();
    m.send(press());
    m.send({ kind: "longPressFired" });
    const asked = kinds(m.send({ kind: "move", x: 0, y: 300, at: 600, turn: PAGE }).intents);
    expect(asked).not.toContain("beginTurn");
  });

  it("hands the press back when there was no word under it", () => {
    // A margin, a picture, the gap between paragraphs. The press carries on being whatever it
    // would otherwise have been — including a page turn, if it starts travelling.
    const m = machine();
    m.send(press());
    m.send({ kind: "longPressFired" });
    m.send({ kind: "selectionRefused" });

    expect(kinds(m.send({ kind: "move", x: 100, y: 300, at: 600, turn: null }).intents)).toContain(
      "beginTurn",
    );
  });

  it("lets the selection settle when the finger lifts, and spends the press on it", () => {
    // Nothing else may read that release: it neither raises the chrome nor puts the selection
    // back down. [[Marking]] waits for the finger either way (CONTEXT.md [[chrome]]).
    const m = machine();
    m.send(press());
    m.send({ kind: "longPressFired" });

    expect(kinds(m.send(release({ at: LONG_PRESS_MS + 100 })).intents)).toEqual([
      "settleSelection",
    ]);
  });

  it("settles it when the finger lets go somewhere no surface of ours can see", () => {
    // A tablet's page buttons stand either side of the book, and a release over one of those
    // reaches neither frond's listeners nor the margin's. Without this the selection stays live
    // for good: the colour row never appears.
    const m = machine();
    m.send(press());
    m.send({ kind: "longPressFired" });

    expect(kinds(m.send({ kind: "strayRelease" }).intents)).toEqual(["settleSelection"]);
  });

  it("settles rather than drops it when the system takes the finger away mid-selection", () => {
    // An edge gesture, a call coming in. What has been selected stands: throwing it away would
    // be taking the reader's work over something they did not do.
    const m = machine();
    m.send(press());
    m.send({ kind: "longPressFired" });

    const asked = kinds(m.send({ kind: "cancel" }).intents);
    expect(asked).toContain("settleSelection");
    expect(asked).not.toContain("dropSelection");
  });

  it("has nothing to settle when no selection was being made", () => {
    expect(machine().send({ kind: "strayRelease" }).intents).toEqual([]);
  });
});

describe("Dragging the page", () => {
  it("does not begin until the finger has gone sideways past the slop", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send({ kind: "move", x: 194, y: 300, at: 16, turn: null }).intents)).toEqual([]);
  });

  it("nor for a finger going down the page, which is asking for something else", () => {
    const m = machine();
    m.send(press());
    const asked = kinds(m.send({ kind: "move", x: 190, y: 400, at: 16, turn: null }).intents);
    expect(asked).not.toContain("beginTurn");
  });

  it("carries whatever was selected off with the page it was on", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send({ kind: "move", x: 100, y: 300, at: 16, turn: null }).intents)).toContain(
      "dropSelection",
    );
  });

  it("still turns for a reader who pressed, hesitated, and then swiped", () => {
    // The promise the drag's time-blindness is there to keep. Three seconds of hesitation, and a
    // long press that has already fired and found nothing.
    const m = machine();
    m.send(press({ at: 0 }));
    m.send({ kind: "longPressFired" });
    m.send({ kind: "selectionRefused" });

    expect(kinds(m.send({ kind: "move", x: 100, y: 300, at: 3000, turn: null }).intents)).toContain(
      "beginTurn",
    );
  });

  it("moves nothing for a finger sitting exactly on the slop, and is no longer a long press", () => {
    // The edge the deleted `travelled` tests used to hold, and the two predicates do not agree at
    // it: ten pixels is already outside the patch a still finger stays in, and not yet past the
    // travel a drag needs. So the press is neither any more — which is the honest answer, because
    // a finger at exactly the slop has not said which it is.
    const m = machine();
    m.send(press({ x: 200 }));
    expect(kinds(m.send({ kind: "move", x: 190, y: 300, at: 16, turn: null }).intents)).toEqual([
      "cancelLongPress",
    ]);
  });

  it("moves the page by the finger's travel, less the slop that decided it was a drag", () => {
    // Counting the slop in would make the page jump by that much the instant the drag begins.
    const m = machine();
    m.send(press({ x: 200 }));
    m.send({ kind: "move", x: 150, y: 300, at: 16, turn: null });

    expect(m.send({ kind: "move", x: 100, y: 300, at: 32, turn: PAGE }).intents).toEqual([
      { kind: "moveTurn", distance: 90 },
    ]);
  });

  it("asks for the other page when the finger comes back the other way", () => {
    // Dragged back past where it started and on: that is the other page being asked for, so the
    // turn is swapped rather than pinned at zero with the reader pushing at a dead page.
    const m = machine({ rtl: false });
    m.send(press({ x: 200 }));
    m.send({ kind: "move", x: 150, y: 300, at: 16, turn: null });
    const back = m.send({ kind: "move", x: 260, y: 300, at: 48, turn: PAGE }).intents;

    // And nothing moves on that frame: how far the *new* page may travel, and whether it is
    // against the end of the book, are its own measurements and have not been taken yet. Moving
    // it by the old turn's numbers is how a swap onto the first page stops resisting.
    expect(kinds(back)).toEqual(["dropTurn", "beginTurn"]);
    expect(back[1]).toEqual({ kind: "beginTurn", towards: "prev", from: "left" });
  });

  it("tries again on the next move when frond had no page to turn to", () => {
    // `beginTurn` came back empty — the caller has no turn — and the reader is still dragging.
    const m = machine();
    m.send(press({ x: 200 }));
    expect(kinds(m.send({ kind: "move", x: 150, y: 300, at: 16, turn: null }).intents)).toContain(
      "beginTurn",
    );
    expect(kinds(m.send({ kind: "move", x: 120, y: 300, at: 32, turn: null }).intents)).toContain(
      "beginTurn",
    );
  });

  it("takes the page when the drag went past a third of it, and puts the chrome away", () => {
    // The whole of what [[Find]] ending on a page turn is made of, on this route.
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 350, y: 300, at: 16, turn: null });
    m.send({ kind: "move", x: 100, y: 300, at: 200, turn: PAGE });

    const done = m.send(release({ x: 100, at: 220, turn: PAGE })).intents;
    expect(kinds(done)).toEqual(["lowerChrome", "commitTurn"]);
    expect(done[1]).toEqual({ kind: "commitTurn", from: 290, to: 600 });
  });

  it("puts it back when the drag stopped short, and leaves the chrome where it was", () => {
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 350, y: 300, at: 100, turn: null });
    m.send({ kind: "move", x: 340, y: 300, at: 400, turn: PAGE });

    const done = m.send(release({ x: 340, at: 500, turn: PAGE })).intents;
    expect(done).toEqual([{ kind: "cancelTurn", from: 50, to: 0 }]);
  });

  it("takes a flick that barely moved, because distance alone is what 'nothing happened' is", () => {
    // A thumb on a phone: 40px and gone. Well short of a third of the page.
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 386, y: 300, at: 0, turn: null });
    m.send({ kind: "move", x: 373, y: 300, at: 2, turn: PAGE });
    m.send({ kind: "move", x: 360, y: 300, at: 4, turn: PAGE });

    const done = m.send(release({ x: 360, at: 6, turn: PAGE })).intents;
    expect(kinds(done)).toEqual(["lowerChrome", "commitTurn"]);
  });

  it("refuses a flick that turned back at the last moment", () => {
    // Speed is measured along the drag's own direction: the finger was heading home.
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 340, y: 300, at: 0, turn: null });
    m.send({ kind: "move", x: 355, y: 300, at: 2, turn: PAGE });
    m.send({ kind: "move", x: 370, y: 300, at: 4, turn: PAGE });

    expect(m.send(release({ x: 370, at: 6, turn: PAGE })).intents).toEqual([
      { kind: "cancelTurn", from: 20, to: 0 },
    ]);
  });

  it("never takes a page at the ends of the book, however hard it is pulled", () => {
    // It moves and it resists: something moved, so the book is not stuck; it fought back, so this
    // is the end. What is pinned is that it stopped well short of the finger.
    const m = machine();
    m.send(press({ x: 100 }));
    m.send({ kind: "move", x: 150, y: 300, at: 16, turn: null });
    const pulled = m.send({
      kind: "move",
      x: 500,
      y: 300,
      at: 200,
      turn: { extent: 600, atBoundary: true },
    }).intents[0];

    expect(pulled).toMatchObject({ kind: "moveTurn" });
    const distance = (pulled as { kind: "moveTurn"; distance: number }).distance;
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(600 * 0.25);

    const done = m.send(
      release({ x: 500, at: 220, turn: { extent: 600, atBoundary: true } }),
    ).intents;
    // And it settles from where it was drawn: the same damping, not the raw travel.
    expect(done).toEqual([{ kind: "cancelTurn", from: distance, to: 0 }]);
  });

  it("puts the turn back where it was when the system takes the finger away", () => {
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 300, y: 300, at: 16, turn: null });

    expect(kinds(m.send({ kind: "cancel" }).intents)).toEqual(["dropTurn"]);
  });

  it("gives a mouse no drag at all: the desk has buttons and keys, and a drag there selects", () => {
    const m = machine();
    m.send(press({ pointerType: "mouse", x: 400 }));
    expect(m.send({ kind: "move", x: 200, y: 300, at: 16, turn: null }).intents).toEqual([]);
  });

  it("leaves the page still while the reader is adjusting a browser-drawn selection", () => {
    // Only where the browser draws it. Where the handles are ours they claim their own presses,
    // so a press anywhere else is what it looks like: a page turn.
    const browser = machine({ ownSelection: false });
    browser.send(press({ hasSelection: true, x: 400 }));
    expect(browser.send({ kind: "move", x: 200, y: 300, at: 16, turn: null }).intents).toEqual([]);

    const ours = machine({ ownSelection: true });
    ours.send(press({ hasSelection: true, x: 400 }));
    expect(
      kinds(ours.send({ kind: "move", x: 200, y: 300, at: 16, turn: null }).intents),
    ).toContain("beginTurn");
  });

  it("reads the same finger the other way round in a right-opening book", () => {
    const m = machine({ rtl: true });
    m.send(press({ x: 200 }));
    expect(m.send({ kind: "move", x: 250, y: 300, at: 16, turn: null }).intents).toEqual([
      { kind: "cancelLongPress" },
      { kind: "beginTurn", towards: "next", from: "left" },
      { kind: "dropSelection" },
    ]);
  });
});

describe("A tap, and the one thing it is spent on", () => {
  it("toggles the chrome", () => {
    const m = machine();
    m.send(press());
    expect(kinds(m.send(release()).intents)).toEqual(["cancelLongPress", "toggleChrome"]);
  });

  it("opens the note of a highlight it landed on, and nothing else", () => {
    const m = machine();
    m.send(press());
    expect(m.send(release({ onHighlight: "ann-7" })).intents).toEqual([
      { kind: "cancelLongPress" },
      { kind: "openNote", annotationId: "ann-7" },
    ]);
  });

  it("belongs to a link it landed on", () => {
    const m = machine();
    m.send(press({ isLink: true }));
    expect(kinds(m.send(release({ isLink: true })).intents)).toEqual(["cancelLongPress"]);
  });

  it("puts a standing selection down instead of moving the chrome — one press, one thing", () => {
    const m = machine();
    m.send(press({ hasSelection: true }));
    const done = kinds(m.send(release({ hasSelection: true })).intents);
    expect(done).toContain("dropSelection");
    expect(done).not.toContain("toggleChrome");
  });

  it("dismisses one the app drew as well, which frond cannot see", () => {
    // Where the selection is ours, frond's answer is permanently no — so a tap would stop being
    // the way to dismiss a selection on exactly the devices where it is the only way.
    const m = machine();
    m.send(press());
    expect(kinds(m.send(release({ showingSelection: true })).intents)).toContain("dropSelection");
  });

  it("is not a tap once it has travelled, and the release has nothing left to decide", () => {
    const m = machine();
    m.send(press({ x: 200 }));
    expect(kinds(m.send(release({ x: 100, at: 200 })).intents)).toEqual(["cancelLongPress"]);
  });

  it("is not a tap once it has been held past half a second", () => {
    const m = machine();
    m.send(press({ at: 0 }));
    expect(kinds(m.send(release({ at: 900 })).intents)).toEqual(["cancelLongPress"]);
  });
});

describe("A word the tap selected, not a passage the reader chose (#36)", () => {
  it("blames the tap for a selection that turns up right after it", () => {
    // Chrome for Android's Touch to Search: the selection is real and frond reports it exactly as
    // it reports a deliberate one. What separates them is when the tap was.
    const m = machine();
    m.send(press({ at: 0 }));
    m.send(release({ at: 90 }));

    expect(m.blamesTapForSelection(120)).toBe(true);
  });

  it("stops blaming it once the window has passed", () => {
    const m = machine();
    m.send(press({ at: 0 }));
    m.send(release({ at: 90 }));

    expect(m.blamesTapForSelection(90 + TAP_SELECTION_GRACE_MS)).toBe(false);
  });

  it("closes the window on the next press: from there the reader is driving", () => {
    // Which is what makes a tap, then a drag to select, still select.
    const m = machine();
    m.send(press({ at: 0 }));
    m.send(release({ at: 90 }));
    m.send(press({ at: 120 }));

    expect(m.blamesTapForSelection(140)).toBe(false);
  });

  it("blames nothing before the first tap of all", () => {
    expect(machine().blamesTapForSelection(0)).toBe(false);
  });

  it("blames nothing for a press that turned a page", () => {
    const m = machine();
    m.send(press({ x: 400, at: 0 }));
    m.send({ kind: "move", x: 200, y: 300, at: 16, turn: null });
    m.send(release({ x: 200, at: 200, turn: PAGE }));

    expect(m.blamesTapForSelection(220)).toBe(false);
  });
});

describe("Dragging a selection by one of its two ends", () => {
  const ends: SelectionEnds = {
    start: { point: { x: 100, y: 200 }, anchor: { x: 104, y: 200 }, span: 20 },
    end: { point: { x: 300, y: 200 }, anchor: { x: 296, y: 200 }, span: 20 },
  };

  it("extends away from the end that is not moving", () => {
    // The whole difference between this and a long press, and why both can share one anchor.
    const m = machine();
    m.send({ kind: "handleDown", end: "start", point: { x: 100, y: 200 }, ends });

    expect(m.send({ kind: "handleMove", point: { x: 60, y: 200 } }).intents).toEqual([
      { kind: "extendSelection", from: ends.end.anchor, to: { x: 60, y: 200 } },
    ]);
  });

  it("takes the nearer handle, not the one the DOM happened to put on top", () => {
    // A long press selects one word, and one word puts the two hit regions over each other; the
    // press then goes to whichever element is on top, which need not be the one aimed at.
    const m = machine();
    m.send({ kind: "handleDown", end: "start", point: { x: 298, y: 200 }, ends });

    expect(m.send({ kind: "handleMove", point: { x: 340, y: 200 } }).intents).toEqual([
      { kind: "extendSelection", from: ends.start.anchor, to: { x: 340, y: 200 } },
    ]);
  });

  it("holds [[Marking]] down while the finger is on it, and lets it up when the finger goes", () => {
    // A colour row raised mid-drag appears under the finger that raised it and then chases the
    // selection across the page (CONTEXT.md [[chrome]]).
    const m = machine();
    expect(
      kinds(m.send({ kind: "handleDown", end: "end", point: { x: 300, y: 200 }, ends }).intents),
    ).toEqual(["holdSelection"]);
    expect(kinds(m.send({ kind: "strayRelease" }).intents)).toEqual(["settleSelection"]);
  });

  it("has nothing to extend before a handle is taken hold of", () => {
    expect(machine().send({ kind: "handleMove", point: { x: 60, y: 200 } }).intents).toEqual([]);
  });
});

describe("A page turn nobody dragged, and the chrome going with it", () => {
  it("a page button or an arrow key turns the page and puts the chrome away", () => {
    // The half that had no test at all: dragging had one browser spec proving it, and these two
    // routes had nothing — the comment claiming "whichever gesture asked for it" was one route's
    // worth of evidence.
    //
    // **One test rather than two, because the two collapse here.** A button and an arrow key are
    // different wires in `Reader.tsx` and the same event by the time they arrive, which is the
    // point of routing them through one machine: there is no longer a way for one of them to
    // lower the chrome and the other to forget.
    const m = machine({ rtl: false });
    expect(m.send({ kind: "side", side: "right" }).intents).toEqual([
      { kind: "lowerChrome" },
      { kind: "commandTurn", towards: "next" },
    ]);
    expect(m.send({ kind: "side", side: "left" }).intents).toEqual([
      { kind: "lowerChrome" },
      { kind: "commandTurn", towards: "prev" },
    ]);
  });

  it("inverts which page that is in a right-opening book, and still puts the chrome away", () => {
    const m = machine({ rtl: true });
    expect(m.send({ kind: "side", side: "left" }).intents).toEqual([
      { kind: "lowerChrome" },
      { kind: "commandTurn", towards: "next" },
    ]);
  });

  it("does not disturb a gesture already in progress", () => {
    // A reader leaning on the arrow key with a finger still on the page is not a case anyone
    // designed for, and the two must not consume each other's state.
    const m = machine();
    m.send(press({ x: 400 }));
    m.send({ kind: "move", x: 300, y: 300, at: 16, turn: null });
    m.send({ kind: "side", side: "right" });

    expect(kinds(m.send({ kind: "move", x: 250, y: 300, at: 32, turn: PAGE }).intents)).toEqual([
      "moveTurn",
    ]);
  });
});
