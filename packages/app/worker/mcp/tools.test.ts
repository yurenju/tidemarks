import { readFile } from "node:fs/promises";
import { EpubBook } from "@yurenju/frond/epub";
import { beforeAll, describe, expect, it } from "vitest";
import { fakeStore, type FakeShelf } from "./fake-store";
import type { StoredAnnotation, StoredProgress } from "./store";
import { ALICE_PATH, cfiFor as cfiIn, documentAt as documentIn } from "./test-book";
import { ToolError, TOOLS, type ToolContext, type ToolDefinition } from "./tools";

const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);
const TWELVE_MINUTES_AGO = NOW - 12 * 60000;

let alice: Uint8Array;
let book: EpubBook;

beforeAll(async () => {
  alice = await readFile(ALICE_PATH);
  book = await EpubBook.open(alice);
});

function tool(name: string): ToolDefinition {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

/** The first section with real prose in it — chapter 1 in this book. */
const CHAPTER_SECTION = 5;

function documentAt(sectionIndex: number) {
  return documentIn(book, sectionIndex);
}

function cfiFor(sectionIndex: number, start: number, end?: number): string {
  return cfiIn(book, sectionIndex, start, end);
}

function progress(over: Partial<StoredProgress> = {}): StoredProgress {
  return {
    bookId: "alice",
    cfi: cfiFor(CHAPTER_SECTION, 300),
    pageRange: cfiFor(CHAPTER_SECTION, 300, 500),
    percentage: 0.42,
    lastReadAt: TWELVE_MINUTES_AGO,
    ...over,
  };
}

function annotation(over: Partial<StoredAnnotation> = {}): StoredAnnotation {
  return {
    id: "a1",
    bookId: "alice",
    cfiRange: cfiFor(CHAPTER_SECTION, 300, 320),
    text: "down the rabbit-hole",
    note: "",
    color: "yellow",
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    ...over,
  };
}

function shelf(over: Partial<FakeShelf> = {}): FakeShelf {
  return {
    books: [{ id: "alice", title: "Alice", author: "Lewis Carroll", addedAt: NOW - 200_000 }],
    progress: [progress()],
    annotations: [],
    files: new Map([["alice", alice]]),
    ...over,
  };
}

function context(over: Partial<FakeShelf> = {}): ToolContext {
  return { store: fakeStore(shelf(over)), now: NOW };
}

async function run(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  return (await tool(name).run(args, ctx)) as Record<string, never>;
}

describe("list_books", () => {
  it("puts the book being read now above one imported long ago and never opened", async () => {
    const ctx = context({
      books: [
        { id: "cold", title: "Cold", author: "", addedAt: NOW - 30 * 86_400_000 },
        { id: "alice", title: "Alice", author: "Lewis Carroll", addedAt: NOW - 200_000 },
      ],
    });
    const { books } = (await run("list_books", {}, ctx)) as unknown as {
      books: { bookId: string; reading: unknown }[];
    };
    expect(books.map((b) => b.bookId)).toEqual(["alice", "cold"]);
    expect(books[1]!.reading).toBeNull();
  });

  it("floats a book imported ten seconds ago above one read last week", async () => {
    // The shelf's order is 最近碰過, not 最近閱讀 (CONTEXT.md): an import counts as touching a
    // book. Sorting on reading time alone puts every fresh import below everything ever
    // opened, because a book nobody has read has no progress row to sort by.
    const ctx = context({
      books: [
        { id: "alice", title: "Alice", author: "", addedAt: NOW - 7 * 86_400_000 },
        { id: "fresh", title: "Fresh", author: "", addedAt: NOW - 10_000 },
      ],
      progress: [progress({ bookId: "alice", lastReadAt: NOW - 6 * 86_400_000 })],
    });
    const { books } = (await run("list_books", {}, ctx)) as unknown as {
      books: { bookId: string }[];
    };
    expect(books.map((b) => b.bookId)).toEqual(["fresh", "alice"]);
  });

  it("says how old each reading position is, not just where it is", async () => {
    const { books } = (await run("list_books", {}, context())) as unknown as {
      books: { reading: { minutesAgo: number; percentage: number } }[];
    };
    expect(books[0]!.reading.minutesAgo).toBe(12);
    expect(books[0]!.reading.percentage).toBe(42);
  });
});

describe("get_reading_position", () => {
  it("hands back the page the reader could see, and calls it a page", async () => {
    const result = (await run("get_reading_position", {}, context())) as unknown as {
      passage: { kind: string; text: string };
      minutesAgo: number;
      chapter: string;
    };
    expect(result.passage.kind).toBe("page");
    expect(result.passage.text).toBe(documentAt(CHAPTER_SECTION).text.slice(300, 500));
    expect(result.minutesAgo).toBe(12);
    expect(result.chapter).toBe("I: Down the Rabbit-Hole");
  });

  it("widens a bare position when no page was recorded, and does not call that a page", async () => {
    // A device that turned the page before pageRange existed, or an image-only page. The text
    // is still useful; describing it as "what you are looking at" would not be true.
    const ctx = context({ progress: [progress({ pageRange: null })] });
    const result = (await run("get_reading_position", {}, ctx)) as unknown as {
      passage: { kind: string };
    };
    expect(result.passage.kind).toBe("around-position");
  });

  it("refuses to invent a passage when the stored position does not resolve", async () => {
    // The tempting fallback is the start of the section, and it is indistinguishable from a
    // real answer — so the agent would explain the wrong paragraph with full confidence.
    const ctx = context({
      progress: [progress({ cfi: "epubcfi(/6/9999!/4/2/1:0)", pageRange: null })],
    });
    const result = (await run("get_reading_position", {}, ctx)) as unknown as {
      passage: null;
      passageUnavailable: string;
    };
    expect(result.passage).toBeNull();
    expect(result.passageUnavailable).toContain("do not guess");
  });

  it("picks the most recently read book when no bookId is given", async () => {
    const ctx = context({
      books: [
        { id: "alice", title: "Alice", author: "", addedAt: 0 },
        { id: "other", title: "Other", author: "", addedAt: 0 },
      ],
      progress: [
        progress({ bookId: "other", lastReadAt: NOW - 3600_000 }),
        progress({ bookId: "alice", lastReadAt: TWELVE_MINUTES_AGO }),
      ],
      files: new Map([
        ["alice", alice],
        ["other", alice],
      ]),
    });
    const result = (await run("get_reading_position", {}, ctx)) as unknown as { bookId: string };
    expect(result.bookId).toBe("alice");
  });

  it("answers plainly when nothing has been read yet, rather than failing", async () => {
    const ctx = context({ progress: [] });
    const result = (await run("get_reading_position", {}, ctx)) as unknown as {
      position: null;
      note: string;
    };
    expect(result.position).toBeNull();
    expect(result.note).toContain("no book");
  });

  it("says so when the book is on the shelf but its file never arrived", async () => {
    const ctx = context({ files: new Map() });
    await expect(run("get_reading_position", {}, ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe("get_book_contents", () => {
  it("lists every section with the chapter it belongs to", async () => {
    const result = (await run("get_book_contents", { bookId: "alice" }, context())) as unknown as {
      sections: { sectionIndex: number; chapter?: string }[];
    };
    expect(result.sections).toHaveLength(book.readingOrder.length);
    expect(result.sections[CHAPTER_SECTION]!.chapter).toBe("I: Down the Rabbit-Hole");
  });

  it("rejects a call with no bookId instead of guessing one", async () => {
    await expect(run("get_book_contents", {}, context())).rejects.toBeInstanceOf(ToolError);
  });
});

describe("get_section_text", () => {
  it("slices a long section and says where to carry on from", async () => {
    const args = { bookId: "alice", sectionIndex: CHAPTER_SECTION, maxCharacters: 100 };
    const first = (await run("get_section_text", args, context())) as unknown as {
      text: string;
      hasMore: boolean;
      nextStart: number;
    };
    expect(first.text).toHaveLength(100);
    expect(first.hasMore).toBe(true);

    const second = (await run(
      "get_section_text",
      { ...args, start: first.nextStart },
      context(),
    )) as unknown as { start: number; text: string };
    expect(second.start).toBe(100);
    expect(second.text).toBe(documentAt(CHAPTER_SECTION).text.slice(100, 200));
  });

  it("reports the end of a section instead of pretending there is more", async () => {
    const result = (await run(
      "get_section_text",
      { bookId: "alice", sectionIndex: 0 },
      context(),
    )) as unknown as { hasMore: boolean; nextStart?: number };
    expect(result.hasMore).toBe(false);
    expect(result.nextStart).toBeUndefined();
  });

  it("names the section count when asked for a section that does not exist", async () => {
    await expect(
      run("get_section_text", { bookId: "alice", sectionIndex: 999 }, context()),
    ).rejects.toThrow(/has no section 999/);
  });
});

describe("search_books", () => {
  it("finds a phrase and points at where it is", async () => {
    const result = (await run("search_books", { query: "White Rabbit" }, context())) as unknown as {
      results: { bookId: string; chapter?: string; snippet: string }[];
    };
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]!.bookId).toBe("alice");
    expect(result.results[0]!.snippet).toContain("White Rabbit");
  });

  it("names the books it did not open rather than implying it read the whole shelf", async () => {
    // Nine books, a budget of eight. The ninth has to be visible in the answer, or an agent
    // reporting "nothing like that in your library" is stating something it never checked.
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`,
      title: `Book ${i}`,
      author: "",
      addedAt: i,
    }));
    const ctx = context({
      books: many,
      progress: many.map((b, i) => progress({ bookId: b.id, lastReadAt: NOW - i * 1000 })),
      files: new Map(many.map((b) => [b.id, alice])),
    });
    const result = (await run(
      "search_books",
      { query: "nothing here at all" },
      ctx,
    )) as unknown as {
      booksSearched: string[];
      booksNotSearched: { title: string }[];
    };
    expect(result.booksSearched).toHaveLength(8);
    expect(result.booksNotSearched.map((b) => b.title)).toEqual(["Book 8"]);
  });

  it("searches only the named book when given one", async () => {
    const result = (await run(
      "search_books",
      { query: "White Rabbit", bookId: "alice" },
      context(),
    )) as unknown as { booksSearched: string[] };
    expect(result.booksSearched).toEqual(["Alice"]);
  });

  it("rejects a bookId that is not on the shelf", async () => {
    await expect(
      run("search_books", { query: "x", bookId: "nope" }, context()),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

describe("list_annotations", () => {
  it("returns highlights newest first, with the note when there is one", async () => {
    const ctx = context({
      annotations: [
        annotation({ id: "old", createdAt: 1000, note: "" }),
        annotation({ id: "new", createdAt: 2000, note: "this is the bit" }),
      ],
    });
    const result = (await run("list_annotations", {}, ctx)) as unknown as {
      annotations: { note?: string; title: string }[];
    };
    expect(result.annotations[0]!.note).toBe("this is the bit");
    expect(result.annotations[1]!.note).toBeUndefined();
    expect(result.annotations[0]!.title).toBe("Alice");
  });
});
