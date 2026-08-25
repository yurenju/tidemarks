// Where to place the highlight toolbar for a text selection.
//
// **Three stages, and each one names what it has given up.** A vertical book on a phone is the
// case that shapes this: the selection is a column running the height of the page, the row is
// nearly as wide as the screen, and there is no position that clears the text. Trying placement
// after placement and quietly settling for the first one when they all fail (what this used to
// do) makes "over the text" an accident rather than a decision, and puts the row somewhere
// different on every selection.
//
//   1. Clear of the whole selection **and** both handles. The row sits beside the passage,
//      which is what a reader expects and what a desk always has room for.
//   2. Clear of both handles only. The row drops to a fixed resting line near the bottom of the
//      screen and, if a handle is there, climbs until it is not. **The text is given up here**:
//      a column taller than the screen leaves nowhere else, and a row that is always in the same
//      place is one the reader learns.
//   3. Nothing is clear. The row stays on the resting line. **The handles are given up here**,
//      which only happens when the selection spans the screen — and then stepping aside for a
//      handle would mean landing on the other one.
//
// The row carries no wedge pointing back at the passage. It had one while it always sat beside
// the text; a wedge that appears for stage 1 and not for stages 2 and 3 is a mark the reader
// cannot read a rule into, and what relates the row to the passage in every stage is the wash
// over the text itself.
//
// **There is no reserved strip at the bottom of the screen any more.** This file used to keep
// 96px clear of it, because Android Chrome raises a contextual-search bar there during a native
// selection and JS can neither see nor measure it — and anchoring the row to the passage at all
// was that bar's doing. ADR-0036 took the premise away: on touch the book's document carries
// `user-select: none !important`, so there is no native selection to raise it, and the desk,
// which still has one, has no such bar. The decision and the risk are in that ADR.

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
}

/**
 * How far the resting row's own bottom edge stops short of the bottom of the screen.
 *
 * Measured from the edge rather than taken as a fraction of the height, because a phone is
 * 659px tall upright and 343px on its side while the row is 88px and 44px — a percentage puts
 * the two in visibly different places, and a fixed inset does not. Near the bottom is also
 * where the thumb already is.
 */
export const RESTING_INSET_PX = 24;

/** A rectangle the toolbar has to keep off, in viewport coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Options {
  gap?: number; // space between selection and toolbar; `HANDLE_CLEARANCE_PX` by default
  margin?: number; // minimum distance from the viewport edges
  resting?: number; // `RESTING_INSET_PX` by default
  // A vertically-written book (frond's `vertical-rl`). Only the order the sides are tried in
  // depends on it: a vertical selection is a tall column, so beside it is where a row belongs,
  // and left is the side the reading moves towards. Which edge of the text a mark runs along is
  // the same fact `HighlightLayer` needs.
  vertical?: boolean;
  // The boxes a finger aims at to drag the selection's two ends, in viewport coordinates
  // (`handleBoxes`). The toolbar is painted over them, so one it lands on is one the reader
  // cannot take hold of — with the row's own colours where the bead should be, which reads as a
  // fault in the row rather than as a covered control.
  handles?: readonly Box[];
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
    resting = RESTING_INSET_PX,
    vertical = false,
    handles = [],
  }: Options = {},
): ToolbarPlacement {
  // **Stage 1.** Four sides, in the order the book's writing mode makes them worth trying, and
  // the first that is both on-screen and clear of everything wins.
  //
  // The selection goes in beside the handles, though **every candidate clears it by
  // construction** — each is placed past one edge of the anchor and clamped only along the
  // other axis. That is the point: what used to put a row across the passage was not a
  // candidate that overlapped, it was falling back to a candidate that did not fit
  // (#56). Stating the rule rather than leaving it to be re-derived is what keeps a fifth
  // candidate, added later by someone reading this list, from quietly reintroducing it.
  const keepOff = [selectionBox(anchor), ...handles];
  const beside = sides(anchor, toolbar, viewport, gap, margin, vertical).find(
    (placement) =>
      onScreen(placement, toolbar, viewport, margin) && clears(placement, toolbar, keepOff),
  );
  if (beside) return beside;

  // **Stages 2 and 3.** Nowhere is clear of the passage, so the row leaves it and takes the one
  // place it always goes instead.
  return placeAtRest(toolbar, viewport, margin, resting, handles);
}

/** The rectangle the selection itself occupies — what stage 1 has to stay off. */
function selectionBox(anchor: SelectionAnchor): Box {
  return { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom };
}

/**
 * The four places a row can sit against a passage, centred on it along the other axis.
 *
 * Preference is the writing mode's, not a fixed list. A horizontal selection is a wide band, so
 * below it is where the finger just left and above is the flip near the bottom edge; a vertical
 * selection is a tall column, so beside it is the answer and **left comes first** — in a
 * `vertical-rl` book that is the side the reading moves towards. The other two follow in each
 * case rather than being left out: a short selection has room on all four sides, and refusing
 * to look at two of them is how a row ends up on the resting line with space going spare.
 */
function sides(
  anchor: SelectionAnchor,
  toolbar: Size,
  viewport: Size,
  gap: number,
  margin: number,
  vertical: boolean,
): readonly ToolbarPlacement[] {
  const acrossLeft = clamp(
    anchor.midX - toolbar.width / 2,
    margin,
    viewport.width - toolbar.width - margin,
  );
  const besideTop = clamp(
    anchor.midY - toolbar.height / 2,
    margin,
    viewport.height - toolbar.height - margin,
  );

  const below = { left: acrossLeft, top: anchor.bottom + gap };
  const above = { left: acrossLeft, top: anchor.top - gap - toolbar.height };
  const left = { left: anchor.left - gap - toolbar.width, top: besideTop };
  const right = { left: anchor.right + gap, top: besideTop };

  return vertical ? [left, right, below, above] : [below, above, left, right];
}

/** Whether a placement is wholly inside the viewport, margins included. */
function onScreen(
  placement: ToolbarPlacement,
  toolbar: Size,
  viewport: Size,
  margin: number,
): boolean {
  return (
    placement.left >= margin &&
    placement.top >= margin &&
    placement.left + toolbar.width <= viewport.width - margin &&
    placement.top + toolbar.height <= viewport.height - margin
  );
}

/** Whether a placement keeps off every box it was given. */
function clears(placement: ToolbarPlacement, toolbar: Size, boxes: readonly Box[]): boolean {
  const right = placement.left + toolbar.width;
  const bottom = placement.top + toolbar.height;
  return boxes.every(
    (box) =>
      box.right <= placement.left ||
      box.left >= right ||
      box.bottom <= placement.top ||
      box.top >= bottom,
  );
}

/**
 * The resting place: centred on the screen, near the bottom, and above a handle if one is there.
 *
 * Centred on the **screen** rather than on the passage, because the passage is what the row has
 * just failed to avoid — reading a position off it again would give back the wandering this
 * stage exists to end. The reader gets one line to learn, and the row is on it or directly
 * above it.
 *
 * **The climb goes one way.** The resting line is already near the bottom edge, so downwards
 * there is nothing but the margin; a search in both directions would be a branch that never
 * runs. The candidate heights are exact rather than stepped: the only way past a box is to be
 * wholly above it, so `box.top - height` is where the row would have to be, and one of those
 * (or the line itself) is the answer. Trying them from the lowest down means the row moves as
 * little as it has to.
 *
 * **Stage 3 is no candidate surviving**, and then the line itself stands. Two things send it
 * there and both mean the same to the reader: every height covers a bead, or the only heights
 * that would clear one are off the top of the screen. A selection reaching across the screen
 * does that, and moving is then only a choice of which bead to cover.
 */
function placeAtRest(
  toolbar: Size,
  viewport: Size,
  margin: number,
  resting: number,
  handles: readonly Box[],
): ToolbarPlacement {
  const left = clamp(
    (viewport.width - toolbar.width) / 2,
    margin,
    viewport.width - toolbar.width - margin,
  );
  const line = clamp(
    viewport.height - resting - toolbar.height,
    margin,
    viewport.height - toolbar.height - margin,
  );

  const heights = [line, ...handles.map((box) => box.top - toolbar.height)]
    .filter((top) => top >= margin && top <= line)
    .sort((a, b) => b - a);

  const top = heights.find((candidate) => clears({ left, top: candidate }, toolbar, handles));
  return { left, top: top ?? line };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min; // viewport smaller than the toolbar: pin to the near edge
  return Math.max(min, Math.min(value, max));
}
