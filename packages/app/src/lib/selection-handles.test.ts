// Where the two ends of a selection are, and which of them a finger has landed on. Whether a
// handle really drags the selection is packages/app/tests/browser/reader/touch-selection.spec.ts.
import { describe, it, expect } from "vitest";
import {
  handleAt,
  HANDLE_HIT_PX,
  selectionEnds,
  washRect,
  WASH_BLEED_PX,
} from "./selection-handles";

// One line of a horizontal book, and two lines of one.
const line = { x: 100, y: 200, width: 80, height: 20 };
const nextLine = { x: 60, y: 220, width: 120, height: 20 };
// The same passage in a vertical book: a strip runs down, and the next one is to its left.
const strip = { x: 300, y: 100, width: 20, height: 80 };
const nextStrip = { x: 280, y: 100, width: 20, height: 120 };

describe("selectionEnds", () => {
  it("hangs the beads off opposite edges of a horizontal passage", () => {
    // The reading runs left to right and down, so the passage begins at the left of its first
    // line and ends at the right of its last — and the two beads sit on opposite edges, the
    // leading one above its line and the trailing one below. On a one-word selection that is
    // the only thing telling the reader which end they are about to take hold of.
    const ends = selectionEnds([line, nextLine], false);
    expect(ends?.start.point).toEqual({ x: 100, y: 200 });
    expect(ends?.end.point).toEqual({ x: 180, y: 240 });
  });

  it("turns the pair ninety degrees in a vertical book", () => {
    // A vertical line is a tall strip and the next one is to its left, so the passage begins at
    // the top of the first strip and ends at the bottom of the last — and the handles hang off
    // the right and left edges rather than above and below. Reading this off the wrong axis is
    // invisible to a type checker and puts both handles over text the reader has not selected.
    const ends = selectionEnds([strip, nextStrip], true);
    expect(ends?.start.point).toEqual({ x: 320, y: 100 });
    expect(ends?.end.point).toEqual({ x: 280, y: 220 });
  });

  it("measures each end's span across its own line, not across the passage", () => {
    // The stem is drawn `span` long so that it lies across the wash rather than stopping at its
    // edge (`book.css`). The two ends can sit on lines of different widths — a passage that runs
    // from a title into the prose under it does — so a single number for the pair would draw one
    // of the two stems wrong, and the wrong one is invisible until a book with mixed type sizes
    // is on screen.
    const ends = selectionEnds([strip, nextStrip], true)!;
    expect(ends.start.span).toBe(strip.width + WASH_BLEED_PX);
    expect(ends.end.span).toBe(nextStrip.width + WASH_BLEED_PX);

    // Horizontal takes the line's height, and no bleed: the wash is not let out on that axis.
    const flat = selectionEnds([line, nextLine], false)!;
    expect(flat.start.span).toBe(line.height);
    expect(flat.end.span).toBe(nextLine.height);
  });

  it("keeps the anchors off the boundary, inside the text", () => {
    // **The bead's corner is not a point the range can be held from.** A corner is on the
    // boundary between this line and the next, and `caretPositionFromPoint` answers there with
    // the neighbour: hold the start anchor at the passage's own bottom-left and dragging the
    // *end* handle swallows a whole line at the far end before the finger has moved. So each
    // anchor sits a pixel in along the line and mid-way across it.
    const ends = selectionEnds([line, nextLine], false)!;
    expect(ends.start.anchor).toEqual({ x: 101, y: 210 });
    expect(ends.end.anchor).toEqual({ x: 179, y: 230 });

    // Same claim on the other axis, where the boundary is a column edge rather than a baseline.
    const vertical = selectionEnds([strip, nextStrip], true)!;
    expect(vertical.start.anchor).toEqual({ x: 310, y: 101 });
    expect(vertical.end.anchor).toEqual({ x: 290, y: 219 });
  });

  it("has no ends when the selection has no geometry", () => {
    expect(selectionEnds([], false)).toBeNull();
  });
});

describe("handleAt", () => {
  // Only the beads matter here, so the anchors are the same points: what is under test is which
  // handle a finger claimed, and a finger aims at what it can see.
  // `span` plays no part in a hit test — it is how long the stem is drawn — so any value does.
  const at = (x: number, y: number) => ({ point: { x, y }, anchor: { x, y }, span: 20 });
  const ends = { start: at(100, 220), end: at(180, 240) };

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
    const tight = { start: at(100, 220), end: at(120, 220) };
    expect(handleAt({ x: 118, y: 220 }, tight)).toBe("end");
  });
});

describe("washRect", () => {
  it("lets a vertical strip out sideways and not along the line", () => {
    // The box frond reports for vertical text stops at the glyphs, so the colour has to reach
    // past it to read as a band the characters stand in. Along the line it must not move: one
    // line arrives as several rectangles meeting end to end, and a translucent wash let out
    // there would paint a darker seam at every join.
    expect(washRect(strip, true)).toEqual({
      x: strip.x - WASH_BLEED_PX,
      y: strip.y,
      width: strip.width + WASH_BLEED_PX * 2,
      height: strip.height,
    });
  });

  it("leaves a horizontal line exactly as it arrived", () => {
    // A horizontal box already carries the font's internal leading above and below the letters
    // — it is the one axis where the measurement is generous — so the same bleed here would be
    // a band taller than the line and two selected lines would run together.
    expect(washRect(line, false)).toEqual(line);
  });
});
