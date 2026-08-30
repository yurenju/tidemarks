// Which marked passage reaches the shelf's card, and how long ago the reader marked it. The card
// these rows draw is packages/app/tests/browser/library/marks.spec.ts; whether a mark is on the
// shelf at all is shelf.test.ts.
import { describe, expect, it } from "vitest";
import { pickOne, relativeAge, restoreShown } from "./revisit";
import type { Annotation } from "./types";

function mark(id: string, createdAt: number): Annotation {
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
  };
}

describe("pickOne", () => {
  it("gives nothing at all when there is nothing marked", () => {
    expect(pickOne([])).toBeNull();
  });

  it("gives the only mark there is", () => {
    const marks = [mark("a", 1)];
    expect(pickOne(marks)).toBe(marks[0]);
  });

  // The one thing the caller is owed when it asks for another: not the one already showing. Every
  // other property of the draw is chance, which is what "wholly random" means here.
  it("never hands back the passage it was asked to move on from", () => {
    const marks = [mark("a", 1), mark("b", 2), mark("c", 3)];
    for (let i = 0; i < 50; i++) {
      expect(pickOne(marks, "b")!.id).not.toBe("b");
    }
  });

  // Better the same passage again than an empty card: a reader with one mark pressing [[Another passage]]
  // has asked for something, and there is nothing else to give them.
  it("hands back the same passage when it is the only one", () => {
    const marks = [mark("a", 1)];
    expect(pickOne(marks, "a")).toBe(marks[0]);
  });

  it("reaches every mark eventually rather than favouring one", () => {
    const marks = Array.from({ length: 4 }, (_, i) => mark(`m${i}`, i));
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickOne(marks)!.id);
    expect(seen.size).toBe(4);
  });
});

describe("restoreShown", () => {
  const marks = [mark("a", 1), mark("b", 2), mark("c", 3)];

  it("keeps the passage already drawn today", () => {
    expect(restoreShown({ day: "2026-08-29", id: "c" }, marks, "2026-08-29")).toBe(marks[2]);
  });

  it("draws again once the date has changed", () => {
    expect(restoreShown({ day: "2026-08-28", id: "c" }, marks, "2026-08-29")).toBeNull();
  });

  it("draws when there is nothing stored", () => {
    expect(restoreShown(null, marks, "2026-08-29")).toBeNull();
  });

  // A mark can leave between one visit and the next: the reader deleted it, or deleted its book.
  it("draws again when the passage it named has gone", () => {
    expect(restoreShown({ day: "2026-08-29", id: "gone" }, marks, "2026-08-29")).toBeNull();
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
