// The device's side of a sync conflict: which copy wins on which timestamp, a deletion that
// must not be resurrected, and the two cursor edges. The server's side of the same fight is
// worker/push.test.ts, and the SQL that carries it worker/sync.integration.test.ts.
import { describe, expect, it } from "vitest";
import {
  clearableDirty,
  dedupeSessions,
  mergeAnnotation,
  mergeBook,
  mergeProgress,
  rowsSince,
} from "./merge";
import type { Annotation, Progress, ReadingSession, SyncBook } from "./types";

function prog(over: Partial<Progress>): Progress {
  return {
    bookId: "b1",
    cfi: "epubcfi(/6/2)",
    pageRange: null,
    percentage: 0.1,
    chapterLabel: null,
    lastReadAt: 100,
    ...over,
  };
}

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    bookId: "b1",
    cfiRange: "epubcfi(/6/2,/1,/2)",
    text: "t",
    note: "",
    color: "yellow",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...over,
  };
}

function book(over: Partial<SyncBook>): SyncBook {
  return {
    id: "b1",
    title: "T",
    author: "A",
    addedAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...over,
  };
}

describe("mergeProgress (LWW by lastReadAt)", () => {
  it("remote wins when remote is newer", () => {
    const local = prog({ cfi: "local", lastReadAt: 100 });
    const remote = prog({ cfi: "remote", lastReadAt: 200 });
    expect(mergeProgress(local, remote).cfi).toBe("remote");
  });

  it("local wins when local is newer, even if remote is further", () => {
    const local = prog({ cfi: "local", percentage: 0.2, lastReadAt: 300 });
    const remote = prog({ cfi: "remote", percentage: 1, lastReadAt: 200 });
    expect(mergeProgress(local, remote).cfi).toBe("local");
  });

  it("remote fills in when there is no local row", () => {
    const remote = prog({ cfi: "remote" });
    expect(mergeProgress(undefined, remote).cfi).toBe("remote");
  });
});

describe("mergeAnnotation (LWW by updatedAt, tombstone)", () => {
  it("a local deletion is not resurrected by an older remote copy", () => {
    const local = ann({ updatedAt: 200, deletedAt: 200 });
    const remote = ann({ updatedAt: 100, deletedAt: null, note: "old" });
    expect(mergeAnnotation(local, remote).deletedAt).toBe(200);
  });

  it("a newer remote deletion removes the local copy", () => {
    const local = ann({ updatedAt: 100, deletedAt: null });
    const remote = ann({ updatedAt: 200, deletedAt: 200 });
    expect(mergeAnnotation(local, remote).deletedAt).toBe(200);
  });

  it("newer remote edit wins over older local edit", () => {
    const local = ann({ note: "local", updatedAt: 100 });
    const remote = ann({ note: "remote", updatedAt: 200 });
    expect(mergeAnnotation(local, remote).note).toBe("remote");
  });

  it("older remote edit does not overwrite newer local edit", () => {
    const local = ann({ note: "local", updatedAt: 300 });
    const remote = ann({ note: "remote", updatedAt: 200 });
    expect(mergeAnnotation(local, remote).note).toBe("local");
  });
});

describe("mergeBook (LWW by updatedAt, tombstone)", () => {
  it("a locally deleted book is not resurrected by an older remote copy", () => {
    const local = book({ updatedAt: 200, deletedAt: 200 });
    const remote = book({ updatedAt: 100, deletedAt: null });
    expect(mergeBook(local, remote).deletedAt).toBe(200);
  });

  it("a newer remote deletion wins", () => {
    const local = book({ updatedAt: 100, deletedAt: null });
    const remote = book({ updatedAt: 200, deletedAt: 200 });
    expect(mergeBook(local, remote).deletedAt).toBe(200);
  });
});

describe("dedupeSessions (append-only, insert-or-ignore by id)", () => {
  it("drops sessions whose id already exists locally", () => {
    const existing = new Set(["s1", "s2"]);
    const incoming: ReadingSession[] = [
      { id: "s2", bookId: "b1", startedAt: 1, endedAt: 2, startFraction: null, endFraction: null },
      { id: "s3", bookId: "b1", startedAt: 3, endedAt: 4, startFraction: 0.1, endFraction: 0.2 },
    ];
    expect(dedupeSessions(existing, incoming).map((s) => s.id)).toEqual(["s3"]);
  });
});

describe("clearableDirty (clear after push)", () => {
  it("clears rows dirtied before the push snapshot, keeps rows dirtied after", () => {
    const rows = [
      { id: "a", dirtyAt: 100 },
      { id: "b", dirtyAt: 500 },
      { id: "c", dirtyAt: undefined },
    ];
    expect(clearableDirty(rows, 200).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("rowsSince (pull cursor boundary)", () => {
  it("is strictly greater-than: a row at exactly the cursor is not re-sent", () => {
    const rows = [
      { id: "a", t: 100 },
      { id: "b", t: 200 },
      { id: "c", t: 201 },
    ];
    expect(rowsSince(rows, (r) => r.t, 200).map((r) => r.id)).toEqual(["c"]);
  });
});
