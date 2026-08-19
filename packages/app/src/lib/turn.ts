// How a page turn moves once nobody's finger is on it: how long each kind takes, and the shape
// it travels through.
//
// **Only the numbers and the curves.** What starts a turn, which page it goes to and which edge
// that page comes in from are the Navigator's and frond's; this is the animation those decisions
// end up being played through, and the Reader is the one that plays it.
//
// It is a module of its own rather than four constants in the Reader because the browser tests
// draw a segment boundary at `TURN_COMMAND_MS` and have to use the same number the app animates
// with. A second copy in the test would not fail when this one changed — it would quietly count
// a few frames into the wrong half (`tests/browser/support/pacing.ts`). Importing the Reader
// itself is not an option: it builds a Dexie instance at module scope, which needs a browser.
//
// Every number here is a choice, not a measurement. Where one was picked rather than measured it
// says so, and docs/specs/desktop-page-turn/measurements.md says what would settle it.

/**
 * How long the page takes to finish a turn the finger let go of, or to slide back to where it
 * was.
 *
 * Short, because the reader has already done the moving. This is only the tail of a gesture, not
 * an animation they are meant to watch.
 */
export const TURN_SETTLE_MS = 180;

/**
 * And how long a turn nobody dragged takes: a page button, an arrow key.
 *
 * Longer than the settle because it is a different job. That one finishes off a movement the
 * reader has already made most of; this one crosses the whole screen from a standstill, and it
 * is the only thing on screen saying which way the book just went. Still short: a reader turns
 * thousands of pages, and every one of them waits for this.
 *
 * **Picked, not measured** (measurements.md §1). It has pressure from both sides, so moving it
 * one way only will not find the answer: too long and every one of those thousands of turns is
 * a wait; too short and it reads as a flicker rather than a movement, which is the whole point
 * of having it.
 */
export const TURN_COMMAND_MS = 220;

/**
 * The nudge a page gives when it is asked to turn past the end of the book, as a proportion of
 * the page, and how long each half of that nudge takes.
 *
 * The same answer the drag gives at the boundary, in the one form a press can take it: it moves,
 * so the book is not stuck, and it comes straight back, so this is the end. A button that does
 * nothing at all cannot be told from a book that has stopped working, and now that every other
 * press slides the page across, the dead one would be the odd one out.
 *
 * The fraction differs from the drag's overscroll limit (`touch.ts`'s 25%) on purpose: that one
 * is how far the reader pushed it, this one is how far the system pushed it for them.
 */
export const BOUNCE_FRACTION = 0.06;
export const BOUNCE_MS = 110;

/** Eases out of the speed it was already going. The tail of a gesture the reader began. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Starts and ends at rest. A turn nobody was pushing, so there is no speed to inherit. */
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
