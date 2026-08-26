// The device's side of a sync conflict: which copy wins on which timestamp, a deletion that
// must not be resurrected, and the edge a push snapshot is taken at. The server's side of the
// same fight is worker/push.test.ts, and the SQL that carries it — including the cursor the
// pull selects on — worker/sync.integration.test.ts.
import { describe, expect, it } from "vitest";
import { clearableDirty, dedupeSessions, mergeAnnotation, mergeBook, mergeProgress } from "./merge";
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

// The shelf's card stamps `lastShownAt` without touching `updatedAt`, so the two halves of an
// annotation are written on different devices at different moments. Plain LWW would let one
// erase the other, and which one would depend on the order sync happened to run in.
describe("mergeAnnotation (lastShownAt merges on its own)", () => {
  it("keeps a note written here and a viewing recorded elsewhere", () => {
    const local = ann({ note: "what I thought", updatedAt: 300 });
    const remote = ann({ note: "", updatedAt: 100, lastShownAt: 900 });
    const merged = mergeAnnotation(local, remote);
    expect(merged.note).toBe("what I thought");
    expect(merged.lastShownAt).toBe(900);
  });

  it("keeps a viewing recorded here when the remote row wins", () => {
    const local = ann({ updatedAt: 100, lastShownAt: 900 });
    const remote = ann({ note: "theirs", updatedAt: 300 });
    const merged = mergeAnnotation(local, remote);
    expect(merged.note).toBe("theirs");
    expect(merged.lastShownAt).toBe(900);
  });

  it("takes the later of two viewings", () => {
    const local = ann({ updatedAt: 100, lastShownAt: 500 });
    const remote = ann({ updatedAt: 100, lastShownAt: 200 });
    expect(mergeAnnotation(local, remote).lastShownAt).toBe(500);
  });

  it("leaves a passage the card has never shown without the field", () => {
    expect(mergeAnnotation(ann({}), ann({})).lastShownAt).toBeUndefined();
  });

  it("takes the remote viewing when there is no local copy at all", () => {
    expect(mergeAnnotation(undefined, ann({ lastShownAt: 700 })).lastShownAt).toBe(700);
  });

  // Both sides of sync ask "did this produce anything new" by identity. A merge that built a
  // fresh object every time would answer yes forever, and every already-seen passage would be
  // rewritten on every round — the server stamping `updated_at = now` as it went, which sends
  // every other device off to fetch a row that has not changed.
  it("hands back the winner itself when the viewing is already on it", () => {
    const local = ann({ updatedAt: 300, lastShownAt: 900 });
    const remote = ann({ updatedAt: 100, lastShownAt: 400 });
    expect(mergeAnnotation(local, remote)).toBe(local);

    const older = ann({ updatedAt: 100, lastShownAt: 400 });
    const newer = ann({ updatedAt: 300, lastShownAt: 900 });
    expect(mergeAnnotation(older, newer)).toBe(newer);
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
