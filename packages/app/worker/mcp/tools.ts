// The read tools an agent gets, shaped as questions rather than as a dump.
//
// The shelf is visible in full and so are the books' contents — an agent that can see a title
// but not read it can only guess from the title, which is worse than not seeing it. What keeps
// a conversation from swallowing the whole library is the *shape* of these tools, not a
// permission: list, then search, then fetch one section. The agent takes what it asks for.
//
// Every answer that involves a reading position carries when that position was recorded. The
// reader may have been offline for an hour, and an agent explaining the wrong page confidently
// is the failure this is here to prevent — hence the instruction in the descriptions below.
import type { EpubBook } from "@yurenju/frond/epub";
import { lastTouchedAt } from "../../src/lib/shelf-order";
import { chapterAt, chapterBoundaries, flattenToc } from "../../src/lib/toc";
import { passageAt, searchBook, sectionText } from "./library";
import type { LibraryStore, StoredBook, StoredProgress } from "./store";

export interface ToolContext {
  store: LibraryStore;
  /** Now, injected so "how many minutes ago" is testable. */
  now: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

/** A failure the agent should read and act on, as opposed to a bug in this Worker. */
export class ToolError extends Error {}

// How much text to read around a bare reading position when no page range was recorded.
const AROUND_POSITION = 400;
// One section can be a whole chapter, so section text is handed over in slices.
const SECTION_CHUNK = 6000;
const MAX_SECTION_CHUNK = 20000;
// A search with no book named opens epubs until it hits this many; the rest are named in the
// answer rather than silently dropped.
const MAX_BOOKS_PER_SEARCH = 8;
const DEFAULT_SEARCH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 50;

// --- argument reading (small, because the schemas below are the real documentation) ---

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${key} must be a string`);
  return value;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined || value === "") throw new ToolError(`${key} is required`);
  return value;
}

function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolError(`${key} must be an integer`);
  }
  return value;
}

function requiredInteger(args: Record<string, unknown>, key: string): number {
  const value = optionalInteger(args, key);
  if (value === undefined) throw new ToolError(`${key} is required`);
  return value;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- shared shapes ---

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Every position on the wire says how old it is, in both a machine form and the form the agent
 * is asked to repeat out loud. A reader who has been offline gets to hear "twelve minutes ago"
 * and say "no, I've moved on" — a position with no age gives them nothing to correct.
 */
function freshness(recordedAt: number, now: number) {
  return {
    recordedAt: isoTime(recordedAt),
    minutesAgo: Math.max(0, Math.round((now - recordedAt) / 60000)),
  };
}

async function openOrFail(ctx: ToolContext, bookId: string): Promise<EpubBook> {
  const book = await ctx.store.openBook(bookId);
  if (!book) {
    throw new ToolError(
      `no epub stored for bookId ${bookId} — it is on the shelf but its file never finished uploading`,
    );
  }
  return book;
}

/** Which chapter each section falls in, so an agent can say where it is reading from. */
function chapterTitles(book: EpubBook): (index: number) => string | undefined {
  const boundaries = chapterBoundaries(
    flattenToc(book.toc),
    book.readingOrder.map((section) => section.path),
  );
  return (index) => chapterAt(index, boundaries)?.label;
}

/**
 * The shelf's own order, which is [[Last touched]] and not "most recently read" (CONTEXT.md): the later of when the
 * reader last read a book and when they imported it.
 *
 * A book nobody has opened has no `progress` row at all, so ordering on reading time alone
 * drops every fresh import below every book ever read. Here that is worse than on the shelf,
 * where the reader can scroll: `search_books` spends its budget from the top of this list, so
 * the book imported an hour ago would be the first one dropped from the search.
 */
function byLastTouched(progress: StoredProgress[]): (a: StoredBook, b: StoredBook) => number {
  const times = new Map(progress.map((row) => [row.bookId, row]));
  return (a, b) => lastTouchedAt(b, times) - lastTouchedAt(a, times);
}

function mostRecent(progress: StoredProgress[]): StoredProgress | undefined {
  return progress.reduce<StoredProgress | undefined>(
    (best, row) => (!best || row.lastReadAt > best.lastReadAt ? row : best),
    undefined,
  );
}

// --- the tools ---

const listBooks: ToolDefinition = {
  name: "list_books",
  description:
    "The reader's whole shelf, most recently touched first — read or newly imported — with how " +
    "far into each book they are. Start here: the bookId returned by this tool is what every " +
    "other tool takes. Reading positions carry the time they were recorded — say how old one " +
    "is before explaining it.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    const [books, progress] = await Promise.all([ctx.store.books(), ctx.store.progress()]);
    const byBook = new Map(progress.map((row) => [row.bookId, row]));

    return {
      books: [...books].sort(byLastTouched(progress)).map((book) => {
        const position = byBook.get(book.id);
        return {
          bookId: book.id,
          title: book.title,
          author: book.author,
          addedAt: isoTime(book.addedAt),
          reading: position
            ? {
                percentage: Math.round(position.percentage * 100),
                ...freshness(position.lastReadAt, ctx.now),
              }
            : null,
        };
      }),
    };
  },
};

const getReadingPosition: ToolDefinition = {
  name: "get_reading_position",
  description:
    "Where the reader is right now and, when their device recorded it, the text of the page " +
    'they were looking at. This is the tool for "explain the passage I am reading". ' +
    "The answer carries minutesAgo: always tell the reader how old the position is, because a " +
    "device that was offline will have pushed nothing since, and they may have read on. " +
    "Omit bookId to get the book they read most recently.",
  inputSchema: {
    type: "object",
    properties: {
      bookId: { type: "string", description: "From list_books. Omitted means most recently read." },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const bookId = optionalString(args, "bookId");
    const progress = await ctx.store.progress();
    const position = bookId ? progress.find((row) => row.bookId === bookId) : mostRecent(progress);
    if (!position) {
      return {
        position: null,
        note: bookId
          ? "this book has no reading position recorded"
          : "no book on this shelf has a reading position yet",
      };
    }

    const books = await ctx.store.books();
    const book = books.find((row) => row.id === position.bookId);
    const epub = await openOrFail(ctx, position.bookId);

    // The page range is what the reader could actually see; the bare position is a point, and
    // widening it is a guess at the same question. Both are answered, and the answer says
    // which one it is.
    const passage = position.pageRange
      ? passageAt(epub, position.pageRange)
      : passageAt(epub, position.cfi, { around: AROUND_POSITION });

    const chapterOf = chapterTitles(epub);
    return {
      bookId: position.bookId,
      title: book?.title,
      author: book?.author,
      percentage: Math.round(position.percentage * 100),
      ...freshness(position.lastReadAt, ctx.now),
      sectionIndex: passage?.sectionIndex,
      chapter: passage ? chapterOf(passage.sectionIndex) : undefined,
      passage: passage
        ? {
            // 'page' is what was on screen. 'around-position' is the text surrounding a bare
            // position, which is not the same claim and must not be described as one.
            kind: passage.source === "range" ? "page" : "around-position",
            text: passage.text,
          }
        : null,
      passageUnavailable: passage
        ? undefined
        : "the stored position does not resolve against this epub — do not guess at the text",
    };
  },
};

const getBookContents: ToolDefinition = {
  name: "get_book_contents",
  description:
    "A book's sections in reading order, each with the chapter it belongs to. Use it to find " +
    "the sectionIndex that get_section_text takes.",
  inputSchema: {
    type: "object",
    properties: { bookId: { type: "string", description: "From list_books." } },
    required: ["bookId"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const bookId = requiredString(args, "bookId");
    const book = await openOrFail(ctx, bookId);
    const chapterOf = chapterTitles(book);
    return {
      bookId,
      title: book.metadata.title,
      language: book.metadata.language,
      sections: book.readingOrder.map((section, index) => ({
        sectionIndex: index,
        path: section.path,
        chapter: chapterOf(index),
      })),
    };
  },
};

const getSectionText: ToolDefinition = {
  name: "get_section_text",
  description:
    "The text of one section of a book. Long sections come back in slices: when hasMore is " +
    "true, call again with start set to nextStart.",
  inputSchema: {
    type: "object",
    properties: {
      bookId: { type: "string", description: "From list_books." },
      sectionIndex: { type: "integer", description: "From get_book_contents." },
      start: { type: "integer", description: "Character offset to read from. Defaults to 0." },
      maxCharacters: {
        type: "integer",
        description: `How much to read. Defaults to ${SECTION_CHUNK}, capped at ${MAX_SECTION_CHUNK}.`,
      },
    },
    required: ["bookId", "sectionIndex"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const bookId = requiredString(args, "bookId");
    const sectionIndex = requiredInteger(args, "sectionIndex");
    const book = await openOrFail(ctx, bookId);

    const section = sectionText(book, sectionIndex);
    if (!section) {
      throw new ToolError(
        `this book has no section ${sectionIndex} (it has ${book.readingOrder.length})`,
      );
    }

    const start = clamp(optionalInteger(args, "start") ?? 0, 0, section.text.length);
    const size = clamp(
      optionalInteger(args, "maxCharacters") ?? SECTION_CHUNK,
      1,
      MAX_SECTION_CHUNK,
    );
    const end = Math.min(section.text.length, start + size);

    return {
      bookId,
      sectionIndex,
      chapter: chapterTitles(book)(sectionIndex),
      characters: section.text.length,
      start,
      end,
      text: section.text.slice(start, end),
      hasMore: end < section.text.length,
      nextStart: end < section.text.length ? end : undefined,
    };
  },
};

const searchBooks: ToolDefinition = {
  name: "search_books",
  description:
    "Find a phrase across the shelf, or inside one book when bookId is given. Matching is " +
    "literal and case-insensitive, not semantic — search for wording that would appear in the " +
    'book. This is how to answer "have I read something like this before". ' +
    `Without bookId at most ${MAX_BOOKS_PER_SEARCH} books are opened, most recently touched ` +
    "first; the ones left out are named in booksNotSearched, so say so rather than implying " +
    "the whole shelf was covered.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The phrase to look for." },
      bookId: { type: "string", description: "Restrict the search to one book." },
      maxResults: {
        type: "integer",
        description: `Defaults to ${DEFAULT_SEARCH_RESULTS}, capped at ${MAX_SEARCH_RESULTS}.`,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const query = requiredString(args, "query");
    const only = optionalString(args, "bookId");
    const limit = clamp(
      optionalInteger(args, "maxResults") ?? DEFAULT_SEARCH_RESULTS,
      1,
      MAX_SEARCH_RESULTS,
    );

    const [books, progress] = await Promise.all([ctx.store.books(), ctx.store.progress()]);
    const candidates = (only ? books.filter((b) => b.id === only) : [...books]).sort(
      byLastTouched(progress),
    );
    if (only && candidates.length === 0) throw new ToolError(`no book with bookId ${only}`);

    const budget = only ? candidates.length : MAX_BOOKS_PER_SEARCH;
    const searched = candidates.slice(0, budget);
    const skipped = candidates.slice(budget);

    const results = [];
    for (const book of searched) {
      if (results.length >= limit) break;
      const epub = await ctx.store.openBook(book.id);
      if (!epub) continue;
      const chapterOf = chapterTitles(epub);
      for (const hit of searchBook(epub, query, limit - results.length)) {
        // The hit's CFI is deliberately not passed on. Nothing an agent can call here takes a
        // CFI — anchoring a note to one is #64 — so it would be an opaque string spending
        // context to no end. `searchBook` still produces it, because reading the match back
        // out of it is what proves the offsets point where they claim to.
        results.push({
          bookId: book.id,
          title: book.title,
          sectionIndex: hit.sectionIndex,
          chapter: chapterOf(hit.sectionIndex),
          snippet: hit.snippet,
        });
      }
    }

    return {
      query,
      results,
      booksSearched: searched.map((b) => b.title),
      booksNotSearched: skipped.map((b) => ({ bookId: b.id, title: b.title })),
    };
  },
};

const listAnnotations: ToolDefinition = {
  name: "list_annotations",
  description:
    "The passages the reader highlighted and any note they wrote on them, newest first. " +
    "Omit bookId for the whole shelf.",
  inputSchema: {
    type: "object",
    properties: { bookId: { type: "string", description: "Restrict to one book." } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const bookId = optionalString(args, "bookId");
    const [annotations, books] = await Promise.all([
      ctx.store.annotations(bookId),
      ctx.store.books(),
    ]);
    const titles = new Map(books.map((b) => [b.id, b.title]));
    return {
      annotations: [...annotations]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((a) => ({
          bookId: a.bookId,
          title: titles.get(a.bookId),
          text: a.text,
          note: a.note || undefined,
          color: a.color,
          createdAt: isoTime(a.createdAt),
          cfi: a.cfiRange,
        })),
    };
  },
};

export const TOOLS: ToolDefinition[] = [
  listBooks,
  getReadingPosition,
  getBookContents,
  getSectionText,
  searchBooks,
  listAnnotations,
];
