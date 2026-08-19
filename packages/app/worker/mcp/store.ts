// What the tools are allowed to ask for, and nothing else.
//
// The tools are the interesting part and they should be testable against a real book without a
// D1 database or an R2 bucket in the room, so everything they need to reach outside themselves
// goes through here. `d1-store.ts` is the one implementation that talks to Cloudflare.
//
// Read-only on purpose (#63). Writing notes back is #64, and when it lands it gets its own
// interface rather than an extra method here — a store an agent cannot write through is a
// property worth being able to see at a glance.
import type { EpubBook } from "@yurenju/frond/epub";

export interface StoredBook {
  id: string;
  title: string;
  author: string;
  addedAt: number;
}

export interface StoredProgress {
  bookId: string;
  cfi: string;
  pageRange: string | null;
  percentage: number;
  /** Client time, and the only honest answer to "how old is this position". */
  lastReadAt: number;
}

export interface StoredAnnotation {
  id: string;
  bookId: string;
  cfiRange: string;
  /** The passage as it read when the highlight was made. */
  text: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryStore {
  /** The shelf, tombstones already filtered out. */
  books(): Promise<StoredBook[]>;
  /** Every book's reading position. */
  progress(): Promise<StoredProgress[]>;
  annotations(bookId?: string): Promise<StoredAnnotation[]>;
  /** The epub itself. `undefined` when the book has no body stored (import never finished). */
  openBook(bookId: string): Promise<EpubBook | undefined>;
}
