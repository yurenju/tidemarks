// Where to place the highlight toolbar relative to a text selection.
//
// Anchoring the toolbar to the selection (instead of pinning it to the bottom of
// the viewport) sidesteps a bug we cannot detect from JS: on Android Chrome a
// native contextual-search bar slides up from the very bottom during selection.
// That bar is browser chrome — not in the DOM, not visible to `visualViewport` —
// so we can't measure it. Keeping the toolbar next to the selection means it is
// never in the bottom strip the native bar occupies.

import { HANDLE_CLEARANCE_PX, HANDLE_HIT_PX, type SelectionEnds } from "./selection-handles";

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

// The gap between the selection and the toolbar is `HANDLE_CLEARANCE_PX`, which is where its
// reasoning lives: it is the room a handle needs rather than a margin, and the desk pays it too
// so that nobody changes the touch case alone and leaves the desk behind.

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
  // The boxes a finger aims at to drag the selection's two ends, in viewport coordinates
  // (`handleBoxes`). The toolbar is painted over them, so one it lands on is one the reader
  // cannot take hold of — with the row's own colours where the bead should be, which reads as a
  // fault in the row rather than as a covered control. Given these, the placements below are
  // tried in order and the first that clears both wins.
  handles?: readonly Box[];
}

/** A rectangle the toolbar has to keep off, in viewport coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The two handles' hit regions in viewport coordinates, from the ends frond's geometry gave.
 *
 * `SelectionEnds` is in the container's system, like everything else frond reports, and each
 * box is `HANDLE_HIT_PX` centred on the bead's own point — the same square `handleAt` tests a
 * press against, so what the toolbar avoids and what the finger finds are one number.
 */
export function handleBoxes(ends: SelectionEnds, container: Origin): readonly Box[] {
  return [ends.start, ends.end].map((end) => {
    const x = container.left + end.point.x;
    const y = container.top + end.point.y;
    return {
      left: x - HANDLE_HIT_PX / 2,
      top: y - HANDLE_HIT_PX / 2,
      right: x + HANDLE_HIT_PX / 2,
      bottom: y + HANDLE_HIT_PX / 2,
    };
  });
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
  {
    gap = HANDLE_CLEARANCE_PX,
    margin = 8,
    bottomSafe = 96,
    vertical = false,
    handles = [],
  }: Options = {},
): ToolbarPlacement {
  // **In preference order, and the first one that clears both handles wins.**
  //
  // A horizontal book has one answer, because `placeAcross` already chooses between below,
  // above and the two edges. A vertical book has three, and no one of them is right everywhere:
  // beside the column is what a reader expects and a phone rarely has room for; across the
  // passage is where a row nearly as wide as the screen has to go; and beside-but-clamped —
  // centred on the passage, overlapping it — is the one that fits *between* the two beads when
  // a tall column leaves nothing above or below it either.
  //
  const attempts = vertical
    ? [
        placeBeside(anchor, toolbar, viewport, gap, margin),
        placeAcross(anchor, toolbar, viewport, gap, margin, bottomSafe),
        placeBesideClamped(anchor, toolbar, viewport, margin),
      ]
    : [placeAcross(anchor, toolbar, viewport, gap, margin, bottomSafe)];

  const placements = attempts.filter((placement) => placement !== null);
  const clear = placements.find((placement) => clears(placement, toolbar, handles));
  // Nothing clears them on a screen this size — #56, where the answer is a row shaped for a
  // vertical book rather than a better place to put this one. The preferred placement stands.
  return clear ?? placements[0]!;
}

/** Whether a placement keeps off every box it was given. */
function clears(placement: ToolbarPlacement, toolbar: Size, handles: readonly Box[]): boolean {
  const right = placement.left + toolbar.width;
  const bottom = placement.top + toolbar.height;
  return handles.every(
    (box) =>
      box.right <= placement.left ||
      box.left >= right ||
      box.bottom <= placement.top ||
      box.top >= bottom,
  );
}

/**
 * Beside the passage with no room to be beside it: centred on the passage and clamped into the
 * viewport, which is where this always used to land in a vertical book.
 *
 * Last of the three because it is the only one that starts by covering the text. It earns its
 * place on a column taller than the screen: there is nothing above or below it either, and
 * centred on the passage the row falls between the two beads rather than on one of them.
 */
function placeBesideClamped(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  margin: number,
): ToolbarPlacement {
  const top = clamp(
    anchor.midY - toolbar.height / 2,
    margin,
    viewport.height - toolbar.height - margin,
  );
  const left = clamp(
    anchor.midX - toolbar.width / 2,
    margin,
    viewport.width - toolbar.width - margin,
  );
  return { left, top, side: left >= anchor.right ? "right" : "left" };
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
  const clearsReserve = below + toolbar.height <= viewport.height - bottomSafe;
  const fitsAbove = above >= margin;
  const fitsBelow = below + toolbar.height <= viewport.height - margin;

  let top: number;
  if (clearsReserve) top = below;
  else if (fitsAbove) top = above;
  else if (fitsBelow) top = below;
  else {
    // The passage is taller than the screen: nowhere is clear of it. Pin to whichever edge has
    // more room — for a passage that starts high, that is the bottom, which is the end of it.
    // **The reserved strip is given up here**, deliberately: a row where Android's contextual
    // bar might appear is a guess about another surface, and a row over the passage is a fault
    // the reader is looking at.
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

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min; // viewport smaller than the toolbar: pin to the near edge
  return Math.max(min, Math.min(value, max));
}
