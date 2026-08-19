// A shelf held in memory, with a real epub behind it, so the tools can be tested end to end
// without D1 or R2. Test-only, which is why it takes bytes rather than knowing how to find a
// book: what a test wants to vary is the shelf, never the storage.
import { EpubBook } from "@yurenju/frond/epub";
import type { LibraryStore, StoredAnnotation, StoredBook, StoredProgress } from "./store";

export interface FakeShelf {
  books: StoredBook[];
  progress: StoredProgress[];
  annotations: StoredAnnotation[];
  /** bookId to epub bytes. A book missing from here is one whose upload never finished. */
  files: Map<string, Uint8Array>;
}

export function fakeStore(shelf: FakeShelf): LibraryStore {
  const opened = new Map<string, EpubBook>();
  return {
    async books() {
      return shelf.books;
    },
    async progress() {
      return shelf.progress;
    },
    async annotations(bookId) {
      return bookId ? shelf.annotations.filter((a) => a.bookId === bookId) : shelf.annotations;
    },
    async openBook(bookId) {
      const cached = opened.get(bookId);
      if (cached) return cached;
      const bytes = shelf.files.get(bookId);
      if (!bytes) return undefined;
      const book = await EpubBook.open(bytes);
      opened.set(bookId, book);
      return book;
    },
  };
}
