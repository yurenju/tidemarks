import { describe, expect, it } from "vitest";
import { recallPosition, rememberPosition, type PositionStores } from "./position-store";
import type { Progress } from "./types";

function position(patch: Partial<Progress> = {}): Progress {
  return {
    bookId: "kusamakura",
    cfi: "epubcfi(/6/6!/4/2/16/22[fgyq_0037]/1:3)",
    pageRange: null,
    percentage: 0.0122,
    chapterLabel: "一",
    lastReadAt: 1000,
    dirtyAt: 1000,
    ...patch,
  };
}

/** A `localStorage` that lives in memory, so the assertions are about this module. */
function durableStore() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

/** IndexedDB as it behaves under load: the write is accepted, and commits whenever it commits. */
function settledStore(initial: Progress | undefined, commit: "now" | "never" = "now") {
  let held = initial;
  return {
    store: {
      get: async (bookId: string) => (held?.bookId === bookId ? held : undefined),
      put: async (next: Progress) => {
        if (commit === "never") return await new Promise<void>(() => {});
        held = next;
      },
    },
    committed: () => held,
  };
}

describe("rememberPosition", () => {
  // The bug behind #173. `db.progress.put()` is unawaited, and under load its commit was
  // measured at up to 1207ms — so a reload that lands inside that window used to come back
  // holding the page the reader left two turns ago. What the reader was last shown has to be
  // readable the instant the page turns, not one IndexedDB transaction later.
  it("is recalled even when the IndexedDB write has not committed", async () => {
    const durable = durableStore();
    const settled = settledStore(undefined, "never");
    const stores: PositionStores = { durable, settled: settled.store };

    rememberPosition(position(), stores);

    expect(settled.committed()).toBeUndefined();
    expect(await recallPosition("kusamakura", stores)).toEqual(position());
  });

  it("takes the settled record when that is the later of the two", async () => {
    const durable = durableStore();
    const settled = settledStore(undefined);
    const stores: PositionStores = { durable, settled: settled.store };

    rememberPosition(position({ lastReadAt: 1000 }), stores);
    // Another device's position, arrived through sync after this one was written here. Sync
    // writes IndexedDB directly, so the note left above is now the older of the two.
    await settled.store.put(position({ cfi: "epubcfi(/6/8!/4/2)", lastReadAt: 5000 }));

    expect((await recallPosition("kusamakura", stores))?.cfi).toBe("epubcfi(/6/8!/4/2)");
  });

  it("keeps only the newest position per book, and keeps books apart", async () => {
    const durable = durableStore();
    const settled = settledStore(undefined, "never");
    const stores: PositionStores = { durable, settled: settled.store };

    rememberPosition(position({ lastReadAt: 1000 }), stores);
    rememberPosition(position({ cfi: "epubcfi(/6/6!/4/2/18)", lastReadAt: 2000 }), stores);
    rememberPosition(position({ bookId: "alice", cfi: "epubcfi(/6/2)" }), stores);

    expect((await recallPosition("kusamakura", stores))?.cfi).toBe("epubcfi(/6/6!/4/2/18)");
    expect((await recallPosition("alice", stores))?.cfi).toBe("epubcfi(/6/2)");
  });

  it("returns nothing for a book that has never been opened", async () => {
    const stores: PositionStores = {
      durable: durableStore(),
      settled: settledStore(undefined).store,
    };

    expect(await recallPosition("never-opened", stores)).toBeUndefined();
  });

  // A page turn must not be the thing that throws. Safari in private browsing refuses
  // `setItem` outright, and a full quota does the same everywhere.
  it("still records the position when the durable store refuses the write", async () => {
    const settled = settledStore(undefined);
    const stores: PositionStores = {
      durable: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError");
        },
        removeItem: () => {},
      },
      settled: settled.store,
    };

    expect(() => rememberPosition(position(), stores)).not.toThrow();
    await Promise.resolve();
    expect(settled.committed()).toEqual(position());
  });

  // Anything can be in there: another tab's older format, a half-written value, a reader
  // clearing site data. None of it is worth losing the book over.
  it("ignores a durable entry that is not a position", async () => {
    const durable = durableStore();
    durable.setItem("tidemarks.position.kusamakura", "{not json");
    const settled = settledStore(position({ lastReadAt: 40 }));

    expect(
      (await recallPosition("kusamakura", { durable, settled: settled.store }))?.lastReadAt,
    ).toBe(40);
  });
});
