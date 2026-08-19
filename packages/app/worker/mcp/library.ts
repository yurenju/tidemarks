// Turning a stored position into words, on a machine with no browser.
//
// Everything here runs on frond's zero-DOM layer: the Worker holds the same bytes the reader's
// device holds, so it can answer "what is at this CFI" without laying anything out. That is the
// whole reason the positioning sank into frond (frond#84) — the alternative was a pre-built
// text↔CFI table, which is derived data that goes stale silently.
//
// What it deliberately cannot do: say which characters share a page. A page is a product of
// layout, so only the renderer knows, and it has to tell us while the page is on screen.
import {
  ContentDocument,
  EpubBook,
  parseCfi,
  sectionIndexOf,
  serializeCfi,
} from "@yurenju/frond/epub";
import type { Cfi } from "@yurenju/frond/epub";

/** How a passage was arrived at, because the two are not equally trustworthy. */
export type PassageSource = "range" | "around-position";

export interface Passage {
  sectionIndex: number;
  /** Character offsets into the section's text; `end` is exclusive. */
  start: number;
  end: number;
  text: string;
  source: PassageSource;
}

export interface SectionText {
  sectionIndex: number;
  path: string;
  text: string;
}

export interface SearchHit {
  sectionIndex: number;
  start: number;
  end: number;
  /** The match with enough of its surroundings to read on its own. */
  snippet: string;
  /** A range CFI addressing the match itself, serialized. */
  cfi: string;
}

const SNIPPET_CONTEXT = 60;

function parse(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

/** Reads the section a CFI belongs to. `undefined` when the CFI names no section this book has. */
function documentFor(book: EpubBook, cfi: Cfi): ContentDocument | undefined {
  const index = sectionIndexOf(cfi);
  if (index === undefined) return undefined;
  return documentAt(book, index);
}

function documentAt(book: EpubBook, sectionIndex: number): ContentDocument | undefined {
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return undefined;
  const section = book.readingOrder[sectionIndex];
  if (!section) return undefined;
  try {
    return ContentDocument.parse(new TextDecoder().decode(book.bytes(section.path)), sectionIndex);
  } catch {
    // A section that will not parse is one broken section, not a broken book.
    return undefined;
  }
}

/**
 * The text a CFI addresses.
 *
 * A range CFI gives the passage itself. A **point** CFI — which is what a reading position is —
 * addresses no text, so `around` widens it into a window and the result says so: an agent that
 * cannot tell a page from a cursor will describe a paragraph the reader never chose.
 *
 * `undefined` rather than a fallback whenever the CFI cannot be read: another book's CFI, a
 * section that is gone, or a position inside `<head>`. Every one of those has an obvious
 * stand-in (the start of the section) that is indistinguishable from a real answer.
 */
export function passageAt(
  book: EpubBook,
  cfi: string,
  options: { around?: number } = {},
): Passage | undefined {
  const parsed = parse(cfi);
  if (!parsed) return undefined;
  const doc = documentFor(book, parsed);
  if (!doc) return undefined;

  const range = doc.charactersForCfi(parsed);
  if (!range) return undefined;

  if (range.end > range.start) {
    return {
      sectionIndex: doc.sectionIndex,
      start: range.start,
      end: range.end,
      text: doc.text.slice(range.start, range.end),
      source: "range",
    };
  }

  const around = options.around ?? 0;
  const start = Math.max(0, range.start - around);
  const end = Math.min(doc.text.length, range.end + around);
  return {
    sectionIndex: doc.sectionIndex,
    start,
    end,
    text: doc.text.slice(start, end),
    source: "around-position",
  };
}

/** One section's whole text. `undefined` when the book has no such section. */
export function sectionText(book: EpubBook, sectionIndex: number): SectionText | undefined {
  const doc = documentAt(book, sectionIndex);
  if (!doc) return undefined;
  return {
    sectionIndex,
    path: book.readingOrder[sectionIndex]!.path,
    text: doc.text,
  };
}

/**
 * Every place a phrase appears, up to `limit`, as CFIs that address the match.
 *
 * Matching is case-insensitive, which means searching a lowercased copy while reporting offsets
 * into the original. That only holds while lowercasing preserves length — true for CJK and for
 * Latin, false for a handful of characters (`İ`) — so a section where it does not hold is
 * searched case-sensitively rather than reported at offsets that are quietly off by one.
 */
export function searchBook(book: EpubBook, query: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  if (query === "" || limit <= 0) return hits;

  for (let index = 0; index < book.readingOrder.length && hits.length < limit; index++) {
    const doc = documentAt(book, index);
    if (!doc) continue;

    const lowered = doc.text.toLowerCase();
    const foldable = lowered.length === doc.text.length;
    const haystack = foldable ? lowered : doc.text;
    const needle = foldable ? query.toLowerCase() : query;

    let from = 0;
    while (hits.length < limit) {
      const start = haystack.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      const cfi = doc.cfiForCharacters(start, end);
      if (cfi) {
        hits.push({
          sectionIndex: index,
          start,
          end,
          snippet: doc.text.slice(
            Math.max(0, start - SNIPPET_CONTEXT),
            Math.min(doc.text.length, end + SNIPPET_CONTEXT),
          ),
          cfi: serializeCfi(cfi),
        });
      }
      from = end;
    }
  }

  return hits;
}
