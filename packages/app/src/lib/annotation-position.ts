// Which mark the notes list is pointing at: where it scrolls when it opens, where it follows a
// page turn to, and — for the phone's one-note-at-a-time view — what is before and after a mark and
// how far through the book it is.
//
// **Every answer is a mark or nothing**, never a chapter or an offset. Scrolling to it is the
// caller's business, and so is the fact that "scrolled to" is not "selected": a list that opens on
// the page's first mark has still been pressed nowhere (`lib/chrome.ts`, on `notesToggled`).
//
// **The order is the caller's, as in `lib/annotation-groups.ts`.** The marks arrive in book order
// (`sortByBookOrder`, `lib/export.ts`) and "first", "next" and "nth" here are positions in that
// list. Sorting again here would be a second opinion on an order that already has one source.
//
// **What is on the page is the caller's too.** Only the renderer can say which marks the page in
// front of the reader holds — it is the set the highlight layer painted — so it comes in as ids,
// and nothing here needs a renderer or a DOM.

import { compareCfi, parseCfi, type Cfi } from "@yurenju/frond/epub";
import type { Annotation } from "./types";

/** The first mark, in book order, that is on the page. */
function firstOnPage(marks: readonly Annotation[], onPage: readonly string[]): Annotation | null {
  if (onPage.length === 0) return null;
  const showing = new Set(onPage);
  return marks.find((mark) => showing.has(mark.id)) ?? null;
}

function tryParse(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

/**
 * Where the list scrolls when it opens: the page's first mark; failing that, the nearest one
 * further on in the book; failing that, the last one.
 *
 * `pageStart` is the CFI of where the page begins, and only the second rung needs it — "further on"
 * is a question about the page, and a page with no marks on it is not in the list to ask. A mark
 * whose CFI does not parse, or one frond cannot order against the page, is passed over on that rung
 * rather than guessed at: the third rung still lands the reader somewhere.
 *
 * `null` only for a book with no marks.
 */
export function markToOpenAt(
  marks: readonly Annotation[],
  onPage: readonly string[],
  pageStart: string | null,
): Annotation | null {
  const here = firstOnPage(marks, onPage);
  if (here !== null) return here;

  const page = pageStart === null ? undefined : tryParse(pageStart);
  if (page !== undefined) {
    const ahead = marks.find((mark) => {
      const at = tryParse(mark.cfiRange);
      return at !== undefined && compareCfi(at, page) === "after";
    });
    if (ahead !== undefined) return ahead;
  }

  return marks.at(-1) ?? null;
}

/**
 * Where the list follows a page turn to: the new page's first mark, or `null` — stay where you
 * are — when the page has none.
 *
 * **Not the open's fallbacks.** Opening has to land somewhere; a turn onto a page of plain text
 * has nothing new to show, and pulling the list down to the next mark would move it under a reader
 * who may be reading it.
 */
export function markToTurnTo(
  marks: readonly Annotation[],
  onPage: readonly string[],
): Annotation | null {
  return firstOnPage(marks, onPage);
}

/**
 * The mark before or after one, in book order and across chapters. `null` at either end of the
 * book — the first mark has nothing before it and the last nothing after, and wrapping around
 * would carry the reader from the last chapter to the first without saying so — and for an id the
 * list does not have.
 */
export function neighbourOf(
  marks: readonly Annotation[],
  id: string,
  direction: "previous" | "next",
): Annotation | null {
  const at = marks.findIndex((mark) => mark.id === id);
  if (at === -1) return null;
  return marks[direction === "next" ? at + 1 : at - 1] ?? null;
}

/**
 * How far through the book's marks one is: the `nth` of `total`, counting from one, over the whole
 * book rather than its chapter. `null` for an id the list does not have.
 */
export function countOf(
  marks: readonly Annotation[],
  id: string,
): { nth: number; total: number } | null {
  const at = marks.findIndex((mark) => mark.id === id);
  if (at === -1) return null;
  return { nth: at + 1, total: marks.length };
}
