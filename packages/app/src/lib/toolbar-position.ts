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
  midX: number; // horizontal midpoint of the selection
}

export interface Size {
  width: number;
  height: number;
}

export interface ToolbarPlacement {
  left: number;
  top: number;
  /**
   * Whether the toolbar ended up above the selection rather than below it.
   *
   * The toolbar carries a wedge that points at the passage it is about, and which way it
   * points is this answer. It is reported rather than left to the caller because the caller
   * would have to compare the same two numbers this function has just compared — and a wedge
   * pointing away from the text is worse than no wedge at all.
   */
  above: boolean;
}

interface Options {
  gap?: number; // vertical space between selection and toolbar
  margin?: number; // minimum distance from the viewport edges
  // Height of the reserved strip at the bottom of the viewport. Android Chrome's
  // native contextual-search bar slides up into this region during selection, so
  // the toolbar flips above the selection rather than land inside it — even when
  // it would technically still fit on-screen.
  bottomSafe?: number;
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
    midX: container.left + (left + right) / 2,
  };
}

export function placeSelectionToolbar(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  { gap = 8, margin = 8, bottomSafe = 96 }: Options = {},
): ToolbarPlacement {
  // Horizontal: centre on the selection midpoint, clamped inside the viewport.
  const rawLeft = anchor.midX - toolbar.width / 2;
  const left = clamp(rawLeft, margin, viewport.width - toolbar.width - margin);

  // Vertical: prefer just below the selection, but flip above if that would put
  // the toolbar into the reserved bottom strip (the native-bar zone).
  let top = anchor.bottom + gap;
  if (top + toolbar.height > viewport.height - bottomSafe) {
    top = anchor.top - gap - toolbar.height;
  }
  // If flipping above also overflows the top, clamp back into view.
  top = clamp(top, margin, viewport.height - toolbar.height - margin);

  // Read off the placement that survived the clamp, not off the intention before it: when
  // nothing fits the toolbar lands over the selection, and that is not "above" it.
  return { left, top, above: top + toolbar.height <= anchor.top };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min; // viewport smaller than the toolbar: pin to the near edge
  return Math.max(min, Math.min(value, max));
}
