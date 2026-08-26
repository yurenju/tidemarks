/**
 * Which marked passages reach the shelf's card today, and how old each one reads as.
 *
 * The card exists to keep a passage alive through the stretch where the reader cannot yet say
 * why it mattered — see CONTEXT.md 〈回訪卡〉 for what that is worth. This file is the half of
 * it that can be answered without a browser: given every mark and the last time each reached
 * the card, which five come up now.
 *
 * **One ordering does two jobs.** A mark that has never been shown sorts ahead of one shown
 * long ago, so a passage marked this morning arrives tomorrow (which puts the reader back in
 * the book they are in the middle of), and then sinks to the back of the queue and returns
 * months later (which is the reunion the card is really for). Nothing here distinguishes the
 * two cases; the single sort produces both.
 *
 * Randomness enters at one place only, and late: the pool is chosen by memory, and the draw
 * from it is chosen by chance. Both halves are load-bearing and neither survives alone —
 * see docs/adr/0038-the-revisit-card-remembers-what-it-showed.md.
 */

import type { Annotation } from "./types";

/** How many passages come up in a day's batch. */
export const BATCH_SIZE = 5;

/**
 * How many of the longest-unseen marks the draw may choose between.
 *
 * Not larger, and that is measured: a bigger pool is slower to work through the collection,
 * because a mark can be lifted into the pool and passed over again and again. At 200 marks a
 * pool of 15 covers everything in 46 days and a pool of 60 takes 80. Not smaller either — at
 * `BATCH_SIZE` the draw has no choices left, and the same five marks then travel together
 * forever, which is the one thing the randomness is here to prevent.
 */
export const POOL_SIZE = 15;

/** A batch as it is written down between visits, so a reload brings back the same five. */
export interface StoredBatch {
  /** The local date it was drawn on, `YYYY-MM-DD`. */
  day: string;
  ids: string[];
}

/** How a draw picks from the pool. Injected so a test can take the choice out of it. */
export type Draw = (pool: Annotation[]) => Annotation[];

const drawAtRandom: Draw = (pool) => {
  const bag = [...pool];
  const out: Annotation[] = [];
  while (out.length < BATCH_SIZE && bag.length > 0) {
    out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]!);
  }
  return out;
};

/**
 * Today's batch, drawn fresh.
 *
 * `marks` is the shelf's own list, so a deleted mark and a mark on a deleted book are already
 * gone by the time it gets here.
 */
export function pickBatch(marks: Annotation[], draw: Draw = drawAtRandom): Annotation[] {
  const queue = [...marks].sort(byLongestUnseen);
  return draw(queue.slice(0, POOL_SIZE));
}

/**
 * Ascending by when the card last showed it; never shown sorts first.
 *
 * Never-shown marks then go newest first. That is what stops a few hundred passages imported
 * from somewhere else burying the one the reader marked an hour ago — both are unseen, and only
 * one of them is worth putting in front of them tomorrow morning.
 */
function byLongestUnseen(a: Annotation, b: Annotation): number {
  const left = a.lastShownAt ?? null;
  const right = b.lastShownAt ?? null;
  if (left === null && right === null) return b.createdAt - a.createdAt;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

/**
 * The batch already drawn today, or `null` when a new one is due.
 *
 * A day rather than twenty-four hours: the reader feels "today", and an elapsed-time rule
 * drifts until the batch turns over at a different moment every day.
 */
export function restoreBatch(
  stored: StoredBatch | null,
  marks: Annotation[],
  today: string,
): Annotation[] | null {
  if (!stored || stored.day !== today) return null;
  const byId = new Map(marks.map((m) => [m.id, m]));
  // A mark can leave between one visit and the next. Losing one is not a reason to redraw the
  // other four — the reader may be halfway through thinking about them.
  const kept = stored.ids.map((id) => byId.get(id)).filter((m): m is Annotation => m !== undefined);
  return kept.length > 0 ? kept : null;
}

/** The local date, in the form `restoreBatch` compares. */
export function localDay(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How long ago the reader marked something, as one of a fixed set of rungs.
 *
 * A rung rather than a date, because the card is asking the reader to notice a distance, not to
 * look something up: "last month" is the part that makes them reach back for what they were
 * thinking then, and "14 July" is not. The words are the component's business — this only
 * says which rung.
 */
export type RelativeAge =
  | "justNow"
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "lastYear"
  | "longAgo";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function relativeAge(now: number, at: number): RelativeAge {
  // Marks carry the clock of the device that made them, and two devices disagree. A mark from
  // the future is the near end of the ladder, not an error.
  const ago = Math.max(0, now - at);
  if (ago < HOUR) return "justNow";
  if (ago < DAY) return "today";
  if (ago < 2 * DAY) return "yesterday";
  if (ago < 7 * DAY) return "thisWeek";
  if (ago < 14 * DAY) return "lastWeek";
  if (ago < 30 * DAY) return "thisMonth";
  if (ago < 60 * DAY) return "lastMonth";
  if (ago < 365 * DAY) return "thisYear";
  if (ago < 730 * DAY) return "lastYear";
  return "longAgo";
}
