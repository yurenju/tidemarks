// Where to place the highlight toolbar relative to a text selection.
//
// Anchoring the toolbar to the selection (instead of pinning it to the bottom of
// the viewport) sidesteps a bug we cannot detect from JS: on Android Chrome a
// native contextual-search bar slides up from the very bottom during selection.
// That bar is browser chrome — not in the DOM, not visible to `visualViewport` —
// so we can't measure it. Keeping the toolbar next to the selection means it is
// never in the bottom strip the native bar occupies.

import { HANDLE_CLEARANCE_PX, HANDLE_HIT_PX } from "./selection-handles";

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
 * selection carry draggable handles, and the bead on each sits past the edge of the colour
 * (`selection-handles.ts`'s `HANDLE_CLEARANCE_PX`). At the 8px this used to be — a number from
 * the days when a native selection had nothing at its edges — the toolbar landed on the far
 * handle, and what it covered was not the 11px bead but the 44px the finger actually aims at.
 * The symptom is one end of the selection dragging and the other not, with nothing on screen to
 * say why.
 *
 * **The desk pays it too.** There are no handles under a mouse, so it is spent on nothing there
 * — and one number for both is what stops someone changing the touch case alone and leaving the
 * desk behind.
 */

interface Options {
  gap?: number; // space between selection and toolbar; `HANDLE_CLEARANCE_PX` by default
  margin?: number; // minimum distance from the viewport edges
  // Height of the reserved strip at the bottom of the viewport. Android Chrome's
  // native contextual-search bar slides up into this region during selection, so
  // the toolbar flips above the selection rather than land inside it — even when
  // it would technically still fit on-screen.
  // **Read as a share of the viewport, not as the number itself**: `reservedBottom` takes the
  // smaller of this and a fifth of the height. 96px is a portrait phone's contextual bar, and on
  // a 343px landscape screen reserving it outright is 28% of everything there is — enough that a
  // toolbar with room under the passage gets pushed off it, fails to fit above, and is clamped
  // back onto the text. Guarding against an overlay that may not be there is not worth landing
  // on the passage every time.
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
  if (vertical) {
    const beside = placeBeside(anchor, toolbar, viewport, gap, margin);
    if (beside !== null) return beside;

    // **Neither side of the column had room, so fall back to the horizontal rule**: under the
    // passage, or over it. A row nearly as wide as a phone cannot go beside a vertical column at
    // all, and clamping it back into view — what this used to do — parks it across the middle of
    // the passage, on whichever handle is there. Above or below is at least at one end of it.
    //
    // **The gap is bigger in this fallback, and it has to be.** A vertical handle hangs off the
    // *side* of its strip, with the bead on the corner: the passage's own bottom edge is where
    // the trailing bead is centred, so clearing the text by `gap` still leaves the row on half
    // the 44px the finger aims at. Clearing the hit region is the whole of what the extra half
    // buys.
    return placeAcross(anchor, toolbar, viewport, gap + HANDLE_HIT_PX / 2, margin, bottomSafe);
  }

  return placeAcross(anchor, toolbar, viewport, gap, margin, bottomSafe);
}

/** Under the passage, or over it — the horizontal book's rule, and the vertical one's fallback. */
function placeAcross(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  gap: number,
  margin: number,
  bottomSafe: number,
): ToolbarPlacement {
  // Centre on the selection midpoint along the cross axis, clamped inside the viewport.
  const rawLeft = anchor.midX - toolbar.width / 2;
  const left = clamp(rawLeft, margin, viewport.width - toolbar.width - margin);

  // Where it would go on each side, and which of those the screen can actually hold.
  //
  // **Three answers in order, not two.** Below-and-clear of the reserved strip is the one the
  // reader expects: the row appears under the passage, where the finger just left it. Above is
  // the flip for a selection near the bottom. What was missing is the third — below, *into* the
  // reserved strip — and without it a screen where neither of the first two fits sent the row to
  // the top margin, over the line the passage starts on and over the start handle with it. A row
  // where Android's contextual bar might appear is a guess about another surface; a row over the
  // text is a fault the reader has in front of them.
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - toolbar.height;
  const clearsReserve =
    below + toolbar.height <= viewport.height - reservedBottom(viewport, bottomSafe);
  const fitsAbove = above >= margin;
  const fitsBelow = below + toolbar.height <= viewport.height - margin;

  let top: number;
  if (clearsReserve) top = below;
  else if (fitsAbove) top = above;
  else if (fitsBelow) top = below;
  else {
    // The passage is taller than the screen: nowhere is clear of it. Pin to whichever edge has
    // more room — for a passage that starts high, that is the bottom, which is the end of it.
    const roomBelow = viewport.height - margin - below;
    const roomAbove = anchor.top - gap - margin;
    top = roomBelow >= roomAbove ? viewport.height - toolbar.height - margin : margin;
  }

  top = clamp(top, margin, viewport.height - toolbar.height - margin);

  // Read off the placement that survived the clamp, not off the intention before it: when
  // nothing fits the toolbar lands over the selection, and that is not "above" it.
  return { left, top, side: top + toolbar.height <= anchor.top ? "above" : "below" };
}

// A vertical book: the toolbar goes beside the tall selection, centred on it along the block
// axis. Prefer the left of the passage — in a `vertical-rl` book that is the side the reading
// moves towards — and flip to the right when the left would run off the edge, mirroring the
// below/above choice of the horizontal case.
//
// `null` when neither side has room for it, which on a phone is the ordinary case rather than
// the exception: the caller then places it across the passage instead. Answering `null` rather
// than clamping is what keeps that decision in one place.
function placeBeside(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  gap: number,
  margin: number,
): ToolbarPlacement | null {
  const rawTop = anchor.midY - toolbar.height / 2;
  const top = clamp(rawTop, margin, viewport.height - toolbar.height - margin);

  let left = anchor.left - gap - toolbar.width;
  if (left < margin) left = anchor.right + gap;
  if (left + toolbar.width > viewport.width - margin) return null;

  // Which side the clamp left it on, so the wedge points across the passage rather than away.
  // When nothing fits and the bar lands over the text, default the wedge to the left edge.
  const side = left >= anchor.right ? "right" : "left";
  return { left, top, side };
}

/**
 * How much of the bottom of the screen to keep the toolbar out of.
 *
 * Android Chrome slides a contextual-search bar up from the bottom during a selection. It is
 * browser chrome — not in the DOM, invisible to `visualViewport` — so it can only be avoided by
 * reserving room, and the reserve is measured in pixels of a portrait phone. A fifth of the
 * viewport is the ceiling on that: on a short screen the full reserve leaves nowhere below the
 * passage at all, and the toolbar ends up on the passage, which is a certain fault traded for a
 * possible one.
 */
function reservedBottom(viewport: Size, bottomSafe: number): number {
  return Math.min(bottomSafe, viewport.height * 0.2);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min; // viewport smaller than the toolbar: pin to the near edge
  return Math.max(min, Math.min(value, max));
}
