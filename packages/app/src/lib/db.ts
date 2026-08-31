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
 * **A Blob, where a book is bytes** (ADR-0048). A face is 19 MB and is only ever handed to
 * `URL.createObjectURL`, so a Blob read back out stays a reference to something the browser
 * keeps on disk; an ArrayBuffer read back out is 19 MB of memory.
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

/** Set by v5 below, cleared once every book on this device holds bytes. */
const BOOKS_IN_BLOBS = "booksInBlobs";

// v5: `BookRecord.file` and `.cover` stopped being Blobs (ADR-0048). No schema change — Dexie
// stores whatever the record holds — so all this does is leave a note for the conversion below.
//
// **The note, rather than the conversion.** Turning a Blob into an ArrayBuffer means awaiting
// `blob.arrayBuffer()`, and an IndexedDB transaction closes on the first await of a promise that
// is not its own, so it cannot happen inside an upgrade. It does not have to: what an upgrade is
// needed for is knowing that this device has rows in the old shape, and one meta row records
// that for the pass that runs next.
db.version(5).upgrade((tx) => tx.table("meta").put({ key: BOOKS_IN_BLOBS, value: 1 }));

/**
 * Rewrites any book still holding Blobs, before the first query sees one.
 *
 * **Converted rather than dropped, and the difference is a book the reader cannot get back.**
 * Nulling `file` looks harmless — a null one is exactly what lazy download is written for — but
 * only for a book whose bytes are on the server. A reader who never registered has no server,
 * so the row would stay on the shelf and answer every open with "Download failed", for good;
 * registering afterwards would not repair it, because `sync.ts` skips a book with no body when
 * it pushes and the server row would be minted without one. The cover is worse: the re-fetch is
 * gated on `hasCover`, which only a pull ever sets, so a never-synced book would lose its cover
 * with no path back at all.
 *
 * Dexie waits on this handler before letting any other query through, so nothing reads a row
 * mid-conversion. It runs once: v5 leaves the flag, this clears it, and every later start pays
 * one `meta` lookup.
 *
 * ⚠️ **Every query here goes through `vip`, the instance Dexie hands the handler, and not
 * through `db`.** A query on `db` while "ready" is still running is queued *behind* it, so this
 * would sit waiting for itself — the app opens to a reader that never renders a page, with
 * nothing logged. `reader/stored-shape.spec.ts` is what caught that, and is why it exists.
 */
db.on("ready", async (vip) => {
  const open = vip as typeof db;
  if ((await open.meta.get(BOOKS_IN_BLOBS)) === undefined) return;

  // Read, convert, write — the awaits are why this cannot be an upgrade, and out here they cost
  // nothing but time. A shelf is tens of books, and this happens once on one build.
  for (const book of await open.books.toArray()) {
    const file: unknown = book.file;
    const cover: unknown = book.cover;
    if (!(file instanceof Blob) && !(cover instanceof Blob)) continue;
    await open.books.update(book.id, {
      ...(file instanceof Blob ? { file: await file.arrayBuffer() } : {}),
      ...(cover instanceof Blob
        ? { cover: { bytes: await cover.arrayBuffer(), type: cover.type } }
        : {}),
    });
  }

  await open.meta.delete(BOOKS_IN_BLOBS);
});

export async function getSyncCursor(): Promise<number> {
  const stored = (await db.meta.get("syncCursor"))?.value;
  return typeof stored === "number" ? stored : 0;
}

export async function setSyncCursor(value: number): Promise<void> {
  await db.meta.put({ key: "syncCursor", value });
}
