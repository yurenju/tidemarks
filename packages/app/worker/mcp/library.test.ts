// What can be read out of a book's bytes for an agent: the characters a CFI addresses, one
// section's text, and a search hit whose CFI reads back as the phrase it matched. The tools that
// wrap these answers are tools.test.ts; the same reading against a book in R2 is
// ../mcp.integration.test.ts.
import { readFile } from "node:fs/promises";
import { EpubBook } from "@yurenju/frond/epub";
import { beforeAll, describe, expect, it } from "vitest";
import { passageAt, searchBook, sectionText } from "./library";
import { ALICE_PATH, cfiFor as cfiIn, documentAt } from "./test-book";

// A real public-domain book, because every function here is a claim about what frond's
// zero-DOM layer answers for real bytes. Round-tripping through a synthetic CFI would only
// prove the helpers agree with themselves.
let book: EpubBook;

beforeAll(async () => {
  const bytes = await readFile(ALICE_PATH);
  book = await EpubBook.open(bytes);
});

/** What a reader's device would have stored for this stretch of the book. */
function cfiFor(sectionIndex: number, start: number, end?: number): string {
  return cfiIn(book, sectionIndex, start, end);
}

/** The first section with enough prose to slice a passage out of. */
function proseSection(): { index: number; text: string } {
  for (let index = 0; index < book.readingOrder.length; index++) {
    const doc = documentAt(book, index);
    if (doc.characters > 400) return { index, text: doc.text };
  }
  throw new Error("no section long enough");
}

describe("passageAt", () => {
  it("gives back exactly the characters a range CFI addresses", () => {
    const { index, text } = proseSection();
    const passage = passageAt(book, cfiFor(index, 100, 160));
    expect(passage?.text).toBe(text.slice(100, 160));
    expect(passage?.source).toBe("range");
  });

  it("widens a point CFI into the text around it, and says that is what it did", () => {
    // A reading position is a point, so it addresses no text at all. Returning the
    // surrounding window is useful; returning it unlabelled would let an agent claim the
    // reader is looking at a paragraph when the position is one character.
    const { index, text } = proseSection();
    const passage = passageAt(book, cfiFor(index, 200), { around: 50 });
    expect(passage?.source).toBe("around-position");
    expect(passage?.text).toBe(text.slice(150, 250));
  });

  it("reads nothing from a CFI it cannot walk, rather than falling back to the section start", () => {
    // Character 0 of the section is a confident wrong answer: it looks exactly like a real
    // position, so nothing downstream can tell the difference (frond#86).
    expect(passageAt(book, "epubcfi(/6/9999!/4/2/1:0)")).toBeUndefined();
    expect(passageAt(book, "not a cfi")).toBeUndefined();
  });

  it("clamps the window to the section rather than running off either end", () => {
    const { index, text } = proseSection();
    const passage = passageAt(book, cfiFor(index, 5), { around: 500 });
    expect(passage?.start).toBe(0);
    expect(passage?.text).toBe(text.slice(0, 505));
  });
});

describe("sectionText", () => {
  it("reads one section by index, with the archive path it came from", () => {
    const { index, text } = proseSection();
    const section = sectionText(book, index);
    expect(section?.text).toBe(text);
    expect(section?.path).toBe(book.readingOrder[index]!.path);
  });

  it("answers undefined for a section index the book does not have", () => {
    expect(sectionText(book, book.readingOrder.length)).toBeUndefined();
    expect(sectionText(book, -1)).toBeUndefined();
  });
});

describe("searchBook", () => {
  it("finds a phrase and hands back a CFI that reads back as the same phrase", () => {
    // The whole point of a hit: the agent can hand the CFI to `passageAt` (or a future
    // annotation) and land on the words it just read.
    const hits = searchBook(book, "White Rabbit", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(passageAt(book, hits[0]!.cfi)?.text).toBe("White Rabbit");
  });

  it("matches regardless of case", () => {
    expect(searchBook(book, "white rabbit", 1)).toHaveLength(1);
  });

  it("stops at the limit instead of returning the whole book", () => {
    expect(searchBook(book, "the", 3)).toHaveLength(3);
  });

  it("finds nothing for a phrase the book does not contain", () => {
    expect(searchBook(book, "quantum chromodynamics", 5)).toEqual([]);
  });

  it("carries enough text around the hit to be readable on its own", () => {
    const hit = searchBook(book, "White Rabbit", 1)[0]!;
    expect(hit.snippet).toContain("White Rabbit");
    expect(hit.snippet.length).toBeGreaterThan("White Rabbit".length);
  });
});
