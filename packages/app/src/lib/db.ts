import Dexie, { type EntityTable } from "dexie";
import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

/**
 * The odds and ends that belong to this device rather than to the reader.
 *
 * `value` is a number or a string because the two things in here are: the sync cursor is a
 * timestamp, and the day's revisit batch is JSON. Nothing in this table syncs — the schema is
 * keyed on `key` alone, so a new kind of value needs no version of its own.
 */
export interface MetaRow {
  key: string;
  value: number | string;
}

/**
 * One CJK face Tidemarks carries (ADR-0014), as it sits on this device.
 *
 * **A Blob, not an ArrayBuffer.** A face is 19 MB, and an ArrayBuffer read back out of
 * IndexedDB is 19 MB of memory; a Blob read back out is still a reference to something the
 * browser keeps on disk until it is asked for.
 */
export interface FontRow {
  /**
   * The family — `web-font.ts`'s `webFontKey`.
   *
   * It used to be `family/weight`, from when a face was two static files. Rows still under
   * those keys are deleted rather than left (`web-font-store.ts`'s `forgetStaleFonts`).
   */
  key: string;
  file: Blob;
}

export const db = new Dexie("tidemarks") as Dexie & {
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

// v3: the CJK faces Tidemarks carries. **No `dirtyAt`, and that is not an oversight** — the
// other four tables carry one because they hold what the reader made, which belongs on every
// device they read on. This holds a file anyone can fetch from Tidemarks' own origin, so
// pushing 16 MB of it through the sync payload would buy nothing. Each device fetches its
// own copy the first time it opens a book that needs one.
db.version(3).stores({
  fonts: "key",
});

// v4: no schema change at all — the cursor goes back to the start so that every book row is
// pulled once more.
//
// `BookRecord.hasCover` is what those rows are wanted for. It is the record of a cover this
// device is owed, and a book already sitting with the empty card of #120 is precisely a book
// whose row no pull will send again — so without one round from the beginning, the fix would
// only ever cover failures that happen from here on, and the shelves it was written for would
// stay as they are.
//
// The re-pull costs one round of rows this device already agrees with. Every write a pull makes
// is a merge against what is here (`lib/merge.ts`), so arriving twice changes nothing.
db.version(4).upgrade((tx) => tx.table("meta").delete("syncCursor"));

// v5: `BookRecord.file` and `.cover` stopped being Blobs (`types.ts` has why). No schema change
// — Dexie stores whatever the record holds — so this exists only to let the rows already on a
// device say something true.
//
// **The bytes are dropped rather than converted.** Turning a Blob into an ArrayBuffer means
// awaiting `blob.arrayBuffer()`, and an IndexedDB transaction closes on the first await of a
// promise that is not its own — so the conversion cannot happen inside an upgrade at all. What
// it drops is re-fetchable: a book with a null `file` is exactly the state lazy download is
// written for (`Reader.tsx` fetches it on open), and a null `cover` beside `hasCover` is the
// state `lib/sync.ts` already asks the server about on the next round.
//
// The reader's own work — where they are, what they marked, what they wrote — is in other
// tables and is not touched. A reader who never registered re-imports the epub, which is the
// cost this takes, and it is taken because Tidemarks has not launched (ADR-0004).
db.version(5).upgrade((tx) =>
  tx
    .table("books")
    .toCollection()
    .modify((book: { file: unknown; cover: unknown }) => {
      if (book.file instanceof Blob) book.file = null;
      if (book.cover instanceof Blob) book.cover = null;
    }),
);

export async function getSyncCursor(): Promise<number> {
  const stored = (await db.meta.get("syncCursor"))?.value;
  return typeof stored === "number" ? stored : 0;
}

export async function setSyncCursor(value: number): Promise<void> {
  await db.meta.put({ key: "syncCursor", value });
}
