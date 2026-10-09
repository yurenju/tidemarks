// The book's own text around a mark: the paragraphs it was made in, each cut where the mark
// begins and ends — what the phone's one-note page sets above the note, so the reader sees the
// words they marked among the words they were marked in.
//
// **Read out of the epub, not out of the page on screen.** The note being shown is rarely on the
// page behind it: [[Previous]] and [[Next]] walk the whole book, across chapters, and the book
// underneath does not move while they do. So this asks frond's tree layer, which reads any section
// from the bytes (`ContentDocument`), rather than the renderer, which only knows the section it
// has laid out — and where one paragraph ends is a fact only that layer still holds, so it is the
// one that says so (`paragraphsAround`, frond ADR-0002: frond gives the fact, this decides what to
// set).

import { parseCfi, sectionIndexOf, type ContentDocument } from "@yurenju/frond/epub";
import { tidyPieces } from "./passage";

/** One paragraph of the book around a mark, in three runs: before the mark, the mark, after it. */
export interface MarkedParagraph {
  before: string;
  marked: string;
  after: string;
}

/** The section a CFI is in, or `undefined` when it does not name one. */
export function sectionOfCfi(cfi: string): number | undefined {
  try {
    return sectionIndexOf(parseCfi(cfi));
  } catch {
    return undefined;
  }
}

/**
 * The paragraphs a mark was made in, or `null` when the section cannot place it — a CFI that will
 * not parse, or one that points at nothing in this document. **`null` rather than the mark's own
 * text dressed up as a paragraph**: the caller has that text already and decides what to show
 * instead, and a paragraph made up here would look like the book's.
 *
 * The runs are tidied as one sentence (`tidyPieces`), so the line breaks of the XHTML are gone
 * and a seam between two runs closes up exactly as it would inside one, and ruby readings are
 * left out.
 */
export function paragraphsOf(document: ContentDocument, cfi: string): MarkedParagraph[] | null {
  let range;
  try {
    range = document.charactersForCfi(parseCfi(cfi));
  } catch {
    return null;
  }
  if (range === undefined) return null;
  const paragraphs = document.paragraphsAround(range);
  if (paragraphs.length === 0) return null;

  return paragraphs.map((paragraph) => {
    // **The readings go.** A run of prose has no "beside the line" to set them in, and left in
    // they read as the word spelled twice — `山路やまみち` (frond's `rubyTextIn` says which).
    const ruby = document.rubyTextIn(paragraph);
    const words = (start: number, end: number): string => {
      let kept = "";
      let at = start;
      for (const reading of ruby) {
        if (reading.end <= at || reading.start >= end) continue;
        kept += document.text.slice(at, Math.max(at, reading.start));
        at = Math.min(end, reading.end);
      }
      return kept + document.text.slice(at, end);
    };
    const from = Math.max(paragraph.start, range.start);
    const to = Math.min(paragraph.end, range.end);
    const [before, marked, after] = tidyPieces([
      words(paragraph.start, from),
      words(from, to),
      words(to, paragraph.end),
    ]);
    return { before: before!, marked: marked!, after: after! };
  });
}
