import { describe, it, expect } from "vitest";
import { annotationsToMarkdown, serializeExport, parseImport } from "./export";
import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

const book = (over: Partial<BookRecord> = {}): BookRecord => ({
  id: "b1",
  title: "My Book",
  author: "Alice",
  addedAt: 1000,
  file: new Blob(["epub-bytes"], { type: "application/epub+zip" }),
  cover: null,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: "a1",
  bookId: "b1",
  cfiRange: "epubcfi(/6/4!/4/2,/2/1:0,/2/1:5)",
  text: "quoted text",
  note: "",
  color: "yellow",
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

describe("annotationsToMarkdown", () => {
  it("renders title, author, quotes and notes", () => {
    const md = annotationsToMarkdown(book(), [
      ann({ text: "first quote", note: "my thought" }),
      ann({ id: "a2", cfiRange: "epubcfi(/6/8!/4/2,/2/1:0,/2/1:5)", text: "second quote" }),
    ]);
    expect(md).toContain("# My Book");
    expect(md).toContain("Alice");
    expect(md).toContain("> first quote");
    expect(md).toContain("my thought");
    expect(md).toContain("> second quote");
  });

  it("orders annotations by position in the book, not creation time", () => {
    const later = ann({
      id: "a2",
      cfiRange: "epubcfi(/6/4!/4/2,/2/1:0,/2/1:5)",
      text: "earlier in book",
      createdAt: 2000,
    });
    const earlier = ann({
      id: "a1",
      cfiRange: "epubcfi(/6/10!/4/2,/2/1:0,/2/1:5)",
      text: "later in book",
      createdAt: 1000,
    });
    const md = annotationsToMarkdown(book(), [earlier, later]);
    expect(md.indexOf("earlier in book")).toBeLessThan(md.indexOf("later in book"));
  });
});

describe("export/import round-trip", () => {
  it("restores books, progress, annotations and sessions", async () => {
    const books = [book({ cover: new Blob(["png"], { type: "image/png" }) })];
    const progress: Progress[] = [
      {
        bookId: "b1",
        cfi: "epubcfi(/6/4!/4/2/1:0)",
        pageRange: "epubcfi(/6/4!/4,/2/1:0,/8/1:12)",
        percentage: 0.42,
        chapterLabel: "第七章",
        lastReadAt: 2000,
      },
    ];
    const annotations = [ann({ note: "note!" })];
    const sessions: ReadingSession[] = [
      {
        id: "s1",
        bookId: "b1",
        startedAt: 1000,
        endedAt: 2000,
        startFraction: 0.1,
        endFraction: 0.3,
      },
    ];

    const json = await serializeExport({ books, progress, annotations, sessions });
    const restored = await parseImport(json);

    // imported rows are marked dirty so they sync; compare the content fields
    expect(restored.progress[0]).toMatchObject(progress[0]!);
    expect(restored.annotations[0]).toMatchObject(annotations[0]!);
    expect(
      restored.sessions.map(({ id, bookId, startedAt, endedAt, startFraction, endFraction }) => ({
        id,
        bookId,
        startedAt,
        endedAt,
        startFraction,
        endFraction,
      })),
    ).toEqual(sessions);

    const b = restored.books[0]!;
    expect(b.id).toBe("b1");
    expect(b.title).toBe("My Book");
    expect(await b.file!.text()).toBe("epub-bytes");
    expect(b.file!.type).toBe("application/epub+zip");
    expect(await b.cover!.text()).toBe("png");
  });

  // A backup taken before a sitting recorded where in the book it happened. The duration is
  // real and comes back; the place is not recoverable, and `null` is what says so — leaving the
  // field off would make `stats.ts` read `undefined` as a position at the front of the book.
  it("brings back a sitting that never carried its place in the book", async () => {
    const json = JSON.stringify({
      version: 1,
      books: [],
      progress: [
        { bookId: "b1", cfi: "epubcfi(/6/2)", pageRange: null, percentage: 0.4, lastReadAt: 1 },
      ],
      annotations: [],
      sessions: [{ id: "s1", bookId: "b1", startedAt: 1000, endedAt: 2000 }],
    });
    const restored = await parseImport(json);
    expect(restored.sessions[0]).toMatchObject({ startFraction: null, endFraction: null });
    expect(restored.progress[0]).toMatchObject({ chapterLabel: null });
  });

  it("rejects unknown version", async () => {
    await expect(parseImport(JSON.stringify({ version: 999 }))).rejects.toThrow(/version/i);
  });

  it("rejects malformed json", async () => {
    await expect(parseImport("not json")).rejects.toThrow();
  });
});
