import { readFile } from "node:fs/promises";
import { EpubBook } from "@yurenju/frond/epub";

/**
 * Where to put [[Mark]]s in the novel-length books, worked out in Node from the books' own
 * XHTML rather than asked of the reader.
 *
 * The app does not hand frond's renderer to the page, so there is no way to ask "which range
 * is on this page" from a test. What makes this workable instead is that the books are
 * generated: every child of `<body>` is one line, every ordinary paragraph is a bare `<p>`,
 * and the only element inside a paragraph is `<ruby>`. That is enough to turn a character
 * offset into an exact CFI by counting, with no DOM.
 *
 * Marks are placed by **density** — one every so many characters — rather than by page,
 * because where a page breaks is only known after layout. The spec measures how many
 * characters one page holds and derives the spacing from it, then counts what was drawn on
 * the page to report how many marks a page really carried.
 */

/** A run of text in one text node: which paragraph, which CFI step inside it. */
interface Chunk {
  /** The paragraph's CFI step under `<body>` — even, counting element children. */
  readonly paragraphStep: number;
  /** The text node's CFI step inside the paragraph — odd. */
  readonly textStep: number;
  /** Where this chunk starts in the chapter's stream of markable characters. */
  readonly from: number;
  readonly text: string;
}

export interface ChapterText {
  /** 1-based, which is also how the spine counts here: chapter c is spine step 2c. */
  readonly chapter: number;
  readonly chunks: readonly Chunk[];
  /** How many markable characters the chapter has. Ruby bases and headings are not among them. */
  readonly length: number;
}

export interface SeedMark {
  readonly id: string;
  readonly cfiRange: string;
  readonly text: string;
  readonly note: string;
  readonly color: string;
}

const COLORS = ["indigo", "ochre", "moss", "soot"] as const;

export async function readChapters(bookPath: string): Promise<ChapterText[]> {
  const book = await EpubBook.open(await readFile(bookPath));
  const decoder = new TextDecoder();
  return book.readingOrder.map((section, index) =>
    chapterText(index + 1, decoder.decode(book.bytes(section.path))),
  );
}

function chapterText(chapter: number, xhtml: string): ChapterText {
  const body = xhtml.slice(xhtml.indexOf("<body>") + "<body>".length, xhtml.indexOf("</body>"));
  const children = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const chunks: Chunk[] = [];
  let length = 0;
  children.forEach((child, index) => {
    // Headings, scene breaks and pictures carry nothing worth marking.
    if (!child.startsWith("<p>")) return;
    const inner = child.slice("<p>".length, -"</p>".length);
    // Odd parts are `<ruby>` elements; the even ones are the text nodes around them.
    const parts = inner.split(/(<ruby>.*?<\/ruby>)/);
    parts.forEach((part, at) => {
      if (at % 2 === 1 || part.length === 0) return;
      chunks.push({
        paragraphStep: (index + 1) * 2,
        textStep: at + 1,
        from: length,
        text: part,
      });
      length += part.length;
    });
  });
  return { chapter, chunks, length };
}

/** The chunk holding stream offset `at`, and the offset inside it. */
function locate(chapter: ChapterText, at: number): { chunk: Chunk; offset: number } {
  let low = 0;
  let high = chapter.chunks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (chapter.chunks[middle]!.from <= at) low = middle;
    else high = middle - 1;
  }
  const chunk = chapter.chunks[low]!;
  return { chunk, offset: at - chunk.from };
}

function step(chunk: Chunk, offset: number): string {
  return `/${chunk.paragraphStep}/${chunk.textStep}:${offset}`;
}

/** A point CFI at stream offset `at`, for opening the book there. */
export function pointAt(chapter: ChapterText, at: number): string {
  const { chunk, offset } = locate(chapter, at);
  return `epubcfi(/6/${chapter.chapter * 2}!/4${step(chunk, offset)})`;
}

/** The mark covering stream offsets [from, to). */
function mark(
  chapter: ChapterText,
  from: number,
  to: number,
  id: string,
  note: string,
  color: string,
): SeedMark {
  // Spacings are fractions of a page, so offsets arrive as fractions too, and a CFI with
  // `:11.93` in it is not one frond can resolve. Whole characters, at least one of them.
  from = Math.floor(from);
  to = Math.max(from + 1, Math.floor(to));
  const start = locate(chapter, from);
  // The end is the far side of the last character, so it stays in that character's chunk
  // rather than becoming offset 0 of the next one.
  const last = locate(chapter, to - 1);
  const text = chapter.chunks
    .filter((chunk) => chunk.from < to && chunk.from + chunk.text.length > from)
    .map((chunk) => chunk.text.slice(Math.max(0, from - chunk.from), Math.max(0, to - chunk.from)))
    .join("");
  return {
    id,
    cfiRange: `epubcfi(/6/${chapter.chapter * 2}!/4,${step(start.chunk, start.offset)},${step(last.chunk, last.offset + 1)})`,
    text,
    note,
    color,
  };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE = "What this passage made me think of, written down so as not to lose it.";

/**
 * The marks of an ordinary heavy reader: short to medium passages, one in three with a note,
 * one every `spacing` characters between `from` and `to`.
 */
export function everyday(
  chapter: ChapterText,
  from: number,
  to: number,
  spacing: number,
  prefix: string,
): SeedMark[] {
  const random = seeded(1);
  const marks: SeedMark[] = [];
  for (let at = from, n = 0; at + 40 < Math.min(to, chapter.length); at += spacing, n += 1) {
    const start = at + Math.floor(random() * spacing * 0.3);
    const end = Math.min(chapter.length, start + 4 + Math.floor(random() * 26));
    marks.push(
      mark(chapter, start, end, `${prefix}-${n}`, n % 3 === 0 ? NOTE : "", COLORS[n % 4]!),
    );
  }
  return marks;
}

/**
 * The worst page a reader could make: marks every `spacing` characters, and of them a quarter
 * running over several lines, some starting inside the one before so they overlap, some
 * running on into the next paragraph — which on a two-column page means into the next column
 * or the next page — and half carrying a note, so [[Note dot]]s stack on the same line.
 */
export function extreme(
  chapter: ChapterText,
  from: number,
  to: number,
  spacing: number,
  prefix: string,
): SeedMark[] {
  const random = seeded(2);
  const marks: SeedMark[] = [];
  let previous = { start: from, end: from };
  for (let at = from, n = 0; at + 300 < Math.min(to, chapter.length); at += spacing, n += 1) {
    const roll = random();
    let start = at;
    let length = 2 + Math.floor(random() * 7);
    if (roll < 0.25) {
      length = 60 + Math.floor(random() * 140); // several lines
    } else if (roll < 0.4) {
      start = Math.max(from, Math.floor((previous.start + previous.end) / 2)); // overlaps the last
      length = 10 + Math.floor(random() * 30);
    } else if (roll < 0.5) {
      // Runs on past the end of its paragraph into the next one.
      const { chunk } = locate(chapter, at);
      start = Math.max(at, chunk.from + chunk.text.length - 6);
      length = 30 + Math.floor(random() * 60);
    }
    const end = Math.min(chapter.length, start + length);
    marks.push(
      mark(chapter, start, end, `${prefix}-${n}`, n % 2 === 0 ? NOTE : "", COLORS[n % 4]!),
    );
    previous = { start, end };
  }
  return marks;
}

/** `count` short marks spread evenly over the given chapters. */
export function spread(
  chapters: readonly ChapterText[],
  count: number,
  prefix: string,
): SeedMark[] {
  const total = chapters.reduce((sum, chapter) => sum + chapter.length, 0);
  const marks: SeedMark[] = [];
  let n = 0;
  for (const chapter of chapters) {
    const share = Math.round((count * chapter.length) / total);
    const spacing = chapter.length / share;
    for (let k = 0; k < share; k += 1) {
      const start = Math.floor(k * spacing);
      const end = Math.min(chapter.length, start + 6);
      marks.push(
        mark(chapter, start, end, `${prefix}-${n}`, n % 3 === 0 ? NOTE : "", COLORS[n % 4]!),
      );
      n += 1;
    }
  }
  return marks;
}
