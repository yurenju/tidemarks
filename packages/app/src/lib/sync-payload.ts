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
    hasCover: !!b.cover,
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
