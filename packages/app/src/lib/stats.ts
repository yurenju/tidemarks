import type { ReadingSession } from "./types";

export function totalReadingMs(sessions: ReadingSession[]): number {
  return sessions.reduce(
    (sum, s) => (s.endedAt > s.startedAt ? sum + (s.endedAt - s.startedAt) : sum),
    0,
  );
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * How many sittings the speed reads.
 *
 * The window is the whole of the weighting. Averaging every sitting ever would let the evening
 * the reader fell asleep on page two go on slowing the estimate for a month; weighting the
 * recent ones more heavily would be a second knob with nothing measured behind it, and this
 * one already drops an old sitting entirely.
 */
export const SPEED_WINDOW = 5;

/** Sittings the window must hold before there is a speed at all. */
export const SPEED_MIN_SESSIONS = 2;

/** Ground those sittings must have covered, as a fraction of the whole book. */
export const SPEED_MIN_FRACTION = 0.02;

/** Time those sittings must add up to. */
export const SPEED_MIN_MS = 5 * 60_000;

/** The estimate's grain: nothing finer than half an hour is ever shown. */
const HOUR = 3_600_000;

interface Sitting {
  ms: number;
  moved: number;
}

/**
 * How fast this reader is getting through this book, as a fraction of it per millisecond —
 * or `null` when the sittings so far do not support saying.
 *
 * The three thresholds are all floors on the sample, and all three have the same failure in
 * mind: a division that produces a number no one should read. Two sittings because one is a
 * sample of one; 0.02 of the book because a reader who opened it twice and read a paragraph
 * has a real duration over an unreal displacement; five minutes because the mirror of that is
 * a real displacement over a duration too short to mean anything.
 *
 * The thresholds and the window live in the spec (`docs/specs/ux-replan/spec.md`), not in an
 * ADR: they are meant to be turned, and the reason to turn one belongs next to the number.
 */
export function readingSpeed(sessions: ReadingSession[]): number | null {
  const window = sittings(sessions);
  if (window.length < SPEED_MIN_SESSIONS) return null;

  const ms = window.reduce((sum, s) => sum + s.ms, 0);
  const moved = window.reduce((sum, s) => sum + s.moved, 0);
  if (moved < SPEED_MIN_FRACTION || ms < SPEED_MIN_MS) return null;
  return moved / ms;
}

/**
 * How much longer this book has in it, in hours, rounded **up** to the next half hour.
 *
 * `null` when there is no speed to divide by, and when there is nothing left to read.
 *
 * Half an hour is as fine as the number gets because that is about as true as it is. An
 * estimate carried to a decimal place reads like a measurement, and this one is an average of
 * at most five evenings applied to a stretch of book the reader has not seen yet.
 */
export function remainingHours(sessions: ReadingSession[], percentage: number): number | null {
  const left = 1 - percentage;
  if (left <= 0) return null;
  const speed = readingSpeed(sessions);
  if (speed === null) return null;
  return Math.ceil(left / speed / HOUR / 0.5) * 0.5;
}

/**
 * The sittings the speed is allowed to read: the most recent ones that both took time and
 * knew where in the book they were.
 *
 * A sitting the device could not place (the whole-book index had not finished building, so
 * frond reported no fraction) is dropped rather than read as "moved nowhere" — it is time the
 * reader really spent, but counting it would divide real ground by an hour that has no ground
 * of its own, and the estimate would come out slower than the reader is.
 *
 * Going backwards counts as no ground gained rather than as ground lost: re-reading the last
 * chapter is reading, so the time stands, but a negative displacement in the sum would make
 * the total claim the reader had sped up.
 */
function sittings(sessions: ReadingSession[]): Sitting[] {
  return sessions
    .filter((s) => s.endedAt > s.startedAt && s.startFraction !== null && s.endFraction !== null)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, SPEED_WINDOW)
    .map((s) => ({
      ms: s.endedAt - s.startedAt,
      moved: Math.max(0, s.endFraction! - s.startFraction!),
    }));
}
