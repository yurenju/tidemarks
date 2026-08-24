// Where the two ends of a selection are, and which of them a finger has landed on. Whether a
// handle really drags the selection is packages/app/tests/browser/reader/touch-selection.spec.ts.
import { describe, it, expect } from "vitest";
import { handleAt, HANDLE_HIT_PX, selectionEnds } from "./selection-handles";

// One line of a horizontal book, and two lines of one.
const line = { x: 100, y: 200, width: 80, height: 20 };
const nextLine = { x: 60, y: 220, width: 120, height: 20 };

describe("selectionEnds", () => {
  it("hangs the handles off opposite edges of a horizontal passage", () => {
    // The reading runs left to right and down, so the passage begins at the left of its first
    // line and ends at the right of its last — and the two beads sit on opposite edges, the
    // leading one above its line and the trailing one below. On a one-word selection that is
    // the only thing telling the reader which end they are about to take hold of.
    const ends = selectionEnds([line, nextLine], false);
    expect(ends).toEqual({ start: { x: 100, y: 200 }, end: { x: 180, y: 240 } });
  });

  it("turns the pair ninety degrees in a vertical book", () => {
    // A vertical line is a tall strip and the next one is to its left, so the passage begins at
    // the top of the first strip and ends at the bottom of the last — and the handles hang off
    // the right and left edges rather than above and below. Reading this off the wrong axis is
    // invisible to a type checker and puts both handles over text the reader has not selected.
    const strip = { x: 300, y: 100, width: 20, height: 80 };
    const nextStrip = { x: 280, y: 100, width: 20, height: 120 };
    const ends = selectionEnds([strip, nextStrip], true);
    expect(ends).toEqual({ start: { x: 320, y: 100 }, end: { x: 280, y: 220 } });
  });

  it("has no ends when the selection has no geometry", () => {
    expect(selectionEnds([], false)).toBeNull();
  });
});

describe("handleAt", () => {
  const ends = { start: { x: 100, y: 220 }, end: { x: 180, y: 240 } };

  it("claims a press that landed near a handle but not on the bead", () => {
    // The bead is 11px and the finger is not: a press half the hit size away from the centre
    // is still that handle's. This is the whole reason the two sizes are separate numbers.
    expect(handleAt({ x: 100 + HANDLE_HIT_PX / 2 - 1, y: 220 }, ends)).toBe("start");
  });

  it("leaves a press outside the hit region to the page", () => {
    // Which is what keeps a swipe that begins near the passage a page turn.
    expect(handleAt({ x: 100 + HANDLE_HIT_PX, y: 220 }, ends)).toBeNull();
  });

  it("gives an ambiguous press to the nearer handle", () => {
    // A one-word selection puts the two handles within a finger of each other, and both claim
    // the press. Answering "start" whenever it matches first would make the end handle
    // undraggable on exactly the selection a long press produces.
    const tight = { start: { x: 100, y: 220 }, end: { x: 120, y: 220 } };
    expect(handleAt({ x: 118, y: 220 }, tight)).toBe("end");
  });
});
