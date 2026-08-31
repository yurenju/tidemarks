// What leaves the device on a push: blobs left behind, this device's own bookkeeping stripped,
// and the fields that have to be on the wire. What the server does with them is
// worker/push.test.ts; that they survive D1 is worker/sync.integration.test.ts.
import { describe, expect, it } from "vitest";
import { isEmptyPayload, syncPayload, type DirtyRows } from "./sync-payload";
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
