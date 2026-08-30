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

import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
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
 * **Read, and not finished** — by the reading time, not by [[Last touched]]: a book imported this
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
 * needs saying, and so the caller's clock is the only one in play. `i18n` arrives the same way
 * and for the same reason: reaching for the global one would make every test in this file
 * depend on whichever language some other module activated last.
 */
export function statusLines(
  i18n: I18n,
  progress: Progress | undefined,
  sessions: ReadingSession[],
  now: number,
): string[] {
  if (progress === undefined) {
    return [
      i18n._(
        msg({
          message: "Not opened yet",
          comment: "First line under a book on the shelf that has never been opened.",
        }),
      ),
      i18n._(
        msg({
          message: "Just added",
          comment: "Second line under a never-opened book. It answers 'so why is it here'.",
        }),
      ),
    ];
  }
  if (isFinished(progress)) {
    return [
      i18n._(
        msg({
          message: "Finished",
          comment: "First line under a book the reader has read to the end.",
        }),
      ),
      formatFinishedOn(i18n.locale, progress.lastReadAt, now),
    ];
  }

  const chapter =
    progress.chapterLabel === null
      ? null
      : leadingGap(i18n.locale, progress.chapterLabel) + progress.chapterLabel;
  const percent = Math.round(progress.percentage * 100);

  const where =
    chapter !== null
      ? i18n._(
          msg({
            message: `Read to ${{ chapter }}`,
            comment:
              "Where the reader stopped, under a book on the shelf. The value is the chapter's own name, taken from the book — it is in the book's language and is never translated. It already carries whatever space this language wants in front of it (`leadingGap` in this file), so do not add one after the last word.",
          }),
        )
      : i18n._(
          msg({
            message: `Read to ${{ percent }}%`,
            comment:
              "Where the reader stopped, under a book whose position could not be named as a chapter. The value is a whole number.",
          }),
        );

  // `3` and `3.5`, never `3.0`: the estimate is already half-hour grained (`remainingHours`).
  const hours = remainingHours(sessions, progress.percentage);
  if (hours !== null) {
    return [
      where,
      i18n._(
        msg({
          message: plural(hours, {
            one: "About # hour left",
            other: "About # hours left",
          }),
          comment:
            "Second line under a book being read: how much reading is left, worked out from this reader's own pace. Half hours are common, so the number is 4.5 as often as it is 4.",
        }),
      ),
    ];
  }
  // One sitting is the reader having just begun, and saying so is true. More than one without
  // an estimate means the thresholds in `stats.ts` were not met — the reader may be halfway
  // through, so this would be wrong and a guessed estimate worse.
  if (sessions.length <= 1) {
    return [
      where,
      i18n._(
        msg({
          message: "Only just started",
          comment:
            "Second line under a book opened exactly once, in place of an estimate there is not enough reading to make.",
        }),
      ),
    ];
  }
  return [where];
}

/**
 * The space that goes in front of a chapter name, which only Chinese sometimes wants.
 *
 * 讀到第七章 is one phrase and a space would break it; 讀到 I: Down the Rabbit-Hole needs one,
 * for the same reason this repo's prose puts a space between Han characters and Latin. Which of
 * the two it is depends on the **book**, so no translation can be written already knowing which
 * — hence a space carried in the value rather than typed by whoever translates.
 *
 * English is out because its own sentence separates the words either way. Japanese is out
 * because it sets Latin against kana without a space, and its sentence opens with the name.
 */
function leadingGap(locale: string, label: string): string {
  if (!/^zh\b/.test(locale)) return "";
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(label)
    ? ""
    : " ";
}

/**
 * The day a book was finished on. The year appears only once it is no longer this one, which
 * is when it starts carrying information.
 *
 * The locale is the interface's, not the device's: a reader who chose 繁體中文 on an English
 * phone gets 8月3日, because the line this sits in is in Chinese either way.
 */
function formatFinishedOn(locale: string, at: number, now: number): string {
  const day = new Date(at);
  const sameYear = day.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
  }).format(day);
}
