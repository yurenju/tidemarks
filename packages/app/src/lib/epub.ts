import { EpubBook } from "@yurenju/frond/epub";
import type { BookRecord, StoredCover } from "./types";

export async function importEpubFile(file: File): Promise<BookRecord> {
  const buffer = await file.arrayBuffer();
  const book = await EpubBook.open(buffer);

  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: book.metadata.title || file.name.replace(/\.epub$/i, ""),
    author: book.metadata.authors.join(", "),
    addedAt: now,
    // The very buffer that was parsed. Putting it in IndexedDB structured-clones it, so the
    // stored copy is independent of whatever `EpubBook` goes on holding views onto.
    file: buffer,
    cover: coverImage(book),
    updatedAt: now,
    deletedAt: null,
    dirtyAt: now,
  };
}

// A book with no cover, a cover the manifest points at but the archive lacks, and a cover
// whose bytes will not decode all arrive here as `undefined` — frond treats none of them as
// an error, and neither does the shelf.
function coverImage(book: EpubBook): StoredCover | null {
  const cover = book.cover;
  if (!cover) return null;
  // `slice()` copies into a buffer of its own, exactly the size of the image. frond's bytes are
  // a view onto the whole decoded archive, so handing on `cover.bytes.buffer` would store the
  // entire book to draw a thumbnail.
  return { bytes: cover.bytes.slice().buffer, type: cover.mediaType };
}

// Text from the front of the book, for deciding Simplified vs Traditional (see
// `chinese.ts`). Under epub.js this came from a content-document hook, which frond does not
// have and should not: the book renders inside an iframe (frond's ADR-0006) and reaching
// into it is exactly what that boundary exists to stop. The bytes are a better source
// anyway — the decision is made once at open, from real prose, instead of drifting as the
// reader turns pages.
export function sampleText(book: EpubBook, limit = 5000): string {
  let sample = "";

  for (const section of book.readingOrder) {
    let source: string;
    try {
      source = new TextDecoder().decode(book.bytes(section.path));
    } catch {
      continue; // an unreadable section is no reason to give up on the language
    }

    sample += textFromXhtml(source);
    if (sample.length >= limit) break;
  }

  return sample.slice(0, limit);
}

// Strips markup down to the prose. Deliberately a text pass rather than `DOMParser`: this
// runs at import time in the browser and under vitest in Node, and what it feeds
// (`detectVariant` counting Han characters) cannot tell the difference between this and a
// real parse. `<style>` and `<script>` go first — their content is not prose, and CSS
// selectors would otherwise pour into the sample.
export function textFromXhtml(source: string): string {
  return source
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
