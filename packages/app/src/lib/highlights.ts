// The highlight layer's geometry and colour policy.
//
// frond draws no highlights, and that is a decision rather than a gap (its ADR-0002):
// which colours, which opacity, whether a tap opens the note — all product decisions. What
// it hands over is the fact, `rectsFor(cfi)`, plus the `layout` event saying when those
// rectangles went stale. This module is the policy that turns the one into the other; the
// component around it stays thin enough to be uninteresting.

/** A `DOMRect`, narrowed to what this module reads (so a test needs no DOM). */
export interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box to paint, in container coordinates — left/top because that is what CSS wants. */
export interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContainerSize {
  readonly width: number;
  readonly height: number;
}

// Which of a range's rectangles are on the page in front of the reader, clipped to it.
//
// frond reports **true** geometry: a position two pages ahead comes back at a large
// coordinate and one behind at a negative one, because pages are made by scrolling a single
// long multi-column layout. Deciding what to do about that is the consumer's ("which
// rectangles to draw is a clipping policy"), and this is that decision: keep the ones that
// intersect the container, and cut them at its edges.
//
// Clipping rather than relying on `overflow: hidden` keeps the answer in one place — the
// same boxes then work for painting and for hit-testing a tap, and a box that is half on
// screen does not become a target across its invisible half.
export function visibleBoxes(rects: readonly RectLike[], container: ContainerSize): HighlightBox[] {
  const boxes: HighlightBox[] = [];

  for (const rect of rects) {
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(container.width, rect.x + rect.width);
    const bottom = Math.min(container.height, rect.y + rect.height);

    // `>` and not `>=`: a rectangle touching the far edge exactly is the first sliver of
    // the next page, and it has no area on this one.
    if (right > left && bottom > top) {
      boxes.push({ left, top, width: right - left, height: bottom - top });
    }
  }

  return boxes;
}

// Whether a point landed on one of these boxes.
//
// This is how tapping a highlight opens its note. The alternative — letting the overlay
// take pointer events — would mean the layer either swallows taps meant for the page
// (breaking the tap-to-turn zones) or has to pass them back through, and `pointerup`
// already arrives from frond in these very coordinates.
export function boxesContain(
  point: { readonly x: number; readonly y: number },
  boxes: readonly HighlightBox[],
): boolean {
  return boxes.some(
    (box) =>
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height,
  );
}

/**
 * The four inks a reader can mark with.
 *
 * Inks, and not highlighter colours: a marked passage is a wash of one of these with a firmer
 * line pressed along its bottom edge, which is what a nib leaves behind. None of the four is
 * anywhere near moss, so "what I marked" is never read as "what I can press".
 *
 * The labels are Chinese because they are the names of pigments and the reader is reading in
 * Chinese; there is no English original being translated here.
 */
export type MarkName = "indigo" | "ochre" | "moss" | "soot";

export const MARKS: readonly { name: MarkName; label: string }[] = [
  { name: "indigo", label: "蓼藍" },
  { name: "ochre", label: "赭石" },
  { name: "moss", label: "苔綠" },
  { name: "soot", label: "松煙" },
];

/** What a mark made without picking a colour is made in. */
export const DEFAULT_MARK: MarkName = "indigo";

/**
 * The four names this app used to write, and the ink each becomes.
 *
 * `color` on an `Annotation` has always held a **name**, never a value — which is why there is
 * no data migration here and none is needed. A row written by an older copy of the app, or by
 * one still running on the reader's other device, says `yellow`, and `yellow` is now the name
 * of nothing. Rather than let those marks fall back to the default and quietly all become the
 * same colour, each is mapped to the ink nearest the pigment it used to be.
 */
const RETIRED_NAMES: Record<string, MarkName> = {
  yellow: "ochre",
  blue: "indigo",
  green: "moss",
  pink: "soot",
};

/**
 * The CSS the ink is drawn from, as a custom-property reference rather than a value.
 *
 * A hex here would be a third place the light and dark palettes have to agree, and it would be
 * read once at render — so a mark drawn before the reader switched themes would keep the other
 * theme's colour until the next layout. Handing back `var(--mark-ochre)` leaves the value in
 * `index.css` where both themes are already written down, and the browser re-resolves it.
 *
 * A name from neither table (a newer version of the app synced a fifth ink down) gets the
 * default rather than nothing: an invisible highlight is a passage the reader marked and
 * cannot find.
 */
export function markVar(color: string): string {
  const name = color in RETIRED_NAMES ? RETIRED_NAMES[color] : color;
  const known = MARKS.some((mark) => mark.name === name);
  return `var(--mark-${known ? name : DEFAULT_MARK})`;
}
