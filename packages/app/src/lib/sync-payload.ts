// What a push puts on the wire, assembled in one place.
//
// There are two ways rows leave this device — the ordinary `fetch` push, and the `sendBeacon`
// fired as the reader switches to another app — and they have to send the *same* thing. Two
// hand-rolled payload builders would drift, and the drift would only show up as an agent
// answering from a position one page behind, which nobody would trace back to here.
import type { Annotation, BookRecord, Progress, ReadingSession, SyncBook } from "./types";

export interface SyncPayload {
  books: SyncBook[];
  progress: Omit<Progress, "dirtyAt">[];
  annotations: Omit<Annotation, "dirtyAt">[];
  readingSessions: Omit<ReadingSession, "dirtyAt">[];
}

export interface DirtyRows {
  books: BookRecord[];
  progress: Progress[];
  annotations: Annotation[];
  readingSessions: ReadingSession[];
}

// Blobs stay home: the epub body and the cover go up as their own PUTs, so the metadata row
// only says whether a cover exists.
export function toSyncBook(b: BookRecord): SyncBook {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    addedAt: b.addedAt,
    updatedAt: b.updatedAt,
    deletedAt: b.deletedAt ?? null,
    // **Or the row's own claim**, which is a device that pulled this book and has not managed to
    // download its cover yet (`lib/types.ts`). Holding the blob is not the same question as the
    // book having one, and answering with the first would be this device reporting a cover it is
    // still waiting for as one that does not exist.
    hasCover: !!b.cover || !!b.hasCover,
  };
}

// `dirtyAt` is this device's bookkeeping — the server has its own cursor and would have no
// use for it, so it never travels.
function undirty<T extends { dirtyAt?: number }>(rows: T[]): Omit<T, "dirtyAt">[] {
  return rows.map(({ dirtyAt: _dirtyAt, ...rest }) => rest);
}

export function syncPayload(dirty: DirtyRows): SyncPayload {
  return {
    books: dirty.books.map(toSyncBook),
    progress: undirty(dirty.progress),
    annotations: undirty(dirty.annotations),
    readingSessions: undirty(dirty.readingSessions),
  };
}

export function isEmptyPayload(payload: SyncPayload): boolean {
  return (
    payload.books.length +
      payload.progress.length +
      payload.annotations.length +
      payload.readingSessions.length ===
    0
  );
}

/**
 * The server's last word on the quota: how many books this account may sync (`null` for no
 * limit), which ones it currently holds, and when this device asked. Read from `/auth/me` after
 * every round, because a refused book looks no different from an accepted one in the push's
 * reply (ADR-0016). Nothing on this device records a refusal: a slot freed by a delete simply
 * shows up as room the next time this is read.
 */
export interface Quota {
  limit: number | null;
  synced: string[];
  at: number;
}

/**
 * The dirty rows the server will actually take, given its last word.
 *
 * A book outside the list goes up only while there is room, first come first served, and
 * everything belonging to a book that is not going up stays home with it — held rows keep their
 * `dirtyAt`, which is the only thing that brings them back once a slot opens. Sending them
 * anyway would have the server drop them and this device clear the flag: a reading position lost
 * without a word.
 *
 * Tombstones always travel: a deleted book takes no slot and the deletion has to reach the other
 * devices. Before the server has spoken at all, everything goes and the server does the sorting.
 */
export function withinQuota(dirty: DirtyRows, quota: Quota | null): DirtyRows {
  if (quota === null) return dirty;
  const allowed = new Set(quota.synced);
  let room = quota.limit === null ? Infinity : quota.limit - quota.synced.length;
  const books = dirty.books.filter((b) => {
    if (b.deletedAt) return true;
    if (allowed.has(b.id)) return true;
    if (room <= 0) return false;
    room -= 1;
    allowed.add(b.id);
    return true;
  });
  const deleted = new Set(books.filter((b) => b.deletedAt).map((b) => b.id));
  const goes = (bookId: string) => allowed.has(bookId) || deleted.has(bookId);
  return {
    books,
    progress: dirty.progress.filter((p) => goes(p.bookId)),
    annotations: dirty.annotations.filter((a) => goes(a.bookId)),
    readingSessions: dirty.readingSessions.filter((s) => goes(s.bookId)),
  };
}

/**
 * Whether the shelf should say this book is only on this device: signed in, and the server
 * does not list it. Not for a book imported after the server last spoke — the list could not
 * have named it yet, and the mark means "refused", not "not there yet" (#186).
 */
export function onlyOnThisDevice(quota: Quota | null, book: BookRecord): boolean {
  return (
    quota !== null && !book.deletedAt && !quota.synced.includes(book.id) && book.addedAt <= quota.at
  );
}
