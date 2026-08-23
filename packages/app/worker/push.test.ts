// The server's side of a sync push, decided in memory: which incoming row wins, which comes
// back as a conflict carrying the server's copy, which session is a duplicate. The device's
// mirror is src/lib/merge.test.ts; the SQL that writes the plan is sync.integration.test.ts.
import { describe, expect, it } from "vitest";
import type { Annotation, Progress, ReadingSession, SyncBook } from "../src/lib/types";
import { type PushExisting, resolvePush } from "./push";

function book(over: Partial<SyncBook>): SyncBook {
  return { id: "b1", title: "T", author: "A", addedAt: 1, updatedAt: 1, deletedAt: null, ...over };
}

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

function sess(over: Partial<ReadingSession>): ReadingSession {
  return {
    id: "s1",
    bookId: "b1",
    startedAt: 1,
    endedAt: 2,
    startFraction: null,
    endFraction: null,
    ...over,
  };
}

const EMPTY: PushExisting = { books: [], progress: [], annotations: [], sessions: [] };

describe("resolvePush — books/annotations (LWW by updatedAt)", () => {
  it("a brand new row with no server counterpart goes to the plan, never a conflict", () => {
    const incoming = book({ id: "b1", updatedAt: 1 });
    const { plan, conflicts } = resolvePush(EMPTY, { books: [incoming] });
    expect(plan.books).toEqual([incoming]);
    expect(conflicts.books).toEqual([]);
  });

  it("incoming newer than server wins: goes to the plan", () => {
    const server = book({ id: "b1", title: "old", updatedAt: 100 });
    const incoming = book({ id: "b1", title: "new", updatedAt: 200 });
    const { plan, conflicts } = resolvePush({ ...EMPTY, books: [server] }, { books: [incoming] });
    expect(plan.books).toEqual([incoming]);
    expect(conflicts.books).toEqual([]);
  });

  it("incoming older than server loses: server row is returned as a conflict, nothing planned", () => {
    const server = book({ id: "b1", title: "server", updatedAt: 200 });
    const incoming = book({ id: "b1", title: "stale", updatedAt: 100 });
    const { plan, conflicts } = resolvePush({ ...EMPTY, books: [server] }, { books: [incoming] });
    expect(plan.books).toEqual([]);
    expect(conflicts.books).toEqual([server]);
  });

  it("annotation older than server becomes a conflict carrying the server copy", () => {
    const server = ann({ id: "a1", note: "server", updatedAt: 200 });
    const incoming = ann({ id: "a1", note: "stale", updatedAt: 100 });
    const { plan, conflicts } = resolvePush(
      { ...EMPTY, annotations: [server] },
      { annotations: [incoming] },
    );
    expect(plan.annotations).toEqual([]);
    expect(conflicts.annotations).toEqual([server]);
  });
});

describe("resolvePush — progress (LWW by lastReadAt)", () => {
  it("incoming with a newer lastReadAt is planned", () => {
    const server = prog({ bookId: "b1", cfi: "server", lastReadAt: 100 });
    const incoming = prog({ bookId: "b1", cfi: "client", lastReadAt: 200 });
    const { plan, conflicts } = resolvePush(
      { ...EMPTY, progress: [server] },
      { progress: [incoming] },
    );
    expect(plan.progress).toEqual([incoming]);
    expect(conflicts.progress).toEqual([]);
  });

  it("incoming with an older lastReadAt loses to the server copy", () => {
    const server = prog({ bookId: "b1", cfi: "server", lastReadAt: 200 });
    const incoming = prog({ bookId: "b1", cfi: "stale", lastReadAt: 100 });
    const { plan, conflicts } = resolvePush(
      { ...EMPTY, progress: [server] },
      { progress: [incoming] },
    );
    expect(plan.progress).toEqual([]);
    expect(conflicts.progress).toEqual([server]);
  });
});

describe("resolvePush — reading sessions (append-only, insert-or-ignore by id)", () => {
  it("drops incoming sessions whose id already exists on the server", () => {
    const incoming = [sess({ id: "s1" }), sess({ id: "s2" })];
    const { plan } = resolvePush(
      { ...EMPTY, sessions: [sess({ id: "s1" })] },
      { readingSessions: incoming },
    );
    expect(plan.sessions.map((s) => s.id)).toEqual(["s2"]);
  });
});
