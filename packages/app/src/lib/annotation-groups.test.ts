// Cutting a book's marks into the chapters they were made in. The chapter a section belongs to
// is `toc.test.ts`'s; what is asked here is what happens at the seams — a run that continues, a
// mark the book cannot place, and a CFI that does not parse at all.
import { describe, expect, it } from "vitest";
import { groupByChapter } from "./annotation-groups";
import type { ChapterBoundary } from "./toc";
import type { Annotation } from "./types";

/** `/6/N` is the spine step, and `sectionIndexOf` reads it as `N / 2 - 1`. */
function mark(id: string, spineStep: number, cfi?: string): Annotation {
  return {
    id,
    bookId: "b1",
    cfiRange: cfi ?? `epubcfi(/6/${spineStep}!/4/2,/2/1:0,/2/1:5)`,
    text: id,
    note: "",
    color: "indigo",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

const CHAPTERS: ChapterBoundary[] = [
  { label: "One", startSection: 1, tocIndex: 0 },
  { label: "Two", startSection: 3, tocIndex: 1 },
];

describe("groupByChapter", () => {
  it("keeps consecutive marks from one chapter in a single run", () => {
    // Sections 1 and 2 are both chapter One; section 3 begins Two.
    const groups = groupByChapter([mark("a", 4), mark("b", 6), mark("c", 8)], CHAPTERS);

    expect(groups.map((g) => [g.label, g.marks.map((m) => m.id)])).toEqual([
      ["One", ["a", "b"]],
      ["Two", ["c"]],
    ]);
  });

  it("gives the front matter a run with no chapter to name", () => {
    // Section 0 is before the first boundary: a cover, or a dedication the contents leaves out.
    const groups = groupByChapter([mark("a", 2), mark("b", 4)], CHAPTERS);

    expect(groups.map((g) => [g.label, g.tocIndex])).toEqual([
      [null, null],
      ["One", 0],
    ]);
  });

  it("keeps a mark whose CFI does not parse, in the run that carries no heading", () => {
    // A row written by a version that spelled them differently is still the reader's mark, and
    // dropping it would be losing something they made rather than failing to file it.
    const groups = groupByChapter([mark("a", 4), mark("bad", 0, "not-a-cfi")], CHAPTERS);

    expect(groups.map((g) => [g.label, g.marks.map((m) => m.id)])).toEqual([
      ["One", ["a"]],
      [null, ["bad"]],
    ]);
  });

  it("opens a second run when the list returns to a chapter it has left", () => {
    // The list is in book order, so this means the book itself went back — two headings is the
    // honest answer, and one merged run would put the marks out of the order they arrived in.
    const groups = groupByChapter([mark("a", 4), mark("b", 8), mark("c", 4)], CHAPTERS);

    expect(groups.map((g) => [g.label, g.marks.map((m) => m.id)])).toEqual([
      ["One", ["a"]],
      ["Two", ["b"]],
      ["One", ["c"]],
    ]);
  });

  it("has nothing to say about a book with no marks", () => {
    expect(groupByChapter([], CHAPTERS)).toEqual([]);
  });

  it("puts every mark in one unnamed run when the book has no contents at all", () => {
    const groups = groupByChapter([mark("a", 4), mark("b", 8)], []);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
  });
});
