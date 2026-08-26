/**
 * The four tables the shelf is stored in, turned into the one shape it is drawn from.
 *
 * Separate from the component because the rules here are answerable without a browser, and one
 * of them has no other way of being seen: **a deleted book takes its marks off the shelf with
 * it**. Deleting leaves a tombstone rather than removing the row, so a mark on a book that is
 * gone is still a live row in `annotations` until sync has carried the deletion away — and it
 * would otherwise sit on the shelf's first screen forever, quoting a book the reader no longer
 * has.
 *
 * The boundary stops at `Shelf`. Which book leads the shelf and how the wall is ordered are
 * decided at render time, because ordering the wall needs the interface language (Chinese
 * titles sort by stroke count) and the language has nothing to do with any of the rules here.
 */

import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

export interface Shelf {
  books: BookRecord[];
  progress: Map<string, Progress>;
  sessions: Map<string, ReadingSession[]>;
  /** Every passage the reader has marked, newest first. See `MarkCard`. */
  marks: Annotation[];
}

export function shelfProjection(rows: {
  books: BookRecord[];
  progress: Progress[];
  sessions: ReadingSession[];
  annotations: Annotation[];
}): Shelf {
  const books = rows.books.filter((b) => !b.deletedAt);
  const sessions = new Map<string, ReadingSession[]>();
  for (const s of rows.sessions) {
    // No key at all for a book nobody has sat with, rather than an empty array: the caller
    // reaches for these with `?? []`, and an empty array here would be a second empty.
    const kept = sessions.get(s.bookId);
    if (kept) kept.push(s);
    else sessions.set(s.bookId, [s]);
  }
  const onTheShelf = new Set(books.map((b) => b.id));
  return {
    books,
    // Orphans stay: a progress row can outlive the book on this device, and these Maps are only
    // ever read by `.get(book.id)` against the filtered list above, so an orphan is unreachable.
    progress: new Map(rows.progress.map((p) => [p.bookId, p])),
    sessions,
    marks: rows.annotations
      .filter((a) => a.deletedAt === null && onTheShelf.has(a.bookId))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}
