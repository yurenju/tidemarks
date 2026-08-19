/**
 * What the shelf says about a book, in words.
 *
 * Two lines at most, and **a line with nothing behind it is not written** — an empty second
 * line reserved for an estimate that does not exist is the shelf holding a space open for a
 * number it never gets. The four things a book can be (never opened, just begun, being read,
 * finished) are four different sentences, not one sentence with blanks in it.
 *
 * The copy is here rather than in the component so it can be read whole: these lines are the
 * shelf's voice, and the rule they follow (say the useful thing, or say nothing) is easier to
 * break one JSX branch at a time.
 */

import { UI_LANGUAGE } from "./language";
import { remainingHours } from "./stats";
import type { Progress, ReadingSession } from "./types";

/**
 * How far in counts as read.
 *
 * Not 1: the last stretch of an epub is the colophon, the ads and the translator's notes, and
 * a reader who has finished the book will often never scroll through them. Asking for the last
 * percent would leave finished books sitting on the shelf as unfinished business.
 */
export const FINISHED_AT = 0.99;

export function isFinished(progress: Progress | undefined): boolean {
  return progress !== undefined && progress.percentage >= FINISHED_AT;
}

/**
 * The one book the shelf leads with, or `null` when there is none.
 *
 * **Read, and not finished** — by the reading time, not by 〈最近碰過〉: a book imported this
 * morning is the most recently touched thing on the shelf, and it is not what the reader was
 * in the middle of. A shelf where nothing qualifies (everything is new, or everything is done)
 * gets no large book at all, because blowing an unopened one up to half the screen reads as
 * the app telling the reader to get on with it.
 */
export function currentlyReading<T extends { id: string }>(
  books: readonly T[],
  progress: ReadonlyMap<string, Progress>,
): T | null {
  let best: T | null = null;
  let bestAt = -1;
  for (const book of books) {
    const at = progress.get(book.id);
    if (at === undefined || isFinished(at)) continue;
    if (at.lastReadAt > bestAt) {
      best = book;
      bestAt = at.lastReadAt;
    }
  }
  return best;
}

/**
 * The one or two lines under a book's cover.
 *
 * `now` is passed in rather than read here so the date below can decide whether the year still
 * needs saying, and so the caller's clock is the only one in play.
 */
export function statusLines(
  progress: Progress | undefined,
  sessions: ReadingSession[],
  now: number,
): string[] {
  if (progress === undefined) return ["還沒翻開", "剛剛加進來的"];
  if (isFinished(progress)) return ["讀完了", formatFinishedOn(progress.lastReadAt, now)];

  const where =
    progress.chapterLabel !== null
      ? `讀到${gap(progress.chapterLabel)}${progress.chapterLabel}`
      : `讀到 ${Math.round(progress.percentage * 100)}%`;

  // `3` and `3.5`, never `3.0`: the estimate is already half-hour grained (`remainingHours`).
  const hours = remainingHours(sessions, progress.percentage);
  if (hours !== null) return [where, `大約還要 ${hours} 小時`];
  // One sitting is the reader having just begun, and saying so is true. More than one without
  // an estimate means the thresholds in `stats.ts` were not met — the reader may be halfway
  // through, so 才剛開始 would be wrong and a guessed estimate worse.
  if (sessions.length <= 1) return [where, "才剛開始"];
  return [where];
}

/**
 * The space between 讀到 and a chapter name, which only some chapter names want.
 *
 * 讀到第七章 is one phrase and a space would break it; 讀到 I: Down the Rabbit-Hole needs one,
 * for the same reason this repo's prose puts a space between Han characters and Latin. The
 * chapter name is the book's, so which of the two it is cannot be decided in advance.
 */
function gap(label: string): string {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(label)
    ? ""
    : " ";
}

/**
 * The day a book was finished on. The year appears only once it is no longer this one, which
 * is when it starts carrying information.
 */
function formatFinishedOn(at: number, now: number): string {
  const day = new Date(at);
  const sameYear = day.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(UI_LANGUAGE, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
  }).format(day);
}
