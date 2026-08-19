import { describe, expect, it } from "vitest";
import type { TocItem } from "@yurenju/frond/epub";
import { chapterAt, chapterBoundaries, flattenToc } from "./toc";

// The href repair this file used to test is gone with the library that needed it: epub.js
// keyed its spine by the manifest href and could not match a nav href that percent-encoded a
// comma, so a TOC click silently did nothing. frond resolves hrefs by URL rules in the
// parsing layer and hands over `target.path`, so these tests are about what spine still
// decides — flattening for the sidebar, and which chapter a section belongs to.

function item(label: string, path: string, children: TocItem[] = [], fragment?: string): TocItem {
  return {
    label,
    href: path,
    target: { kind: "in-container", path, fragment },
    children,
  };
}

describe("flattenToc", () => {
  it("walks children depth-first, recording the nesting level", () => {
    const flat = flattenToc([
      item("第一部", "part1.xhtml", [item("第一章", "ch1.xhtml", [item("第一節", "ch1.xhtml")])]),
      item("第二部", "part2.xhtml"),
    ]);

    expect(flat.map((i) => [i.label, i.depth])).toEqual([
      ["第一部", 0],
      ["第一章", 1],
      ["第一節", 2],
      ["第二部", 0],
    ]);
  });

  it("trims the label, because books pad them for the nav document", () => {
    expect(flattenToc([item("  第一章\n", "ch1.xhtml")])[0]!.label).toBe("第一章");
  });

  it("keeps the fragment, which is how a TOC points inside a section", () => {
    const flat = flattenToc([item("第二節", "ch1.xhtml", [], "sec2")]);
    expect(flat[0]).toMatchObject({ path: "ch1.xhtml", fragment: "sec2" });
  });

  it("keeps an entry pointing outside the book, but with no path to jump to", () => {
    // The book put it in its own TOC, so the reader should see it; it just cannot be
    // navigated to, and the sidebar disables it on `path === ''`.
    const remote: TocItem = {
      label: "出版社網站",
      href: "https://example.com",
      target: { kind: "remote", url: "https://example.com" },
      children: [],
    };
    expect(flattenToc([remote])[0]).toMatchObject({ label: "出版社網站", path: "" });
  });
});

describe("chapterBoundaries", () => {
  const sections = ["cover.xhtml", "ch1.xhtml", "ch2.xhtml", "ch3.xhtml"];

  it("keys each chapter by the section index the Scrubber will land on", () => {
    const toc = flattenToc([item("第一章", "ch1.xhtml"), item("第三章", "ch3.xhtml")]);

    expect(chapterBoundaries(toc, sections)).toEqual([
      { label: "第一章", startSection: 1, tocIndex: 0 },
      { label: "第三章", startSection: 3, tocIndex: 1 },
    ]);
  });

  it("records which row of the flat TOC the chapter came from", () => {
    // Entries naming no section at all are skipped, so the row cannot be counted off the
    // boundary list — it has to be carried from the flattening.
    const toc = flattenToc([
      item("版權頁", "colophon.xhtml"),
      item("第一章", "ch1.xhtml", [item("第一節", "ch2.xhtml")]),
    ]);

    expect(chapterBoundaries(toc, sections)).toEqual([
      { label: "第一章", startSection: 1, tocIndex: 1 },
      { label: "第一節", startSection: 2, tocIndex: 2 },
    ]);
  });

  it("tells two chapters of the same name apart", () => {
    // A book with two 「注釋」 is ordinary, and the sidebar marks one button. Matching on the
    // label would mark whichever came first.
    const toc = flattenToc([item("注釋", "ch1.xhtml"), item("注釋", "ch3.xhtml")]);

    expect(chapterBoundaries(toc, sections).map((b) => b.tocIndex)).toEqual([0, 1]);
  });

  it("sorts by section, whatever order the TOC listed them in", () => {
    const toc = flattenToc([item("第三章", "ch3.xhtml"), item("第一章", "ch1.xhtml")]);

    expect(chapterBoundaries(toc, sections).map((b) => b.startSection)).toEqual([1, 3]);
  });

  it("keeps the first of several entries inside one section", () => {
    // A section holding two TOC entries is common (a chapter and its first subsection). The
    // Scrubber's resolution is a section, so a later entry would only relabel the same
    // stretch.
    const toc = flattenToc([
      item("第一章", "ch1.xhtml", [item("第一節", "ch1.xhtml", [], "sec1")]),
    ]);

    expect(chapterBoundaries(toc, sections)).toEqual([
      { label: "第一章", startSection: 1, tocIndex: 0 },
    ]);
  });

  it("skips an entry naming a document that is not in the reading order", () => {
    // Some books link a standalone page from the nav document. That chapter simply gets no
    // label rather than dragging the whole index out of alignment.
    const toc = flattenToc([item("版權頁", "colophon.xhtml"), item("第一章", "ch1.xhtml")]);

    expect(chapterBoundaries(toc, sections)).toEqual([
      { label: "第一章", startSection: 1, tocIndex: 1 },
    ]);
  });

  it("leaves the front matter before the first chapter unlabelled", () => {
    // `chapterAt` returns null there, and the Scrubber shows only the percentage — the cover
    // is not a chapter, and naming it after the first one would be a lie.
    const toc = flattenToc([item("第一章", "ch1.xhtml")]);
    expect(chapterBoundaries(toc, sections)[0]!.startSection).toBeGreaterThan(0);
  });
});

describe("chapterAt", () => {
  // Boundaries are section indices, ascending. The first chapter need not start at section 0:
  // a cover or front matter sits before the first TOC entry.
  const chapters = [
    { label: "第一章", startSection: 1, tocIndex: 0 },
    { label: "第二章", startSection: 4, tocIndex: 1 },
    { label: "第三章", startSection: 7, tocIndex: 2 },
  ];

  it("returns the chapter whose sections contain this one", () => {
    expect(chapterAt(2, chapters)?.label).toBe("第一章");
    expect(chapterAt(5, chapters)?.label).toBe("第二章");
    expect(chapterAt(9, chapters)?.label).toBe("第三章");
  });

  it("treats a chapter start as inclusive", () => {
    expect(chapterAt(4, chapters)?.label).toBe("第二章");
  });

  it("answers with the row to mark, not just the label", () => {
    expect(chapterAt(5, chapters)?.tocIndex).toBe(1);
  });

  it("tells two chapters of the same name apart by their row", () => {
    const repeated = [
      { label: "注釋", startSection: 1, tocIndex: 0 },
      { label: "注釋", startSection: 4, tocIndex: 3 },
    ];
    expect(chapterAt(5, repeated)?.tocIndex).toBe(3);
  });

  it("returns null before the first chapter (cover / front-matter gap)", () => {
    expect(chapterAt(0, chapters)).toBeNull();
  });

  it("returns null when there are no chapters", () => {
    expect(chapterAt(3, [])).toBeNull();
  });
});
