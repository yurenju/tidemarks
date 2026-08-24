// Where the selection toolbar lands, in viewport coordinates: under the passage, flipped above
// it near the bottom edge, clamped at both sides, and which way its wedge points. Whether it
// really lands there over a real selection is packages/app/tests/browser/reader/highlights.spec.ts.
import { describe, it, expect } from "vitest";
import { anchorFromRects, placeSelectionToolbar, type SelectionAnchor } from "./toolbar-position";
import { HANDLE_CLEARANCE_PX } from "./selection-handles";

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

describe("placeSelectionToolbar", () => {
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

  it("goes to the end of the passage when neither side has room", () => {
    // A passage taller than the screen has no room below it and none above: clamping alone
    // lands the row at the top margin, which is over the line the reader started from and over
    // the start handle with it. The end of the passage is where the finger just was.
    const anchor = hAnchor(10, 790, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top + toolbar.height).toBe(vp.height - 8);
  });

  it("keeps the room under a passage on a screen too short to reserve the whole bottom strip", () => {
    // A landscape phone: 343px tall, and the 96px reserve is 28% of it. Reserved outright, a
    // selection ending at 200 has nowhere to put a 62px row — below is refused by the reserve,
    // above does not fit either — and the row lands back on the passage. Capping the reserve at
    // a fifth of the height is what keeps it under the text where the reader is looking.
    const landscape = { width: 734, height: 343 };
    const row = { width: 470, height: 62 };
    const p = placeSelectionToolbar(hAnchor(37, 200, 367), row, landscape);
    expect(p.top).toBeGreaterThanOrEqual(200);
    expect(p.side).toBe("below");
  });

  it("flips above the selection when placing below would overflow the bottom", () => {
    // selection near the bottom edge — this is the Android-Chrome case where the
    // native search bar occupies the bottom; the toolbar must never land there
    const anchor = hAnchor(720, 760, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(anchor.top);
    expect(p.top).toBeLessThan(vp.height - toolbar.height); // not in the bottom strip
  });

  it("flips above when placing below would land in the reserved bottom strip", () => {
    // real case caught in-browser: the toolbar technically fits on-screen but its
    // bottom edge falls in the native-bar zone — it must still flip above
    const anchor = hAnchor(681, 724, 187);
    const p = placeSelectionToolbar(
      anchor,
      { width: 339, height: 54 },
      { width: 375, height: 812 },
    );
    expect(p.top + 54).toBeLessThanOrEqual(anchor.top);
    expect(p.top + 54).toBeLessThan(812 - 96); // clear of the bottom safe strip
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

  // The wedge on the toolbar points at the passage the toolbar is about, so the placement has
  // to say which side it ended up on. Deriving it at the call site would mean comparing the
  // same two numbers this function has already compared, and getting it wrong points the
  // wedge at nothing.
  it("reports that it is below the selection when it sits below", () => {
    const anchor = hAnchor(200, 240, 200);
    expect(placeSelectionToolbar(anchor, toolbar, vp).side).toBe("below");
  });

  it("reports that it is above the selection when it flips", () => {
    const anchor = hAnchor(720, 760, 200);
    expect(placeSelectionToolbar(anchor, toolbar, vp).side).toBe("above");
  });

  it("is not above the selection when it had to be clamped over it", () => {
    // Nothing fits: the toolbar lands on top of the passage. It is not above it, so the wedge
    // keeps its default direction rather than pointing away from the text.
    const anchor = hAnchor(10, 790, 200);
    expect(placeSelectionToolbar(anchor, toolbar, vp).side).toBe("below");
  });
});

// A vertically-written book: the toolbar goes beside the tall selection, not under it, so it
// clears the lines the reader has not selected yet (the 直排 bug in #52).
describe("placeSelectionToolbar in a vertical book", () => {
  // A bar narrow enough to sit beside a column. Where the bar is wider than the room on either
  // side of the passage — a full-width bar on a narrow phone — it cannot go beside at all, and
  // how that case should look is the rendering half of #52, on a device.
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

  it("prefers the left of the passage and points its wedge back at it", () => {
    const p = placeSelectionToolbar(rightward, vToolbar, vp, { vertical: true });
    expect(p.side).toBe("left");
    expect(p.left + vToolbar.width).toBeLessThanOrEqual(rightward.left);
  });

  it("flips to the right when there is no room on the left", () => {
    // A selection hard against the left edge — the last column of a vertical-rl book.
    const leftward = { top: 200, bottom: 500, left: 20, right: 80, midX: 50, midY: 350 };
    const p = placeSelectionToolbar(leftward, vToolbar, vp, { vertical: true });
    expect(p.side).toBe("right");
    expect(p.left).toBeGreaterThanOrEqual(leftward.right);
  });

  it("goes across the passage when neither side of the column has room for it", () => {
    // A row nearly as wide as a phone cannot sit beside a column. Clamped back into view it used
    // to land across the middle of the passage, on whichever handle was there; under it is at
    // one end instead. The gap clears the handle's 44px hit region rather than just the text,
    // because a vertical bead is centred on the passage's own bottom edge.
    const wide = { width: 360, height: 48 };
    const column = { top: 100, bottom: 400, left: 180, right: 240, midX: 210, midY: 250 };
    const p = placeSelectionToolbar(column, wide, vp, { vertical: true });
    expect(p.side).toBe("below");
    expect(p.top).toBeGreaterThanOrEqual(column.bottom + HANDLE_CLEARANCE_PX + 22);
  });

  it("keeps the toolbar on-screen when the selection spans the whole height", () => {
    const tall = { top: 10, bottom: 790, left: 300, right: 360, midX: 330, midY: 400 };
    const p = placeSelectionToolbar(tall, vToolbar, vp, { vertical: true });
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + vToolbar.height).toBeLessThanOrEqual(vp.height);
  });

  it("keeps the toolbar on-screen when the selection fills the viewport height", () => {
    // no room below and flipping above also overflows the top → clamp into view
    const anchor = hAnchor(10, 790, 200);
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(vp.height);
  });
});
