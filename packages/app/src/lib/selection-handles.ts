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

/**
 * One end of a selection, in the two forms it is needed in.
 *
 * **They are not the same point, and using one for the other is a bug with no symptom in a type
 * checker.** `point` is a corner of the text's own box, which is where the bead belongs — and a
 * corner is on the *boundary*: `caretPositionFromPoint` at the bottom edge of a line answers
 * with the line below it, and at the right edge of a vertical strip with the column before it.
 * So the point the range is held from has to be a point the text actually covers, which is what
 * `anchor` is. Handed the corner instead, dragging one handle would swallow a whole line at the
 * *other* end before the finger had moved at all.
 */
export interface SelectionEnd {
  /** Where the bead is drawn: the corner of the text this end sits at. */
  readonly point: Point;
  /** A point inside the text at this end, for holding the range from while the other end moves. */
  readonly anchor: Point;
  /**
   * How far the wash reaches back from `point`, across the line — the length the stem has to run
   * to arrive at its far edge.
   *
   * The stem is what says which passage a bead belongs to, and it can only say it by lying across
   * the colour: stopped short, a bead on a wide line reads as floating beside it. How wide that
   * line is depends on the type the reader set and on the book's own CSS, so it is not a number
   * `book.css` can hold — it travels out of here as `--handle-span`.
   */
  readonly span: number;
}

/** The two ends of a selection, in container coordinates — frond's own system. */
export interface SelectionEnds {
  /** Where the passage begins in reading order. */
  readonly start: SelectionEnd;
  /** Where it ends. */
  readonly end: SelectionEnd;
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

/** How big the bead on the end of a stem is — `styles/book.css`'s `--handle-bead` in numeric form. */
export const HANDLE_BEAD_PX = 11;

/**
 * How far the wash is let out past the text's own box, on each side of a vertical strip.
 *
 * **A vertical text rectangle is tight to the glyphs and a horizontal one is not**, which is a
 * fact about how the two are measured rather than a choice either engine made: a horizontal box
 * carries the font's internal leading above and below the letters, and there is no counterpart
 * for the cross axis of vertical setting (frond's `measurePart` says the same thing from the
 * other side, and computes an ink box only for the horizontal axis). Painted as they arrive, a
 * vertical wash stops exactly at the glyphs — 11px of colour on 14.7px type — and reads as too
 * narrow for the characters standing in it, while the horizontal one sits comfortably around
 * them.
 *
 * 3px is what makes the two match. Measured in the emulated phone: horizontal boxes come back
 * at 1.14em of their type size, and 3px a side brings the vertical ones to 1.15em at both sizes
 * on the cover of the vertical book (11px on 14.7px type, 15px on 18.4px). It stays well inside
 * the paper between two strips, which is 11px at that size — a wash that met its neighbour would
 * turn a two-line selection into one slab and lose the lines the reader is choosing.
 */
export const WASH_BLEED_PX = 3;

/**
 * How far past the text's own box the bead is held off, so that it begins exactly where the
 * colour ends — `styles/book.css`'s `--handle-reach`, which `SelectionLayer` sets from this.
 *
 * **Which is the wash's lip on that side, and nothing more.** It used to be 13px of paper
 * between the text and the bead, with a short tick of stem crossing it; a phone draws the bar
 * along the edge of the highlight and puts the ball straight on the end of it, with no gap for
 * the eye to read as a separate thing. Under vertical setting the colour is let out past the
 * glyphs (`WASH_BLEED_PX`) and the bead starts after that; horizontally the wash is the box the
 * text reports, so there is nothing to clear at all.
 */
export function handleReach(vertical: boolean): number {
  return vertical ? WASH_BLEED_PX : 0;
}

/**
 * The room the colour row has to leave beside a passage.
 *
 * **Half the hit region, not the bead.** A bead is 11px of tide sitting a few pixels past the
 * text, and a row clearing only that covers the rest of the 44px square the finger is aiming at
 * — which is the same failure as covering the bead, minus the part the reader can see. Every
 * bead is centred on a corner of the passage's own box, in both writing modes, so half the
 * square is exactly what the row has to stay outside of.
 *
 * `toolbar-position.ts` reads it from here rather than working it out again: the row landing
 * inside it is the far end of a selection quietly becoming undraggable.
 */
export const HANDLE_CLEARANCE_PX = HANDLE_HIT_PX / 2;

/**
 * The box to paint one rectangle of the wash in, given the box frond reported for the text.
 *
 * Only the cross axis is let out, and only under vertical setting — see `WASH_BLEED_PX`. Along
 * the line it must stay exactly as reported: consecutive rectangles of one line meet end to end
 * there, and a translucent wash that overlapped itself would draw a darker seam at every join.
 */
export function washRect(rect: Rect, vertical: boolean): Rect {
  if (!vertical) return rect;
  return {
    x: rect.x - WASH_BLEED_PX,
    y: rect.y,
    width: rect.width + WASH_BLEED_PX * 2,
    height: rect.height,
  };
}

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
      start: {
        point: { x: first.x + first.width, y: first.y },
        anchor: { x: first.x + first.width / 2, y: first.y + INSET_PX },
        span: spanOf(rects, first, true),
      },
      end: {
        point: { x: last.x, y: last.y + last.height },
        anchor: { x: last.x + last.width / 2, y: last.y + last.height - INSET_PX },
        span: spanOf(rects, last, true),
      },
    };
  }

  // The two beads hang off opposite edges — the leading one above its line, the trailing one
  // below — which is what both phone platforms do and what tells the reader, on a selection one
  // word long, which end they are about to take hold of.
  return {
    start: {
      point: { x: first.x, y: first.y },
      anchor: { x: first.x + INSET_PX, y: first.y + first.height / 2 },
      span: spanOf(rects, first, false),
    },
    end: {
      point: { x: last.x + last.width, y: last.y + last.height },
      anchor: { x: last.x + last.width - INSET_PX, y: last.y + last.height / 2 },
      span: spanOf(rects, last, false),
    },
  };
}

/**
 * `SelectionEnd.span` for the line an end sits on.
 *
 * One expression covers all four handles, because every bead sits on the corner where its line
 * *begins* along the cross axis and the wash runs away from it: rightwards from a horizontal
 * line's top edge, leftwards from a vertical strip's right edge, and the mirror of each at the
 * other end. So the distance to the far edge is the line's own cross size, plus the bleed on
 * that far side under vertical setting (`washRect`) — the near side's bleed falls behind the
 * bead and is `handleReach()`'s business, not this one's.
 *
 * **A line is not always one rectangle.** A superscript, an inline code span, a book that sets
 * its opening words larger: each run is reported separately, and the one the handle sits on can
 * be the short one. Taking the widest of the rectangles that share the line is what keeps the
 * stem lying across the whole band rather than across the fragment it started from.
 */
function spanOf(rects: readonly Rect[], edge: Rect, vertical: boolean): number {
  const cross = (rect: Rect) => (vertical ? rect.width : rect.height);
  const sharesLine = (rect: Rect) =>
    vertical
      ? rect.x < edge.x + edge.width && edge.x < rect.x + rect.width
      : rect.y < edge.y + edge.height && edge.y < rect.y + rect.height;

  const widest = Math.max(...rects.filter(sharesLine).map(cross));
  return vertical ? widest + WASH_BLEED_PX : widest;
}

/**
 * How far inside the text an anchor sits, along the direction the line runs.
 *
 * One pixel, because the aim is only to be off the boundary — any further and the anchor stops
 * being the end of the passage and starts trimming a character off it. Across the line it is
 * the middle rather than an inset, since a line box is tall enough that its centre is
 * unambiguously inside it and its edges are shared with the neighbouring lines.
 */
const INSET_PX = 1;

/**
 * Which handle a press landed on, or `null` for a press the page keeps.
 *
 * **The nearer handle wins a press both could claim**, which is not a tie-break for its own
 * sake: a long press selects one word, and one word puts the two handles well inside a finger
 * of each other. Taking whichever was tested first would leave one end of the commonest
 * selection there is undraggable.
 */
export function handleAt(point: Point, ends: SelectionEnds): "start" | "end" | null {
  const toStart = distance(point, ends.start.point);
  const toEnd = distance(point, ends.end.point);
  const nearest = Math.min(toStart, toEnd);
  if (nearest >= HANDLE_HIT_PX / 2) return null;
  return toEnd < toStart ? "end" : "start";
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
