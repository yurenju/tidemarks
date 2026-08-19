// The table of contents, flattened for the sidebar, and turned into the chapter boundaries
// that answer "which chapter is this section in" — the Scrubber's preview bubble and the
// sidebar's current-chapter mark are both that one question.
//
// All pure functions over what frond's `EpubBook` already parsed. The href normalisation that
// used to live here (`resolveSpineHref`, for TOC hrefs that percent-encode a comma the
// manifest writes literally) is gone: frond resolves an href by URL rules at the parsing layer
// and hands over `target.path`, so there is nothing left to repair.

import type { TocItem } from "@yurenju/frond/epub";

export interface FlatTocItem {
  label: string;
  /** The archive path this entry points at. Empty when it points outside the book. */
  path: string;
  /** The `#`-fragment, already decoded by frond. */
  fragment: string | undefined;
  /** Nesting level, 0 for a top-level entry — the sidebar indents by it. */
  depth: number;
}

export function flattenToc(items: readonly TocItem[], depth = 0): FlatTocItem[] {
  const flat: FlatTocItem[] = [];

  for (const item of items) {
    flat.push({
      label: item.label.trim(),
      // A TOC entry pointing at a remote address is kept, with no path: it still belongs
      // in the list (the book put it there), it just cannot be jumped to.
      path: item.target.kind === "in-container" ? item.target.path : "",
      fragment: item.target.kind === "in-container" ? item.target.fragment : undefined,
      depth,
    });
    flat.push(...flattenToc(item.children, depth + 1));
  }

  return flat;
}

// A chapter and the first section it covers, ascending by `startSection`. The name carries the
// unit on purpose: this used to be a fraction, and a section index read as one is off by the
// length of the book.
//
// The first chapter need not start at section 0 — a cover or front matter can sit before the
// first TOC entry.
export interface ChapterBoundary {
  label: string;
  /** The first section index this chapter covers. */
  startSection: number;
  /**
   * Its row in the flat TOC. The row rather than the label, because the sidebar marks one
   * button and two chapters sharing a label (a preface, a set of notes) is ordinary.
   */
  tocIndex: number;
}

// Which chapter each section index belongs to, ascending, for `chapterAt()`.
//
// The section index is the coordinate rather than a fraction because that is what both callers
// have: `relocate` reports it on every page turn, and `Renderer.locate()` answers with it while
// the reader drags the Scrubber. Matching is an exact path comparison: frond documents
// `TocItem.target.path` and `SectionAt.sectionPath` as the same value, which is what retired
// the suffix-matching guesswork this file used to do against epub.js's spine.
export function chapterBoundaries(
  toc: readonly FlatTocItem[],
  sectionPaths: readonly string[],
): ChapterBoundary[] {
  const seen = new Set<number>();
  const boundaries: ChapterBoundary[] = [];

  for (const [tocIndex, item] of toc.entries()) {
    if (item.path === "") continue;

    const start = sectionPaths.indexOf(item.path);
    // No match means the TOC names a document that is not in the reading order (a
    // standalone page some books link to); that chapter simply gets no label.
    if (start === -1) continue;
    // Several TOC entries inside one section — the first one wins. The Scrubber's
    // resolution is a section, so a later entry would only relabel the same stretch.
    if (seen.has(start)) continue;

    seen.add(start);
    boundaries.push({ label: item.label, startSection: start, tocIndex });
  }

  return boundaries.sort((a, b) => a.startSection - b.startSection);
}

// The chapter a section falls in, or null when it lands before the first one — the cover /
// front-matter gap, where the Scrubber shows only a percentage and the sidebar marks nothing.
//
// The resolution is a whole section. A book that puts every chapter in one XHTML file and
// separates them by `#fragment` alone gets one boundary for the lot, so the answer sticks at
// its first chapter throughout. Sharpening that needs a fact only frond has — which anchor the
// current page is past — rather than more arithmetic here.
export function chapterAt(
  sectionIndex: number,
  chapters: readonly ChapterBoundary[],
): ChapterBoundary | null {
  let found: ChapterBoundary | null = null;
  for (const c of chapters) {
    if (sectionIndex >= c.startSection) found = c;
    else break;
  }
  return found;
}
