// Which mark the notes list points at. The order the marks arrive in is `sortByBookOrder`'s and
// which ones are on the page is the highlight layer's; what is asked here is what the list does
// with both — the open's three fallbacks, a turn onto a page with no marks, the two ends of the
// book, and the marks before the first chapter.
import { describe, expect, it } from "vitest";
import { countOf, markToOpenAt, markToTurnTo, neighbourOf } from "./annotation-position";
import type { Annotation } from "./types";

/** `/6/N` is the spine step: `/6/2` is the front matter, `/6/4` chapter One, `/6/8` chapter Two. */
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

/** Where a page in that spine section begins, as frond's `relocate` reports it. */
const pageIn = (spineStep: number) => `epubcfi(/6/${spineStep}!/4/2/2/1:0)`;

// In book order, as `readAnnotations` hands them over: one mark in the dedication before chapter
// One, two in One, two in Two.
const FRONT = mark("front", 2);
const ONE_A = mark("one-a", 4);
const ONE_B = mark("one-b", 4, "epubcfi(/6/4!/4/8,/2/1:0,/2/1:5)");
const TWO_A = mark("two-a", 8);
const TWO_B = mark("two-b", 8, "epubcfi(/6/8!/4/8,/2/1:0,/2/1:5)");
const BOOK = [FRONT, ONE_A, ONE_B, TWO_A, TWO_B];

describe("markToOpenAt", () => {
  it("opens on the page's first mark, in book order rather than the order the page lists them", () => {
    expect(markToOpenAt(BOOK, ["one-b", "one-a"], pageIn(4))?.id).toBe("one-a");
  });

  it("opens on the nearest mark further on when the page has none", () => {
    // `/6/6` is a section between One and Two that nobody marked anything in.
    expect(markToOpenAt(BOOK, [], pageIn(6))?.id).toBe("two-a");
  });

  it("opens on the last mark when nothing on or after the page is marked", () => {
    expect(markToOpenAt(BOOK, [], pageIn(12))?.id).toBe("two-b");
  });

  it("opens on a mark made before the first chapter, when that is the page the reader is on", () => {
    expect(markToOpenAt(BOOK, ["front"], pageIn(2))?.id).toBe("front");
  });

  it("falls back to the last mark when the page cannot say where it is", () => {
    // No `relocate` yet, or a position frond spelled in a way that does not parse: "further on"
    // has nothing to be further on from.
    expect(markToOpenAt(BOOK, [], null)?.id).toBe("two-b");
    expect(markToOpenAt(BOOK, [], "not-a-cfi")?.id).toBe("two-b");
  });

  it("passes over a mark whose CFI does not parse when looking further on", () => {
    const bad = mark("bad", 0, "not-a-cfi");
    expect(markToOpenAt([ONE_A, bad, TWO_A], [], pageIn(6))?.id).toBe("two-a");
  });

  it("has nothing to open on in a book with no marks", () => {
    expect(markToOpenAt([], [], pageIn(4))).toBeNull();
  });
});

describe("markToTurnTo", () => {
  it("follows the turn to the new page's first mark", () => {
    expect(markToTurnTo(BOOK, ["two-b", "two-a"])?.id).toBe("two-a");
  });

  it("stays where it is when the new page has no marks", () => {
    expect(markToTurnTo(BOOK, [])).toBeNull();
  });
});

describe("neighbourOf", () => {
  it("steps across a chapter boundary in both directions", () => {
    expect(neighbourOf(BOOK, "one-b", "next")?.id).toBe("two-a");
    expect(neighbourOf(BOOK, "two-a", "previous")?.id).toBe("one-b");
  });

  it("steps back from the first chapter into the marks before it", () => {
    expect(neighbourOf(BOOK, "one-a", "previous")?.id).toBe("front");
  });

  it("stops at either end of the book rather than wrapping around", () => {
    expect(neighbourOf(BOOK, "front", "previous")).toBeNull();
    expect(neighbourOf(BOOK, "two-b", "next")).toBeNull();
  });

  it("has no neighbours for a mark the list does not have", () => {
    expect(neighbourOf(BOOK, "gone", "next")).toBeNull();
  });
});

describe("countOf", () => {
  it("counts through the whole book, the marks before the first chapter included", () => {
    expect(countOf(BOOK, "front")).toEqual({ nth: 1, total: 5 });
    expect(countOf(BOOK, "two-a")).toEqual({ nth: 4, total: 5 });
  });

  it("has no count for a mark the list does not have", () => {
    expect(countOf(BOOK, "gone")).toBeNull();
  });
});
