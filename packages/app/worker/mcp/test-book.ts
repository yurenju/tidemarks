// Reading a real book the way a reader's device would, for tests.
//
// Both suites need the same two moves — parse a section, and write the CFI that addresses a
// stretch of it — because that is exactly what a device does before storing a position. Doing
// it here rather than in each suite keeps "what a stored CFI looks like" in one place; two
// copies would be two chances to test against a CFI no reader would ever have written.
import { resolve } from "node:path";
import { ContentDocument, EpubBook, serializeCfi } from "@yurenju/frond/epub";

/**
 * Absolute, because the runner's working directory is the repository root while this file sits
 * four levels down — and the books live at the root, shared by both packages.
 */
export const ALICE_PATH = resolve(
  import.meta.dirname,
  "../../../../tests/books/alice-in-wonderland-horizontal.epub",
);

export function documentAt(book: EpubBook, sectionIndex: number): ContentDocument {
  const path = book.readingOrder[sectionIndex]!.path;
  return ContentDocument.parse(new TextDecoder().decode(book.bytes(path)), sectionIndex);
}

/** The CFI addressing characters `[start, end)` — a range, or a point when `end` is omitted. */
export function cfiFor(book: EpubBook, sectionIndex: number, start: number, end?: number): string {
  const cfi = documentAt(book, sectionIndex).cfiForCharacters(start, end);
  if (!cfi) throw new Error(`section ${sectionIndex} has no text to address`);
  return serializeCfi(cfi);
}
