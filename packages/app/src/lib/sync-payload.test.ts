// What leaves the device on a push: blobs left behind, this device's own bookkeeping stripped,
// and the fields that have to be on the wire. What the server does with them is
// worker/push.test.ts; that they survive D1 is worker/sync.integration.test.ts.
import { describe, expect, it } from "vitest";
import {
  isEmptyPayload,
  onlyOnThisDevice,
  syncPayload,
  withinQuota,
  type DirtyRows,
} from "./sync-payload";
import type { BookRecord, Progress } from "./types";

const EMPTY: DirtyRows = { books: [], progress: [], annotations: [], readingSessions: [] };

function book(over: Partial<BookRecord> = {}): BookRecord {
  return {
    id: "b1",
    title: "T",
    author: "A",
    addedAt: 1,
    updatedAt: 2,
    deletedAt: null,
    file: null,
    cover: null,
    ...over,
  };
}

function prog(over: Partial<Progress> = {}): Progress {
  return {
    bookId: "b1",
    cfi: "epubcfi(/6/2!/4/2/1:0)",
    pageRange: "epubcfi(/6/2!/4,/2/1:0,/8/1:40)",
    percentage: 0.3,
    chapterLabel: "第七章",
    lastReadAt: 500,
    ...over,
  };
}

describe("syncPayload", () => {
  it("leaves the bytes behind and says only whether a cover exists", () => {
    const cover = { bytes: new Uint8Array([1, 2, 3]).buffer, type: "image/png" };
    const wire = syncPayload({ ...EMPTY, books: [book({ cover })] }).books[0]!;
    expect(wire.hasCover).toBe(true);
    expect(wire).not.toHaveProperty("file");
    expect(wire).not.toHaveProperty("cover");
  });

  it("strips dirtyAt: it is this device’s bookkeeping, and the server keeps its own cursor", () => {
    const payload = syncPayload({ ...EMPTY, progress: [prog({ dirtyAt: 900 })] });
    expect(payload.progress[0]).not.toHaveProperty("dirtyAt");
  });

  it("carries the page range, which is the whole point of pushing before the app is switched", () => {
    // Lose this and an agent can still say where the reader is, but not what they can see.
    const payload = syncPayload({ ...EMPTY, progress: [prog()] });
    expect(payload.progress[0]!.pageRange).toBe("epubcfi(/6/2!/4,/2/1:0,/8/1:40)");
  });

  it("treats a book with no deletion as explicitly not deleted, not as missing", () => {
    const wire = syncPayload({ ...EMPTY, books: [book({ deletedAt: undefined })] }).books[0]!;
    expect(wire.deletedAt).toBeNull();
  });
});

describe("isEmptyPayload", () => {
  it("is true only when every table is empty", () => {
    expect(isEmptyPayload(syncPayload(EMPTY))).toBe(true);
    expect(isEmptyPayload(syncPayload({ ...EMPTY, progress: [prog()] }))).toBe(false);
  });
});

describe("withinQuota", () => {
  const dirty = (ids: string[]): DirtyRows => ({
    ...EMPTY,
    books: ids.map((id) => book({ id })),
    progress: ids.map((id) => prog({ bookId: id })),
  });

  it("sends everything while the server has not said anything yet", () => {
    expect(withinQuota(dirty(["a", "b"]), null)).toEqual(dirty(["a", "b"]));
  });

  it("sends books outside the list only until the free slots are filled, rows and all", () => {
    const kept = withinQuota(dirty(["s", "n1", "n2", "n3"]), {
      limit: 3,
      synced: ["s", "t"],
      at: 0,
    });
    expect(kept.books.map((b) => b.id)).toEqual(["s", "n1"]);
    expect(kept.progress.map((p) => p.bookId)).toEqual(["s", "n1"]);
  });

  it("sends every book when the limit is null", () => {
    const kept = withinQuota(dirty(["n1", "n2"]), { limit: null, synced: [], at: 0 });
    expect(kept.books.map((b) => b.id)).toEqual(["n1", "n2"]);
  });

  it("always sends a tombstone: a deleted book takes no slot", () => {
    const rows = { ...EMPTY, books: [book({ id: "gone", deletedAt: 5 })] };
    expect(withinQuota(rows, { limit: 3, synced: ["a", "b", "c"], at: 0 }).books).toHaveLength(1);
  });

  it("holds back the rows of a book the server does not list, even when the book itself is clean", () => {
    const rows = { ...EMPTY, progress: [prog({ bookId: "frozen" })] };
    expect(withinQuota(rows, { limit: 3, synced: ["a"], at: 0 }).progress).toEqual([]);
  });
});

describe("onlyOnThisDevice", () => {
  const quota = { limit: 3, synced: ["a"], at: 1000 };

  it("is false until the server has spoken, and for a book it lists", () => {
    expect(onlyOnThisDevice(null, book({ id: "b" }))).toBe(false);
    expect(onlyOnThisDevice(quota, book({ id: "a" }))).toBe(false);
  });

  it("is true for a book the server does not list, but not for one imported after it last spoke", () => {
    expect(onlyOnThisDevice(quota, book({ id: "b", addedAt: 999 }))).toBe(true);
    expect(onlyOnThisDevice(quota, book({ id: "b", addedAt: 1001 }))).toBe(false);
  });
});
