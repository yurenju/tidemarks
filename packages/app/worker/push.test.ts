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

const EMPTY: PushExisting = {
  books: [],
  progress: [],
  annotations: [],
  sessions: [],
  frozen: new Set(),
  limit: null,
};

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

// The quota is checked once, when a book the server has never seen arrives (ADR-0016). A
// refused book takes its position, annotations and sittings with it: a book is either whole on
// the server or not there at all.
describe("resolvePush — quota", () => {
  it("fills the free slots in payload order and drops the rest, with everything that belongs to them", () => {
    const existing = { ...EMPTY, books: [book({ id: "old" })], limit: 3 };
    const incoming = ["n1", "n2", "n3", "n4", "n5"].map((id) => book({ id }));
    const { plan } = resolvePush(existing, {
      books: incoming,
      progress: [prog({ bookId: "n1" }), prog({ bookId: "n3" })],
      annotations: [ann({ id: "a-n2", bookId: "n2" }), ann({ id: "a-n4", bookId: "n4" })],
      readingSessions: [sess({ id: "s-n2", bookId: "n2" }), sess({ id: "s-n5", bookId: "n5" })],
    });
    expect(plan.books.map((b) => b.id)).toEqual(["n1", "n2"]);
    expect(plan.progress.map((p) => p.bookId)).toEqual(["n1"]);
    expect(plan.annotations.map((a) => a.id)).toEqual(["a-n2"]);
    expect(plan.sessions.map((s) => s.id)).toEqual(["s-n2"]);
  });

  it("does not count deleted or frozen books against the limit", () => {
    const existing = {
      ...EMPTY,
      books: [book({ id: "gone", deletedAt: 5 }), book({ id: "ice" }), book({ id: "live" })],
      frozen: new Set(["ice"]),
      limit: 3,
    };
    const { plan } = resolvePush(existing, { books: [book({ id: "n1" }), book({ id: "n2" })] });
    expect(plan.books.map((b) => b.id)).toEqual(["n1", "n2"]);
  });

  it("drops every change to a frozen book, even though the server has it", () => {
    const existing = { ...EMPTY, books: [book({ id: "ice" })], frozen: new Set(["ice"]) };
    const { plan, conflicts } = resolvePush(existing, {
      books: [book({ id: "ice", title: "renamed", updatedAt: 9 })],
      progress: [prog({ bookId: "ice" })],
      annotations: [ann({ id: "a-ice", bookId: "ice" })],
      readingSessions: [sess({ id: "s-ice", bookId: "ice" })],
    });
    expect(plan).toEqual({ books: [], progress: [], annotations: [], sessions: [] });
    expect(conflicts.books).toEqual([]);
  });

  it("takes any number of new books when there is no limit", () => {
    const incoming = ["n1", "n2", "n3", "n4"].map((id) => book({ id }));
    const { plan } = resolvePush({ ...EMPTY, limit: null }, { books: incoming });
    expect(plan.books).toEqual(incoming);
  });
});
