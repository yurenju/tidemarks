// The marks in a book, cut into the chapters they were made in.
//
// **Which chapter a mark belongs to is a fact about its CFI**, and the same one the Scrubber and
// the contents list already ask: the spine section the CFI names, then the chapter that section
// falls in (`lib/toc.ts`). Nothing here needs a renderer or a DOM — `sectionIndexOf` reads the
// spine step out of the parsed CFI.
//
// **The order is the caller's, not this file's.** `readAnnotations` hands the panel its marks in
// book order already (`sortByBookOrder`, `lib/export.ts`), so grouping is a walk that starts a
// new run whenever the chapter changes. Grouping by identity instead — a map keyed by chapter —
// would silently reorder a list that arrived unsorted, and hide the fact that it had.

import { parseCfi, sectionIndexOf } from "@yurenju/frond/epub";
import type { ChapterBoundary } from "./toc";
import { chapterAt } from "./toc";
import type { Annotation } from "./types";

export interface AnnotationGroup {
  /**
   * The chapter's row in the flat TOC, or `null` for marks that fall before the first chapter —
   * a cover, a dedication, front matter a book leaves out of its contents.
   *
   * The row rather than the label, because two chapters may share a label and the panel wants a
   * stable key for each run.
   */
  tocIndex: number | null;
  /** What the chapter is called, or `null` where there is no chapter to name. */
  label: string | null;
  marks: Annotation[];
}

/**
 * The chapter a mark was made in, or `null` when the book cannot say.
 *
 * Three ways to reach `null`, and they are one answer on purpose: the CFI does not parse (a row
 * written by a version that spelled them differently), it names no spine section, or it lands
 * before the first chapter. In all three the mark is still the reader's and still belongs in the
 * panel — it just goes in the run that carries no heading.
 */
function chapterOf(mark: Annotation, chapters: readonly ChapterBoundary[]): ChapterBoundary | null {
  let section: number | undefined;
  try {
    section = sectionIndexOf(parseCfi(mark.cfiRange));
  } catch {
    return null;
  }
  if (section === undefined) return null;
  return chapterAt(section, chapters);
}

export function groupByChapter(
  marks: readonly Annotation[],
  chapters: readonly ChapterBoundary[],
): AnnotationGroup[] {
  const groups: AnnotationGroup[] = [];

  for (const mark of marks) {
    const chapter = chapterOf(mark, chapters);
    const tocIndex = chapter?.tocIndex ?? null;
    const last = groups.at(-1);
    // A run continues while the chapter holds. A book that returns to an earlier chapter later
    // in the list gets that chapter's heading twice, which is the honest answer: the list is in
    // book order, and two runs is what the book did.
    if (last !== undefined && last.tocIndex === tocIndex) last.marks.push(mark);
    else groups.push({ tocIndex, label: chapter?.label ?? null, marks: [mark] });
  }

  return groups;
}
