/**
 * How often the triggers in `App.tsx` are allowed to reach the server.
 *
 * ## Why there is no timer behind this
 *
 * A position written on another device produces **no event here**. The browser only knows about
 * this tab, so a device can either poll on a timer or wait for something the reader does — and
 * a timer asks hardest in the case where nobody is there to care about the answer, all day, on
 * a phone.
 *
 * What makes the second option enough is the shape of the case itself: **changing device is an
 * action on the new device**. Picking up a phone unlocks it, walking to a laptop clicks its
 * window, and either way something here fires. So the triggers are the arrival, not the clock,
 * and an idle tab costs nothing at all.
 *
 * The gap that leaves: two devices both open and both in the foreground, with the reader
 * touching neither. That device never finds out. It is a narrow gap — looking at a screen is
 * usually the moment before using it, and using it is a trigger — and closing it means a timer
 * again, slower but with all of a timer's questions back. Give this a real server connection
 * (SSE, or a socket) before giving it a timer: that is what actually answers "tell me when
 * something changed", and it is the reason the gap exists rather than an oversight.
 *
 * What is **not** a gap, though it looks like one: reading. A page turn happens inside the
 * book's iframe and never reaches the triggers here, but it writes a position, and writing one
 * schedules a sync of its own (`sync.ts`'s `scheduleSync`). A reader who is reading is already
 * covered, twice over.
 */

/** A trigger, and the two answers to "how soon may this ask again". */
export type SyncTrigger =
  /** Became visible, regained focus, came back online — the reader has just arrived. */
  | "resumed"
  /** A tap or a keystroke from a reader who was already here. */
  | "activity";

/**
 * The ceiling on syncs driven by a reader who is already here.
 *
 * Not a polling interval: nothing fires it, so a still tab never reaches it. It exists because
 * page turns are taps, and a sync per page turn would be a request per page.
 */
export const ACTIVITY_THROTTLE_MS = 30_000;

/**
 * Long enough to fold one arrival's events into one sync, short enough to be no wait at all.
 *
 * Restoring a minimised window fires `visibilitychange` and `focus` within milliseconds of each
 * other, and both mean the same thing. Without this the reader's every return would ask the
 * server the same question twice.
 *
 * ⚠️ `tests/browser/reader/elsewhere.spec.ts` returns to the foreground by hand and expects the
 * banner that a sync brings. It taps buttons on the way there, and a tap is a trigger — so that
 * return has to land more than this long after the last one. It does, by seconds, but raising
 * this to where it would not is how that spec would start failing for a reason nothing in it
 * mentions.
 */
export const RESUME_COALESCE_MS = 1_000;

/**
 * A gate that says whether a trigger should sync now, keeping its own last-allowed time.
 *
 * A returning reader is never made to wait out an activity throttle — that is the whole
 * ordering here. Arriving is when a position from elsewhere is most worth having, and the tap
 * that happened twenty seconds ago was a different question.
 *
 * The clock is a parameter so a test can run the windows out without sleeping through them.
 */
export function createSyncGate(now: () => number = Date.now): (trigger: SyncTrigger) => boolean {
  let lastAllowedAt = Number.NEGATIVE_INFINITY;
  return (trigger) => {
    const at = now();
    const wait = trigger === "activity" ? ACTIVITY_THROTTLE_MS : RESUME_COALESCE_MS;
    if (at - lastAllowedAt < wait) return false;
    lastAllowedAt = at;
    return true;
  };
}
