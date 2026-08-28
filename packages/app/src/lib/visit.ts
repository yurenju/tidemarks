/**
 * A **visit**: the stretch between going back to a marked passage and reading again.
 *
 * ## Why a mode rather than a rule per gesture
 *
 * Going back to a passage moves the reader without meaning "this is where I am in the book".
 * The shelf's revisit card does it before the first layout (`Reader.tsx`'s `openAt`), the notes
 * panel does it mid-sitting, and both used to write the passage over the reader's progress —
 * a reader a hundred pages in, tapping a card from chapter two, lost the hundred pages.
 *
 * The obvious fix is to classify gestures: this one counts as reading, that one does not. It
 * does not survive the scrubber, which the reader drags for both reasons and never says which.
 * So the classification is on **position** instead: during a visit, progress only moves
 * forward. Turning pages around the passage changes nothing; passing what they had reached is
 * reading again, and that is the whole of it.
 *
 * `Progress` itself is untouched — a visit lives in the reader's memory and nowhere else, so
 * nothing here syncs, nothing survives a reload, and last-writer-wins (`merge.ts`) stays the
 * only rule the server ever sees.
 */
import { compareCfi, parseCfi, rangeEndpoints, type Cfi } from "@yurenju/frond/epub";

/** Where the reader is and what the page they are on covers — one `relocate`'s worth. */
export interface VisitPosition {
  readonly cfi: string;
  readonly pageRange: string | null;
}

/**
 * Whether jumping to `target` begins a visit.
 *
 * **The page, not a distance** — the same measure `lib/elsewhere.ts` uses, and for the same
 * reason: a passage the reader can already see is not somewhere they went. Someone who opens the
 * notes panel mid-sitting and taps a mark on the page in front of them has gone nowhere; without
 * this, their progress would freeze on a jump that never happened.
 *
 * ⚠️ `pageRange` has to be **the page on screen right now**, read from `renderer.location`
 * rather than from a stored `Progress`. `relocate` de-duplicates on section, page, fraction and
 * CFI — `pageRange` is not in that signature, so a reflow that keeps the reader on the same page
 * of the same CFI (a panel opening beside the book on a desk) is swallowed, and the stored range
 * still describes the layout before it.
 */
export function entersVisit(pageRange: string | null, target: string): boolean {
  return onPage(pageRange, target) === false;
}

/**
 * Whether the reader has finished visiting and is reading again.
 *
 * Two ways, and they are the same question asked from either end: they have passed what they
 * had reached, or the page in front of them is the page they had reached. The second is not
 * covered by the first — coming back by the scrubber lands near that point, rarely on it, and
 * a reader looking at their own last page is not visiting anything.
 */
export function leavesVisit(kept: VisitPosition, at: VisitPosition): boolean {
  const reached = order(at.cfi, kept.cfi);
  if (reached === "after" || reached === "equal") return true;
  return onPage(at.pageRange, kept.cfi) === true;
}

/**
 * Whether `point` falls within the stretch `pageRange` covers, both edges included — or `null`
 * when there is no page to compare against.
 *
 * **"I cannot tell" is a third answer rather than a default**, because the two callers want
 * opposite things from it: not entering a mode the reader never asked for, and not leaving one
 * on a guess. Folding either into a boolean here would hand the other the unsafe reading.
 * `pageRange` is absent on a full-page image and on rows written before the field existed.
 *
 * ponytail: a reader sitting on a full-page image who taps a mark elsewhere gets no visit, so
 * their progress still moves to it. Give this the percentage fallback `elsewhere.ts` has if
 * anyone reports it — there is no percentage on a mark, so it would have to come from the
 * caller.
 */
function onPage(pageRange: string | null, point: string): boolean | null {
  if (pageRange === null) return null;

  let page: Cfi;
  let where: Cfi;
  try {
    page = parseCfi(pageRange);
    where = parseCfi(point);
  } catch {
    return null;
  }

  const { start, end } = rangeEndpoints(page);
  // A mark is a range and a position is a point; both are asked for where they *begin*, which
  // is where the reader's eye goes. A mark running over the fold begins on the page it is read
  // from.
  const from = rangeEndpoints(where).start;
  return compareCfi(from, start) !== "before" && compareCfi(from, end) !== "after";
}

/** `compareCfi` with the parsing, and with an unreadable pair reported as no order at all. */
function order(a: string, b: string): ReturnType<typeof compareCfi> {
  try {
    return compareCfi(parseCfi(a), parseCfi(b));
  } catch {
    return "incomparable";
  }
}
