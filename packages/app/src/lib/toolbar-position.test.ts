// Where the selection toolbar lands, in viewport coordinates: beside the passage where there is
// room, on a fixed resting line where there is not, and climbing off a handle that is on that
// line. Whether it really lands there over a real selection is
// packages/app/tests/browser/reader/highlights.spec.ts.
import { describe, it, expect } from "vitest";
import {
  anchorFromRects,
  handleBoxes,
  placeSelectionToolbar,
  RESTING_INSET_PX,
  type SelectionAnchor,
} from "./toolbar-position";
import { HANDLE_CLEARANCE_PX } from "./selection-handles";

// Whether a placement lands on any of the boxes it was asked to keep off — the question
// `placeSelectionToolbar` answers internally, asked from outside so a test can name it.
function covers(
  placement: { left: number; top: number },
  toolbar: { width: number; height: number },
  boxes: readonly { left: number; top: number; right: number; bottom: number }[],
): boolean {
  return boxes.some(
    (box) =>
      box.right > placement.left &&
      box.left < placement.left + toolbar.width &&
      box.bottom > placement.top &&
      box.top < placement.top + toolbar.height,
  );
}

const vp = { width: 400, height: 800 };
const toolbar = { width: 300, height: 48 };

// Horizontal placement reads only the block edges and the cross-axis midpoint; the rest of the
// anchor is filled with the midpoint too, so a reader can see at once that the horizontal cases
// do not depend on `left`/`right`.
function hAnchor(top: number, bottom: number, midX: number): SelectionAnchor {
  return { top, bottom, left: midX, right: midX, midX, midY: (top + bottom) / 2 };
}

// frond reports a selection's rectangles in **container** coordinates, on the event itself.
// The toolbar is drawn on the top window, so the container's own position is the whole
// conversion — and getting it wrong is the class of bug that puts the toolbar a page away
// from the text it belongs to.
describe("anchorFromRects", () => {
  const container = { left: 40, top: 100 };

  it("offsets the container position into viewport coordinates", () => {
    const anchor = anchorFromRects([{ x: 10, y: 20, width: 100, height: 24 }], container);
    expect(anchor).toEqual({
      top: 120,
      bottom: 144,
      left: 50,
      right: 150,
      midX: 100,
      midY: 132,
    });
  });

  it("takes the union of a selection spanning several lines", () => {
    // One rectangle per line: the toolbar has to clear the whole selection, not its first
    // line.
    const anchor = anchorFromRects(
      [
        { x: 10, y: 20, width: 100, height: 24 },
        { x: 10, y: 44, width: 60, height: 24 },
      ],
      container,
    );
    expect(anchor).toMatchObject({ top: 120, bottom: 168 });
  });

  it("centres on the widest extent of the selection", () => {
    const anchor = anchorFromRects(
      [
        { x: 0, y: 0, width: 40, height: 10 },
        { x: 60, y: 10, width: 40, height: 10 },
      ],
      container,
    );
    // The union spans 0..100, so the midpoint is 50 plus the container's own left edge.
    expect(anchor?.midX).toBe(90);
  });

  it("has no anchor when the selection has no geometry", () => {
    // A selection scrolled off the current page reports no rectangles, and there is nothing to
    // anchor a toolbar to.
    expect(anchorFromRects([], container)).toBeNull();
  });
});

// **Stage 1**: a side of the passage that is clear of the text and of both handles.
describe("placeSelectionToolbar beside the passage", () => {
  it("sits below the selection, clear of where a handle reaches", () => {
    // The gap is the room a touch handle needs, not decoration: the bead hangs past the edge of
    // the colour, and a toolbar inside it covers the 44px the finger aims at. The number is
    // `HANDLE_CLEARANCE_PX`, read from where the handles are drawn rather than repeated here —
    // a copy of it would go on passing after the handles had changed shape underneath it.
    const anchor = hAnchor(200, 240, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top).toBeGreaterThanOrEqual(anchor.bottom + HANDLE_CLEARANCE_PX);
    expect(p.top).toBeLessThan(anchor.bottom + 48); // beside the passage, not adrift from it
  });

  it("flips above the selection when placing below would overflow the bottom", () => {
    const anchor = hAnchor(720, 760, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(anchor.top);
  });

  it("centres horizontally on the selection midpoint", () => {
    const anchor = hAnchor(200, 240, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left + toolbar.width / 2).toBe(200);
  });

  it("clamps to the right edge when the selection is far right", () => {
    const anchor = hAnchor(200, 240, 390);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left + toolbar.width).toBeLessThanOrEqual(vp.width);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("clamps to the left edge when the selection is far left", () => {
    const anchor = hAnchor(200, 240, 10);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("goes to the side of a horizontal selection when neither below nor above has room", () => {
    // A band of text running the height of the screen but only part of its width: below and
    // above are gone, and beside is left. The old rule listed only two placements for a
    // horizontal book, so it ran out of candidates here and clamped the row back over the text
    // with the room going spare.
    const narrow = { width: 120, height: 40 };
    const band = { top: 10, bottom: 790, left: 200, right: 390, midX: 295, midY: 400 };
    const p = placeSelectionToolbar(band, narrow, vp);
    expect(p.left + narrow.width).toBeLessThanOrEqual(band.left);
  });
});

// A selection with no clear side: it reaches both edges of the screen along both axes, so every
// stage-1 candidate is off-screen. Written out rather than built from `hAnchor`, because a
// zero-width anchor leaves room beside it and would take these cases back to stage 1.
const FILLING: SelectionAnchor = {
  top: 10,
  bottom: 790,
  left: 10,
  right: 390,
  midX: 200,
  midY: 400,
};

// **Stages 2 and 3**: the resting line, and climbing off a handle that is on it.
describe("placeSelectionToolbar at rest", () => {
  // `FILLING` has no side to sit on, so every case here is past stage 1 without saying so again.
  const filling = FILLING;

  it("rests a fixed distance from the bottom edge, centred on the screen", () => {
    const p = placeSelectionToolbar(filling, toolbar, vp);
    expect(p.top + toolbar.height).toBe(vp.height - RESTING_INSET_PX);
    expect(p.left + toolbar.width / 2).toBe(vp.width / 2);
  });

  it("rests in the same place wherever the selection is", () => {
    // What the resting line is for. Two different selections that both defeat stage 1 put the
    // row in one place, so the reader learns where to look instead of hunting for it. The two
    // do not share a midpoint — the row is centred on the screen, not on the passage it has
    // just failed to avoid.
    const offCentre: SelectionAnchor = {
      top: 5,
      bottom: 795,
      left: 80,
      right: 380,
      midX: 230,
      midY: 400,
    };
    expect(placeSelectionToolbar(filling, toolbar, vp)).toEqual(
      placeSelectionToolbar(offCentre, toolbar, vp),
    );
  });

  it("climbs clear of a handle sitting on the resting line", () => {
    // The bead the row would otherwise cover is one the reader can see and cannot press, and
    // with the row's own colours where it should be it reads as a fault in the row.
    const handles = [{ left: 150, top: 730, right: 250, bottom: 780 }];
    const resting = placeSelectionToolbar(filling, toolbar, vp);
    const p = placeSelectionToolbar(filling, toolbar, vp, { handles });

    expect(covers(resting, toolbar, handles)).toBe(true); // the line really is blocked
    expect(covers(p, toolbar, handles)).toBe(false);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(handles[0]!.top);
  });

  it("climbs past both handles rather than off one and onto the other", () => {
    // The mistake the drawing of this rule made first: leaving the lower bead only to land on
    // the upper one. Both, or the climb has done nothing.
    const handles = [
      { left: 150, top: 640, right: 250, bottom: 690 },
      { left: 150, top: 730, right: 250, bottom: 780 },
    ];
    const p = placeSelectionToolbar(filling, toolbar, vp, { handles });
    expect(covers(p, toolbar, handles)).toBe(false);
  });

  it("moves no further than it has to", () => {
    // Lowest clear height wins, so the row stays as near the thumb as the handles allow.
    const handles = [{ left: 150, top: 700, right: 250, bottom: 750 }];
    const p = placeSelectionToolbar(filling, toolbar, vp, { handles });
    expect(p.top + toolbar.height).toBe(handles[0]!.top);
  });

  it("stays on the line when no height clears the handles", () => {
    // Stage 3. A selection reaching across the screen leaves every height covering a bead, and
    // then moving is only a choice of which one to cover — so the row keeps the place the
    // reader expects it in.
    const handles = [
      { left: 150, top: 0, right: 250, bottom: 400 },
      { left: 150, top: 380, right: 250, bottom: 800 },
    ];
    const p = placeSelectionToolbar(filling, toolbar, vp, { handles });
    expect(p.top + toolbar.height).toBe(vp.height - RESTING_INSET_PX);
  });

  it("pins to the near edge when the viewport is shorter than the row", () => {
    // The `max < min` branch in the clamp, which is the only place the arithmetic can invert:
    // the resting line wants a top above zero, and both bounds cross over. The row cannot fit,
    // so all that is left to hold is that it starts on-screen — a row pinned to the far edge
    // instead would be one with none of its four colours reachable.
    const squat = { width: 400, height: 60 };
    const p = placeSelectionToolbar(hAnchor(0, 60, 200), toolbar, squat);
    expect(p.top).toBe(8); // the margin, not a negative top
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + toolbar.width).toBeLessThanOrEqual(squat.width);
  });
});

// A vertically-written book: the selection is a tall column, so the row goes beside it and the
// side it prefers is the one the reading moves towards (the vertical-writing bug in #52).
describe("placeSelectionToolbar in a vertical book", () => {
  // A bar narrow enough to sit beside a column. A full-width bar on a narrow phone cannot, and
  // that is the case the resting line exists for (#56).
  const vToolbar = { width: 200, height: 48 };
  // A tall strip near the right of the viewport — where a vertical-rl selection begins.
  const rightward = { top: 200, bottom: 500, left: 300, right: 360, midX: 330, midY: 350 };

  it("sits beside the selection, centred on it, not under it", () => {
    const p = placeSelectionToolbar(rightward, vToolbar, vp, { vertical: true });
    // Centred on the selection's block-axis midpoint.
    expect(p.top + vToolbar.height / 2).toBe(rightward.midY);
    // Clear of the passage horizontally, not stacked below it.
    expect(p.left + vToolbar.width).toBeLessThanOrEqual(rightward.left);
  });

  it("flips to the right when there is no room on the left", () => {
    // A selection hard against the left edge — the last column of a vertical-rl book.
    const leftward = { top: 200, bottom: 500, left: 20, right: 80, midX: 50, midY: 350 };
    const p = placeSelectionToolbar(leftward, vToolbar, vp, { vertical: true });
    expect(p.left).toBeGreaterThanOrEqual(leftward.right);
  });

  it("goes across the passage when neither side of the column has room for it", () => {
    // A row too wide to sit beside a column, but a column short enough to leave room below it.
    // Beside is tried first and fails; across is still stage 1, and still clear of the text.
    const wide = { width: 360, height: 48 };
    const column = { top: 100, bottom: 400, left: 180, right: 240, midX: 210, midY: 250 };
    const p = placeSelectionToolbar(column, wide, vp, { vertical: true });
    expect(p.top).toBeGreaterThanOrEqual(column.bottom + HANDLE_CLEARANCE_PX);
  });

  it("leaves the passage for the resting line on the phone case that has no room anywhere", () => {
    // Measured on an emulated iPhone, on the vertical book's cover (#56): a column running most
    // of the page, a row too wide to go beside it, and no room above or below either. Every side
    // fails, so the row leaves the passage — and then climbs, because the trailing bead is on
    // the line waiting for it. Stage 2 doing both halves of its job on a real measurement.
    const screen = { width: 393, height: 659 };
    const row = { width: 249, height: 123 };
    const column = { top: 120, bottom: 559, left: 93, right: 235, midX: 164, midY: 339.5 };
    const handles = handleBoxes(
      {
        start: { point: { x: 235, y: 120 }, anchor: { x: 0, y: 0 }, span: 20 },
        end: { point: { x: 93, y: 559 }, anchor: { x: 0, y: 0 }, span: 20 },
      },
      { left: 0, top: 0 },
    );

    const line = screen.height - RESTING_INSET_PX - row.height;
    const p = placeSelectionToolbar(column, row, screen, { vertical: true, handles });

    expect(p.left + row.width / 2).toBe(screen.width / 2);
    expect(p.top).toBeLessThan(line); // it had to climb
    expect(covers(p, row, handles)).toBe(false);
    // And no further than it had to: it sits exactly on top of the bead it was clearing.
    expect(p.top + row.height).toBe(handles[1]!.top);
  });

  it("keeps the toolbar on-screen when the selection spans the whole height", () => {
    const tall = { top: 10, bottom: 790, left: 300, right: 360, midX: 330, midY: 400 };
    const p = placeSelectionToolbar(tall, vToolbar, vp, { vertical: true });
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + vToolbar.height).toBeLessThanOrEqual(vp.height);
  });
});
