/**
 * A reading position that arrived from another device while this one has the book open.
 *
 * ## Why the reader has to be asked rather than moved
 *
 * A position merges last-writer-wins (`merge.ts`), and that is on purpose: turning back to
 * reread is a real thing to have done, so the newest write wins rather than the furthest one.
 * The cost is that a device sitting on an open tab holds a stale position and does not know it
 * — the next page turn writes a newer `lastReadAt` over what the other device read, and
 * nothing on screen ever mentioned it.
 *
 * So the rule stays and the reader gets told. This file is the "is there anything to tell them"
 * half; the banner is `Reader.tsx`'s.
 */
import { compareCfi, parseCfi, rangeEndpoints, type Cfi } from "@yurenju/frond/epub";
import type { Progress } from "./types";

/**
 * The position to offer the reader, or `null` when there is nothing worth interrupting for.
 *
 * Returns the arriving row itself rather than a boolean, so the caller holds the one value the
 * banner needs and the position it will navigate to — the offer has to outlive the sync that
 * produced it (a page turn a second later must not invalidate it).
 *
 * **`here` is required.** Opening a book is a chain of awaits — download, parse, table of
 * contents — and a pull can land anywhere inside it, before this device knows where it is. An
 * optional `here` would answer that with "offer it", which is wrong twice over: the position is
 * about to be picked up by the open anyway, and there is nothing for a refusal to write instead
 * (`Reader.tsx`'s `stayHere`). Taking it as required makes the caller say when it knows.
 */
export function positionFromElsewhere(here: Progress, arrived: Progress): Progress | null {
  // A tie is the row coming back round: this device's own push, echoed by the next pull.
  if (arrived.lastReadAt <= here.lastReadAt) return null;
  return onSamePage(here, arrived) ? null : arrived;
}

/**
 * Whether the arriving position is somewhere the reader can already see.
 *
 * **The page, not a distance.** Two pages on is worth saying and two paragraphs down is not,
 * and the boundary between those is the page — which this device knows exactly, because the
 * position it wrote carries the range the page covered (`Progress.pageRange`). That takes the
 * place of a percentage threshold, which would have to be guessed and would mean something
 * different in a novel and in a dictionary.
 */
function onSamePage(here: Progress, arrived: Progress): boolean {
  if (here.pageRange === null) return printsSamePercentage(here, arrived);

  let page: Cfi;
  let point: Cfi;
  try {
    page = parseCfi(here.pageRange);
    point = parseCfi(arrived.cfi);
  } catch {
    // An older format, or a half-written value. Saying "same page" is the quiet answer, and
    // quiet is right: this runs inside a sync, and a banner is not worth an exception.
    return true;
  }

  const { start, end } = rangeEndpoints(page);
  // Both edges count as on the page: a position exactly at the page's first character is the
  // page the reader is looking at, not the one before it.
  return compareCfi(point, start) !== "before" && compareCfi(point, end) !== "after";
}

/**
 * The fallback when there is no page to compare against — a full-page image, or a row written
 * before `pageRange` existed.
 *
 * Compares the **printed** percentage rather than the stored one, because that is the number
 * the banner would show: a banner announcing the figure already on the reader's own bar has
 * nothing to say. It is coarser than a page, which is the honest outcome of having no page.
 */
function printsSamePercentage(here: Progress, arrived: Progress): boolean {
  return Math.round(here.percentage * 100) === Math.round(arrived.percentage * 100);
}

/** How long ago a position was written, at the coarsest grain that still says something. */
export type Elapsed = { unit: "now" } | { unit: "minutes" | "hours" | "days"; count: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Read once, when the banner appears, and never again.
 *
 * ponytail: no ticking clock, so a banner left standing for an hour still says "5 minutes ago".
 * A banner is answered in seconds or minutes — it is the thing standing between the reader and
 * the book. Give it a timer if anyone ever reports the stale reading.
 *
 * A future timestamp reads as "now": `lastReadAt` carries the clock of the device that wrote
 * it (`merge.ts`), two devices drift, and "in 3 minutes" is worse than approximate.
 */
export function elapsedSince(writtenAt: number, now: number): Elapsed {
  const ago = now - writtenAt;
  if (ago < MINUTE) return { unit: "now" };
  if (ago < HOUR) return { unit: "minutes", count: Math.floor(ago / MINUTE) };
  if (ago < DAY) return { unit: "hours", count: Math.floor(ago / HOUR) };
  return { unit: "days", count: Math.floor(ago / DAY) };
}
