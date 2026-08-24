// The two ends of a selection the reader can take hold of.
//
// On touch the selection is ours to draw and ours to move (ADR-0036), and moving it means two
// handles: one at each end of the passage, each dragging that end while the other stays put.
// Everything here is geometry — where the ends are, and whether a press landed on one. What a
// drag then does with them is `Reader.tsx`'s.
//
// **Where a handle goes depends on how the book is set**, and CSS cannot see that: a horizontal
// passage begins at the left of its first line and ends at the right of its last, while a
// vertical one begins at the top of its first strip and ends at the bottom of its last. The
// same fact `HighlightLayer` needs, for the same reason.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The two ends of a selection, in container coordinates — frond's own system. */
export interface SelectionEnds {
  /** Where the passage begins in reading order. */
  readonly start: Point;
  /** Where it ends. */
  readonly end: Point;
}

/**
 * How far a finger may land from a handle's centre and still be taken as pressing it.
 *
 * The same 44px every other pressable thing in the app is given (`--tap-min`), and
 * **deliberately four times the bead it belongs to**: the bead is 11px because anything larger
 * starts covering the neighbouring line in a Chinese book, and 11px is not something a finger
 * can aim at. Drawn small, pressed large — the same split `lib/highlights.ts` makes between the
 * boxes a mark is painted in and the boxes a tap is tested against.
 */
export const HANDLE_HIT_PX = 44;

/**
 * How far past the edge of the text a handle's stem reaches, in px.
 *
 * Exported because two places have to agree on it and neither can derive it from the other:
 * `styles/book.css` draws the stem and `toolbar-position.ts` has to leave room for the whole
 * handle. It is `styles/book.css`'s `--handle-reach` in numeric form.
 */
export const HANDLE_REACH_PX = 13;

/**
 * Where a selection's two handles belong, given the rectangles frond reported for it.
 *
 * The rectangles arrive in reading order, one or more per line, so the first names the line the
 * passage starts on and the last the line it ends on. `null` when there is no geometry at all —
 * a selection with nothing on the page in front of the reader has no ends to take hold of.
 */
export function selectionEnds(rects: readonly Rect[], vertical: boolean): SelectionEnds | null {
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (first === undefined || last === undefined) return null;

  // A vertical book reads top to bottom and column to column leftwards, so the passage's own
  // beginning is the top of its first strip and its end the bottom of its last. The handles
  // hang off the sides — the right of the first, the left of the last — which is the axis the
  // marks run along too.
  if (vertical) {
    return {
      start: { x: first.x + first.width, y: first.y },
      end: { x: last.x, y: last.y + last.height },
    };
  }

  // The two beads hang off opposite edges — the leading one above its line, the trailing one
  // below — which is what both phone platforms do and what tells the reader, on a selection one
  // word long, which end they are about to take hold of.
  return {
    start: { x: first.x, y: first.y },
    end: { x: last.x + last.width, y: last.y + last.height },
  };
}

/**
 * Which handle a press landed on, or `null` for a press the page keeps.
 *
 * **The nearer handle wins a press both could claim**, which is not a tie-break for its own
 * sake: a long press selects one word, and one word puts the two handles well inside a finger
 * of each other. Taking whichever was tested first would leave one end of the commonest
 * selection there is undraggable.
 */
export function handleAt(point: Point, ends: SelectionEnds): "start" | "end" | null {
  const toStart = distance(point, ends.start);
  const toEnd = distance(point, ends.end);
  const nearest = Math.min(toStart, toEnd);
  if (nearest >= HANDLE_HIT_PX / 2) return null;
  return toEnd < toStart ? "end" : "start";
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
