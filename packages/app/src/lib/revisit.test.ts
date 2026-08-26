// Who reaches the revisit card, and how long ago the reader marked them. The card these rows
// draw is packages/app/tests/browser/library/marks.spec.ts; whether a mark is on the shelf at
// all is shelf.test.ts.
import { describe, expect, it } from "vitest";
import { BATCH_SIZE, POOL_SIZE, pickBatch, relativeAge, restoreBatch } from "./revisit";
import type { Annotation } from "./types";

function mark(id: string, createdAt: number, lastShownAt?: number | null): Annotation {
  return {
    id,
    bookId: "b",
    cfiRange: "epubcfi(/6/2!/4,/2/1:0,/2/1:8)",
    text: id,
    note: "",
    color: "indigo",
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...(lastShownAt === undefined ? {} : { lastShownAt }),
  };
}

/** A picker with no randomness in it, so a test can say which of the pool came out. */
const takeFirst = (n: number) => (pool: Annotation[]) => pool.slice(0, n);

describe("pickBatch", () => {
  it("puts marks that have never been shown first", () => {
    const marks = [mark("seen", 100, 5_000), mark("never", 50)];
    expect(pickBatch(marks, takeFirst(1)).map((m) => m.id)).toEqual(["never"]);
  });

  it("orders never-shown marks newest first, so today's beats an old import", () => {
    const marks = [mark("imported", 10), mark("today", 900), mark("lastWeek", 400)];
    expect(pickBatch(marks, takeFirst(3)).map((m) => m.id)).toEqual([
      "today",
      "lastWeek",
      "imported",
    ]);
  });

  it("orders shown marks by how long ago they were shown", () => {
    const marks = [mark("recent", 0, 900), mark("ancient", 0, 10), mark("middling", 0, 500)];
    expect(pickBatch(marks, takeFirst(3)).map((m) => m.id)).toEqual([
      "ancient",
      "middling",
      "recent",
    ]);
  });

  it("only ever offers the pool the first POOL_SIZE of that order", () => {
    // Every mark has been shown, at ascending times, so the order is the id order.
    const marks = Array.from({ length: 40 }, (_, i) => mark(`m${i}`, 0, i));
    let offered: Annotation[] = [];
    pickBatch(marks, (pool) => {
      offered = pool;
      return pool.slice(0, BATCH_SIZE);
    });
    expect(offered).toHaveLength(POOL_SIZE);
    expect(offered.at(-1)!.id).toBe(`m${POOL_SIZE - 1}`);
  });

  it("gives fewer than a full batch rather than repeating a mark", () => {
    const marks = [mark("a", 1), mark("b", 2)];
    const batch = pickBatch(marks);
    expect(batch).toHaveLength(2);
    expect(new Set(batch.map((m) => m.id)).size).toBe(2);
  });

  it("gives nothing at all when there is nothing marked", () => {
    expect(pickBatch([])).toEqual([]);
  });

  it("draws BATCH_SIZE distinct marks when there are enough", () => {
    const marks = Array.from({ length: 30 }, (_, i) => mark(`m${i}`, i));
    const batch = pickBatch(marks);
    expect(batch).toHaveLength(BATCH_SIZE);
    expect(new Set(batch.map((m) => m.id)).size).toBe(BATCH_SIZE);
  });
});

describe("restoreBatch", () => {
  const marks = [mark("a", 1), mark("b", 2), mark("c", 3)];

  it("keeps today's batch in the order it was drawn", () => {
    expect(restoreBatch({ day: "2026-08-26", ids: ["c", "a"] }, marks, "2026-08-26")).toEqual([
      marks[2],
      marks[0],
    ]);
  });

  it("draws a new batch once the date has changed", () => {
    expect(restoreBatch({ day: "2026-08-25", ids: ["c", "a"] }, marks, "2026-08-26")).toBeNull();
  });

  it("draws a new batch when there is nothing stored", () => {
    expect(restoreBatch(null, marks, "2026-08-26")).toBeNull();
  });

  // A mark can leave between one day and the next: the reader deleted it, or deleted its book.
  it("drops an id that is no longer on the shelf rather than dropping the batch", () => {
    expect(
      restoreBatch({ day: "2026-08-26", ids: ["a", "gone", "b"] }, marks, "2026-08-26"),
    ).toEqual([marks[0], marks[1]]);
  });

  it("draws a new batch when every id in it has gone", () => {
    expect(restoreBatch({ day: "2026-08-26", ids: ["gone"] }, marks, "2026-08-26")).toBeNull();
  });
});

describe("relativeAge", () => {
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);
  const days = (n: number) => now - n * 86_400_000;

  it("reads the ladder from the near end", () => {
    expect(relativeAge(now, now - 60_000)).toBe("justNow");
    expect(relativeAge(now, now - 2 * 3_600_000)).toBe("today");
    expect(relativeAge(now, days(1))).toBe("yesterday");
    expect(relativeAge(now, days(4))).toBe("thisWeek");
    expect(relativeAge(now, days(10))).toBe("lastWeek");
    expect(relativeAge(now, days(25))).toBe("thisMonth");
    expect(relativeAge(now, days(50))).toBe("lastMonth");
    expect(relativeAge(now, days(200))).toBe("thisYear");
    expect(relativeAge(now, days(500))).toBe("lastYear");
    expect(relativeAge(now, days(1200))).toBe("longAgo");
  });

  // Clocks disagree between devices, and a mark carries the time the device that made it saw.
  it("reads a mark from the future as having just happened", () => {
    expect(relativeAge(now, now + 60_000)).toBe("justNow");
  });
});
