/**
 * Which marked passage reaches the shelf's card today, and how old it reads as.
 *
 * The card exists to keep a passage alive through the stretch where the reader cannot yet say
 * why it mattered — see CONTEXT.md [[Revisit card]] for what that is worth. This file is the half of it
 * that can be answered without a browser: which passage comes up, and how long ago it was marked.
 *
 * **One a day, drawn at random, held until tomorrow.** The holding is the part that does the
 * work: a reader who cannot yet say why a passage stayed with them needs to meet it more than
 * once, and a card that changed every time they came back to the shelf would never give them the
 * chance. Chance is only how the passage is chosen — see ADR-0038 for why it is not chosen by
 * how long ago the card last showed it, and for what would have to be true to change that back.
 */

import type { Annotation } from "./types";

/** The passage showing today, as it is written down between visits. */
export interface ShownToday {
  /** The local date it was drawn on, `YYYY-MM-DD`. */
  day: string;
  id: string;
}

/** How a draw picks. Injected so a test can take the chance out of it. */
export type Draw = (marks: Annotation[]) => Annotation;

const drawAtRandom: Draw = (marks) => marks[Math.floor(Math.random() * marks.length)]!;

/**
 * A passage to show, or `null` when there is nothing marked.
 *
 * `marks` is the shelf's own list, so a deleted mark and a mark on a deleted book are already
 * gone by the time it gets here.
 *
 * `movingOn` is the passage the reader has just asked to leave, and the only thing the draw
 * promises: whatever comes back, it is not that one. ⚠️ Unless it is the only mark there is —
 * a reader with one passage who presses [[Another passage]] has asked for something, and an empty card
 * is a worse answer than the same passage again.
 */
export function pickOne(
  marks: Annotation[],
  movingOn?: string,
  draw: Draw = drawAtRandom,
): Annotation | null {
  if (marks.length === 0) return null;
  const others = marks.filter((m) => m.id !== movingOn);
  return draw(others.length > 0 ? others : marks);
}

/**
 * The passage already drawn today, or `null` when a new one is due.
 *
 * A day rather than twenty-four hours: the reader feels "today", and an elapsed-time rule drifts
 * until the card turns over at a different moment every day.
 */
export function restoreShown(
  stored: ShownToday | null,
  marks: Annotation[],
  today: string,
): Annotation | null {
  if (!stored || stored.day !== today) return null;
  // A mark can leave between one visit and the next. Then there is nothing to restore and the
  // caller draws, which is the same thing that happens on a new day.
  return marks.find((m) => m.id === stored.id) ?? null;
}

/** The local date, in the form `restoreShown` compares. */
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
