import Dexie, { type EntityTable } from "dexie";
import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

export interface MetaRow {
  key: string;
  value: number;
}

/**
 * One CJK face Folis carries (ADR-0014), as it sits on this device.
 *
 * **A Blob, not an ArrayBuffer.** A face is 16 MB, and an ArrayBuffer read back out of
 * IndexedDB is 16 MB of memory; a Blob read back out is still a reference to something the
 * browser keeps on disk until it is asked for.
 */
export interface FontRow {
  /** family and weight — `web-font.ts`'s `webFontKey`. */
  key: string;
  file: Blob;
}

export const db = new Dexie("folis") as Dexie & {
  books: EntityTable<BookRecord, "id">;
  progress: EntityTable<Progress, "bookId">;
  annotations: EntityTable<Annotation, "id">;
  readingSessions: EntityTable<ReadingSession, "id">;
  meta: EntityTable<MetaRow, "key">;
  fonts: EntityTable<FontRow, "key">;
};

db.version(1).stores({
  books: "id, addedAt",
  progress: "bookId",
  annotations: "id, bookId",
  sessions: "++id, bookId",
});

// v2: sessions renamed to readingSessions with UUID ids (auto-increment ids
// collide across devices), dirtyAt on every table, meta holds the sync cursor.
// No upgrade logic by design: pre-sync data is not migrated (confirmed decision).
db.version(2).stores({
  books: "id, addedAt, dirtyAt",
  progress: "bookId, dirtyAt",
  annotations: "id, bookId, dirtyAt",
  sessions: null,
  readingSessions: "id, bookId, dirtyAt",
  meta: "key",
});

// v3: the CJK faces Folis carries. **No `dirtyAt`, and that is not an oversight** — the
// other four tables carry one because they hold what the reader made, which belongs on every
// device they read on. This holds a file anyone can fetch from Folis's own origin, so
// pushing 16 MB of it through the sync payload would buy nothing. Each device fetches its
// own copy the first time it opens a book that needs one.
db.version(3).stores({
  fonts: "key",
});

export async function getSyncCursor(): Promise<number> {
  return (await db.meta.get("syncCursor"))?.value ?? 0;
}

export async function setSyncCursor(value: number): Promise<void> {
  await db.meta.put({ key: "syncCursor", value });
}
