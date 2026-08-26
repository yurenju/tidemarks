// Which rows survive the trip from IndexedDB onto the shelf, and in what order. The screen those
// rows draw is packages/app/tests/browser/library/first-screen.spec.ts and marks.spec.ts; which
// book leads and how the wall is ordered are book-status.test.ts and shelf-order.test.ts.
import { describe, expect, it } from "vitest";
import { shelfProjection } from "./shelf";
import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

function book(id: string, deletedAt: number | null = null): BookRecord {
  return {
    id,
    title: id,
    author: "",
    addedAt: 0,
    file: null,
    cover: null,
    updatedAt: 0,
    deletedAt,
  };
}

function mark(id: string, bookId: string, createdAt: number, deletedAt: number | null = null) {
  return {
    id,
    bookId,
    cfiRange: "epubcfi(/6/2!/4,/2/1:0,/2/1:8)",
    text: id,
    note: "",
    color: "yellow",
    createdAt,
    updatedAt: createdAt,
    deletedAt,
  } satisfies Annotation;
}

function sitting(id: string, bookId: string): ReadingSession {
  return {
    id,
    bookId,
    startedAt: 0,
    endedAt: 1,
    startFraction: null,
    endFraction: null,
  };
}

function progressFor(bookId: string): Progress {
  return {
    bookId,
    cfi: "epubcfi(/6/2!/4)",
    pageRange: null,
    percentage: 0.5,
    chapterLabel: null,
    lastReadAt: 0,
  };
}

function rows(over: Partial<Parameters<typeof shelfProjection>[0]> = {}) {
  return { books: [], progress: [], sessions: [], annotations: [], ...over };
}

describe("who is on the shelf", () => {
  it("leaves out a deleted book", () => {
    const shelf = shelfProjection(rows({ books: [book("gone", 1), book("here")] }));

    expect(shelf.books.map((b) => b.id)).toEqual(["here"]);
  });

  it("takes a deleted book's marks off with it", () => {
    const shelf = shelfProjection(
      rows({
        books: [book("gone", 1), book("here")],
        annotations: [mark("m1", "gone", 1), mark("m2", "here", 2)],
      }),
    );

    expect(shelf.marks.map((m) => m.id)).toEqual(["m2"]);
  });

  it("leaves out a deleted mark while its book stays", () => {
    const shelf = shelfProjection(
      rows({ books: [book("here")], annotations: [mark("m1", "here", 1, 9)] }),
    );

    expect(shelf.books.map((b) => b.id)).toEqual(["here"]);
    expect(shelf.marks).toEqual([]);
  });
});

describe("order", () => {
  it("puts the newest mark first", () => {
    const shelf = shelfProjection(
      rows({
        books: [book("here")],
        annotations: [mark("old", "here", 1), mark("new", "here", 3), mark("mid", "here", 2)],
      }),
    );

    expect(shelf.marks.map((m) => m.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("grouping", () => {
  it("collects one book's sittings under one key", () => {
    const shelf = shelfProjection(
      rows({
        books: [book("here")],
        sessions: [sitting("s1", "here"), sitting("s2", "here")],
      }),
    );

    expect(shelf.sessions.get("here")?.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("has no key at all for a book nobody has sat with", () => {
    const shelf = shelfProjection(rows({ books: [book("here")] }));

    expect(shelf.sessions.has("here")).toBe(false);
  });
});

describe("rows that do not line up", () => {
  // Sync can land a progress row for a book this device no longer has: the book's tombstone and
  // the progress arrive in either order. The Map is only ever read by `.get(book.id)`, so the
  // orphan is unreachable — filtering it out would be work for nobody.
  it("keeps an orphan progress row without touching the shelf", () => {
    const shelf = shelfProjection(
      rows({ books: [book("here")], progress: [progressFor("here"), progressFor("vanished")] }),
    );

    expect(shelf.books.map((b) => b.id)).toEqual(["here"]);
    expect(shelf.progress.get("vanished")).toBeDefined();
  });

  it("turns four empty tables into an empty shelf", () => {
    const shelf = shelfProjection(rows());

    expect(shelf.books).toEqual([]);
    expect(shelf.marks).toEqual([]);
    expect(shelf.progress.size).toBe(0);
    expect(shelf.sessions.size).toBe(0);
  });
});
