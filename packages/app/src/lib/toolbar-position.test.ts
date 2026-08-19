import { describe, it, expect } from "vitest";
import { anchorFromRects, placeSelectionToolbar } from "./toolbar-position";

const vp = { width: 400, height: 800 };
const toolbar = { width: 300, height: 48 };

// frond reports a selection's rectangles in **container** coordinates, on the event itself.
// The toolbar is drawn on the top window, so the container's own position is the whole
// conversion — and getting it wrong is the class of bug that puts the toolbar a page away
// from the text it belongs to.
describe("anchorFromRects", () => {
  const container = { left: 40, top: 100 };

  it("offsets the container position into viewport coordinates", () => {
    const anchor = anchorFromRects([{ x: 10, y: 20, width: 100, height: 24 }], container);
    expect(anchor).toEqual({ top: 120, bottom: 144, midX: 100 });
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
  it("sits just below the selection when there is room", () => {
    const anchor = { top: 200, bottom: 240, midX: 200 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top).toBeGreaterThan(anchor.bottom);
    expect(p.top).toBeLessThan(anchor.bottom + 24); // a small gap, not far away
  });

  it("flips above the selection when placing below would overflow the bottom", () => {
    // selection near the bottom edge — this is the Android-Chrome case where the
    // native search bar occupies the bottom; the toolbar must never land there
    const anchor = { top: 720, bottom: 760, midX: 200 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(anchor.top);
    expect(p.top).toBeLessThan(vp.height - toolbar.height); // not in the bottom strip
  });

  it("flips above when placing below would land in the reserved bottom strip", () => {
    // real case caught in-browser: the toolbar technically fits on-screen but its
    // bottom edge falls in the native-bar zone — it must still flip above
    const anchor = { top: 681, bottom: 724, midX: 187 };
    const p = placeSelectionToolbar(
      anchor,
      { width: 339, height: 54 },
      { width: 375, height: 812 },
    );
    expect(p.top + 54).toBeLessThanOrEqual(anchor.top);
    expect(p.top + 54).toBeLessThan(812 - 96); // clear of the bottom safe strip
  });

  it("centres horizontally on the selection midpoint", () => {
    const anchor = { top: 200, bottom: 240, midX: 200 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left + toolbar.width / 2).toBe(200);
  });

  it("clamps to the right edge when the selection is far right", () => {
    const anchor = { top: 200, bottom: 240, midX: 390 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left + toolbar.width).toBeLessThanOrEqual(vp.width);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("clamps to the left edge when the selection is far left", () => {
    const anchor = { top: 200, bottom: 240, midX: 10 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  // The wedge on the toolbar points at the passage the toolbar is about, so the placement has
  // to say which side it ended up on. Deriving it at the call site would mean comparing the
  // same two numbers this function has already compared, and getting it wrong points the
  // wedge at nothing.
  it("reports that it is below the selection when it sits below", () => {
    const anchor = { top: 200, bottom: 240, midX: 200 };
    expect(placeSelectionToolbar(anchor, toolbar, vp).above).toBe(false);
  });

  it("reports that it is above the selection when it flips", () => {
    const anchor = { top: 720, bottom: 760, midX: 200 };
    expect(placeSelectionToolbar(anchor, toolbar, vp).above).toBe(true);
  });

  it("is not above the selection when it had to be clamped over it", () => {
    // Nothing fits: the toolbar lands on top of the passage. It is not above it, so the wedge
    // keeps its default direction rather than pointing away from the text.
    const anchor = { top: 10, bottom: 790, midX: 200 };
    expect(placeSelectionToolbar(anchor, toolbar, vp).above).toBe(false);
  });

  it("keeps the toolbar on-screen when the selection fills the viewport height", () => {
    // no room below and flipping above also overflows the top → clamp into view
    const anchor = { top: 10, bottom: 790, midX: 200 };
    const p = placeSelectionToolbar(anchor, toolbar, vp);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(vp.height);
  });
});
