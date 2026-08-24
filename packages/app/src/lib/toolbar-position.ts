// Where to place the highlight toolbar relative to a text selection.
//
// Anchoring the toolbar to the selection (instead of pinning it to the bottom of
// the viewport) sidesteps a bug we cannot detect from JS: on Android Chrome a
// native contextual-search bar slides up from the very bottom during selection.
// That bar is browser chrome — not in the DOM, not visible to `visualViewport` —
// so we can't measure it. Keeping the toolbar next to the selection means it is
// never in the bottom strip the native bar occupies.

export interface SelectionAnchor {
  top: number; // selection top edge, in top-window viewport coordinates
  bottom: number; // selection bottom edge
  left: number; // selection left edge
  right: number; // selection right edge
  midX: number; // horizontal midpoint of the selection
  midY: number; // vertical midpoint of the selection
}

export interface Size {
  width: number;
  height: number;
}

export interface ToolbarPlacement {
  left: number;
  top: number;
  /**
   * Which side of the passage the toolbar ended up on.
   *
   * The toolbar carries a wedge that points at the passage it is about, and this is the side
   * the wedge hangs off — `"below"`/`"above"` in a horizontal book, `"left"`/`"right"` in a
   * vertical one, where the toolbar sits beside the selection rather than under it. It is
   * reported rather than left to the caller because the caller would have to compare the same
   * numbers this function has just compared, and a wedge pointing away from the text is worse
   * than no wedge at all.
   */
  side: "below" | "above" | "left" | "right";
}

/**
 * The space left between the selection and the toolbar.
 *
 * **It is the room a selection handle needs, not a margin.** On touch the two ends of a
 * selection carry draggable handles: the stem reaches `HANDLE_REACH_PX` past the edge of the
 * text and the bead sits at the end of it (`selection-handles.ts`). At the 8px this used to be
 * — a number from the days when a native selection had nothing at its edges — the toolbar
 * landed on the far handle, and what it covered was not the 11px bead but the 44px the finger
 * actually aims at. The symptom is one end of the selection dragging and the other not, with
 * nothing on screen to say why.
 *
 * **The desk pays it too.** There are no handles under a mouse, so the 16px is spent on
 * nothing there — and one number for both is what stops someone changing the touch case alone
 * and leaving the desk behind.
 */
const HANDLE_CLEARANCE_PX = 24;

interface Options {
  gap?: number; // space between selection and toolbar; `HANDLE_CLEARANCE_PX` by default
  margin?: number; // minimum distance from the viewport edges
  // Height of the reserved strip at the bottom of the viewport. Android Chrome's
  // native contextual-search bar slides up into this region during selection, so
  // the toolbar flips above the selection rather than land inside it — even when
  // it would technically still fit on-screen.
  bottomSafe?: number;
  // A vertically-written book (frond's `vertical-rl`). A selection there is a tall strip and
  // runs along the block axis, so the toolbar sits **beside** it — below/above would land the
  // bar far under the passage and over the lines the reader has not selected yet (the 直排 bug
  // in #52). Which edge of the text a mark runs along is the same fact `HighlightLayer` needs.
  vertical?: boolean;
}

export interface Origin {
  left: number;
  top: number;
}

// The anchor for a selection frond has just reported.
//
// frond gives the selection's rectangles in **container** coordinates (its `SelectionEvent`
// carries them, so there is no CFI round trip); `placeSelectionToolbar` works in top-window
// viewport coordinates, because that is where the toolbar is drawn. This is the whole
// conversion between the two, and the one place the container's own position enters it.
//
// A selection spanning several lines has one rectangle per line, so the anchor takes the
// union: the toolbar should clear the whole selection, not just its first line.
export function anchorFromRects(
  rects: readonly { x: number; y: number; width: number; height: number }[],
  container: Origin,
): SelectionAnchor | null {
  if (rects.length === 0) return null;

  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;

  for (const rect of rects) {
    top = Math.min(top, rect.y);
    bottom = Math.max(bottom, rect.y + rect.height);
    left = Math.min(left, rect.x);
    right = Math.max(right, rect.x + rect.width);
  }

  return {
    top: container.top + top,
    bottom: container.top + bottom,
    left: container.left + left,
    right: container.left + right,
    midX: container.left + (left + right) / 2,
    midY: container.top + (top + bottom) / 2,
  };
}

export function placeSelectionToolbar(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  { gap = HANDLE_CLEARANCE_PX, margin = 8, bottomSafe = 96, vertical = false }: Options = {},
): ToolbarPlacement {
  if (vertical) return placeBeside(anchor, toolbar, viewport, gap, margin);

  // Centre on the selection midpoint along the cross axis, clamped inside the viewport.
  const rawLeft = anchor.midX - toolbar.width / 2;
  const left = clamp(rawLeft, margin, viewport.width - toolbar.width - margin);

  // Prefer just below the selection, but flip above if that would put the toolbar into the
  // reserved bottom strip (the native-bar zone).
  let top = anchor.bottom + gap;
  if (top + toolbar.height > viewport.height - bottomSafe) {
    top = anchor.top - gap - toolbar.height;
  }
  // If flipping above also overflows the top, clamp back into view.
  top = clamp(top, margin, viewport.height - toolbar.height - margin);

  // Read off the placement that survived the clamp, not off the intention before it: when
  // nothing fits the toolbar lands over the selection, and that is not "above" it.
  return { left, top, side: top + toolbar.height <= anchor.top ? "above" : "below" };
}

// A vertical book: the toolbar goes beside the tall selection, centred on it along the block
// axis. Prefer the left of the passage — in a `vertical-rl` book that is the side the reading
// moves towards — and flip to the right when the left would run off the edge, mirroring the
// below/above choice of the horizontal case.
function placeBeside(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  gap: number,
  margin: number,
): ToolbarPlacement {
  const rawTop = anchor.midY - toolbar.height / 2;
  const top = clamp(rawTop, margin, viewport.height - toolbar.height - margin);

  let left = anchor.left - gap - toolbar.width;
  if (left < margin) left = anchor.right + gap;
  left = clamp(left, margin, viewport.width - toolbar.width - margin);

  // Which side the clamp left it on, so the wedge points across the passage rather than away.
  // When nothing fits and the bar lands over the text, default the wedge to the left edge.
  const side = left >= anchor.right ? "right" : "left";
  return { left, top, side };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min; // viewport smaller than the toolbar: pin to the near edge
  return Math.max(min, Math.min(value, max));
}
