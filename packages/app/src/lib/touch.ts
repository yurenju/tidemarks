// The finger, in the two questions the reader's gestures come down to: has this press become a
// drag, and if it has, what should become of it when the finger lifts.
//
// **Turning a page is a drag and nothing else** (ADR-0024). A tap does not turn pages here;
// where a tap lands has stopped mattering, so nothing in this file asks about position.
//
// Every number here is a threshold, and thresholds that come out of nowhere are how a reader
// ends up with "sometimes it works". Where one was measured, it says so; where it was guessed,
// it says that too and points at the measurement that would settle it
// (docs/specs/swipe-to-turn/measurements.md).

import type { TurnEdge } from "@yurenju/frond/renderer";

// How far a pointer may travel and still count as a tap rather than a drag. Shared, because
// three layers ask the same question of one gesture: the Navigator ("is this a tap"), the drag
// ("has the page started following the finger") and the Reader ("did this tap land on a
// highlight"). Two copies of the number would let a gesture be a tap for one and a drag for
// the other.
export const TAP_SLOP_PX = 10;

// And how long it may last. Both phone platforms begin their own text-selection gesture at
// around half a second, so a press held past this is a long press — whatever the reader meant
// by it, it was not a tap.
export const MAX_TAP_MS = 500;

/** A press that neither travelled nor lingered: a tap. */
export function isTap(dx: number, dy: number, ms: number): boolean {
  return Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX && ms < MAX_TAP_MS;
}

// How long after a tap a selection is still blamed on the tap rather than on the reader.
//
// **Phone browsers select a word on a plain tap.** Chrome for Android's Touch to Search does
// it, with no long press involved, and the selection is a real one — frond reports it exactly
// as it reports a deliberate one. So a tap that lands on the text raises the highlight
// toolbar, over a page the reader was only trying to put the interface on top of (#36).
//
// The window closes early on the next pointerdown (see the Reader): from that moment any
// selection is the reader's own doing, which is what makes a tap-then-drag-to-select still
// select.
export const TAP_SELECTION_GRACE_MS = 400;

/**
 * Whether the page should start following the finger.
 *
 * **Time is deliberately not asked.** A rule of the shape "only if the finger moved within half
 * a second" would take page turning away from a reader who presses, hesitates and then swipes,
 * and dragging is the only way to turn a page by hand (ADR-0024) — so that reader would be left
 * with a book that sometimes does not turn, and would have no way to describe what they did.
 * What rules selection out instead is whether anything is selected, which the caller asks at
 * the moment of the press.
 *
 * The sideways condition is the other half: pages move sideways in both writing modes, so a
 * finger going down the page is not asking for one.
 */
export function startsDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy);
}

/**
 * How far the drag itself has gone, which is not how far the finger has.
 *
 * The first `TAP_SLOP_PX` belong to deciding that this is a drag at all. Counting them into the
 * distance would make the page jump by that much the instant the drag begins; leaving them out
 * costs the page a fixed lag of the same size, which is the trade every platform makes.
 */
export function travelled(dx: number): number {
  if (Math.abs(dx) <= TAP_SLOP_PX) return 0;
  return dx > 0 ? dx - TAP_SLOP_PX : dx + TAP_SLOP_PX;
}

/** Which edge the page coming in enters from, for a drag of this direction. */
export function incomingEdge(travel: number): TurnEdge {
  return travel < 0 ? "right" : "left";
}

/**
 * How much of the page has to be dragged across before letting go turns it.
 *
 * A proportion rather than a number of pixels: a third of a phone screen and a third of a
 * tablet are the same gesture and very different distances. **The third itself is a guess** —
 * measurements.md §2 says how to settle it.
 *
 * Exported because the browser specs have to drag past it. A spec that writes its own number
 * instead is not asking for a turn, it is asking for whichever of the two routes in
 * `commitsTurn` that number happens to land on — which is how #15 was let in.
 */
export const COMMIT_FRACTION = 1 / 3;

/**
 * The speed at which a flick counts however short it was, in px per ms.
 *
 * A thumb flick on a phone is 30px and gone, and distance alone refuses it. Refusing it is
 * exactly what "I swiped and nothing happened" is made of, and with tapping no longer turning
 * pages there is no second way for that reader to get their page. **Also a guess.**
 */
const FLICK_PX_PER_MS = 0.35;

/** Whether letting go here turns the page or puts it back. */
export function commitsTurn(gesture: {
  /** How far the page has been dragged, in px. */
  readonly distance: number;
  /** How far it would have to go to be turned. */
  readonly extent: number;
  /** How fast it was moving when the finger left, in px per ms, in the direction of the drag. */
  readonly velocity: number;
}): boolean {
  if (gesture.distance > gesture.extent * COMMIT_FRACTION) return true;
  return gesture.velocity >= FLICK_PX_PER_MS;
}

/** How far past the end of the book the page may be pulled, as a proportion of the page. */
const OVERSCROLL_LIMIT = 0.25;

/**
 * The distance a page actually moves when there is nothing on the other side of it.
 *
 * It follows the finger at first and then resists, approaching a quarter of a page without ever
 * reaching it. Both halves are the message: something moved, so the book is not stuck; it
 * fought back, so this is the end.
 */
export function dampen(distance: number, extent: number): number {
  const limit = extent * OVERSCROLL_LIMIT;
  return limit * (1 - Math.exp(-distance / limit));
}
