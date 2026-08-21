import { beforeEach, describe, expect, it } from "vitest";
import { currentlyReading, isFinished, statusLines } from "./book-status";
import { i18n } from "./i18n";
import type { Progress, ReadingSession } from "./types";

function progressAt(bookId: string, percentage: number, lastReadAt: number): Progress {
  return {
    bookId,
    cfi: "epubcfi(/6/2!/4)",
    pageRange: null,
    percentage,
    chapterLabel: "第七章",
    lastReadAt,
  };
}

/** An hour's reading that covered a tenth of the book. Two of these make a speed. */
function anHourFrom(n: number, from: number): ReadingSession {
  return {
    id: `s${n}`,
    bookId: "b1",
    startedAt: n * 3_600_000,
    endedAt: n * 3_600_000 + 3_600_000,
    startFraction: from,
    endFraction: from + 0.1,
  };
}

const BOOKS = [
  { id: "b1", title: "草枕" },
  { id: "b2", title: "Alice" },
];

describe("currentlyReading", () => {
  it("is the most recently read book that is not finished", () => {
    const progress = new Map([
      ["b1", progressAt("b1", 0.4, 2_000)],
      ["b2", progressAt("b2", 0.4, 1_000)],
    ]);
    expect(currentlyReading(BOOKS, progress)?.id).toBe("b1");
  });

  // 1% is still a book the reader is in the middle of, and the shelf's whole job is to hand it
  // back without making them look for it.
  it("leads with a book barely started", () => {
    const progress = new Map([["b2", progressAt("b2", 0.01, 1_000)]]);
    expect(currentlyReading(BOOKS, progress)?.id).toBe("b2");
  });

  it("has nothing to show on an empty shelf", () => {
    expect(currentlyReading([], new Map())).toBeNull();
  });

  // Blowing an unopened book up to half the screen is the shelf nagging.
  it("has nothing to show when no book has been opened", () => {
    expect(currentlyReading(BOOKS, new Map())).toBeNull();
  });

  it("has nothing to show when every book is finished", () => {
    const progress = new Map([
      ["b1", progressAt("b1", 1, 2_000)],
      ["b2", progressAt("b2", 0.995, 1_000)],
    ]);
    expect(currentlyReading(BOOKS, progress)).toBeNull();
  });
});

describe("isFinished", () => {
  it("does not ask for the last pixel of the last page", () => {
    expect(isFinished(progressAt("b1", 0.99, 0))).toBe(true);
    expect(isFinished(progressAt("b1", 0.98, 0))).toBe(false);
    expect(isFinished(undefined)).toBe(false);
  });
});

describe("statusLines", () => {
  const now = new Date(2026, 7, 12).getTime();

  // English is the source language, so these read the messages as they are written in the
  // code. The two Chinese cases at the end are here for a rule only Chinese has.
  beforeEach(() => i18n.activate("en"));

  it("says a book was never opened", () => {
    expect(statusLines(i18n, undefined, [], now)).toEqual(["Not opened yet", "Just added"]);
  });

  it("names the chapter and how much is left once there is a speed", () => {
    const sessions = [anHourFrom(1, 0), anHourFrom(2, 0.1)];
    expect(statusLines(i18n, progressAt("b1", 0.5, now), sessions, now)).toEqual([
      "Read to 第七章",
      "About 5 hours left",
    ]);
  });

  it("keeps the half hours and drops a trailing zero", () => {
    const sessions = [anHourFrom(1, 0), anHourFrom(2, 0.1)];
    expect(statusLines(i18n, progressAt("b1", 0.55, now), sessions, now)[1]).toBe(
      "About 4.5 hours left",
    );
  });

  // The one case English spells differently, and the reason this message is a plural rather
  // than "About {hours} hours left" with an s that is wrong once.
  it("counts one hour as one hour", () => {
    const sessions = [anHourFrom(1, 0), anHourFrom(2, 0.1)];
    expect(statusLines(i18n, progressAt("b1", 0.9, now), sessions, now)[1]).toBe(
      "About 1 hour left",
    );
  });

  it("says only that the reader has begun, on the first sitting", () => {
    expect(statusLines(i18n, progressAt("b1", 0.05, now), [anHourFrom(1, 0)], now)).toEqual([
      "Read to 第七章",
      "Only just started",
    ]);
  });

  // Several sittings that stayed under the thresholds: "only just started" would be a lie about
  // a reader halfway through, and a made-up estimate would be worse. Nothing to say, so nothing
  // said.
  it("keeps quiet rather than guessing after several short sittings", () => {
    const brief = [1, 2, 3].map((n) => ({ ...anHourFrom(n, 0.4), endFraction: 0.4 }));
    expect(statusLines(i18n, progressAt("b1", 0.4, now), brief, now)).toEqual(["Read to 第七章"]);
  });

  it("falls back to the percentage when the chapter is not known", () => {
    const noChapter = { ...progressAt("b1", 0.43, now), chapterLabel: null };
    expect(statusLines(i18n, noChapter, [], now)[0]).toBe("Read to 43%");
  });

  it("says when a book was finished", () => {
    const finished = progressAt("b1", 1, new Date(2026, 7, 3).getTime());
    expect(statusLines(i18n, finished, [], now)).toEqual(["Finished", "August 3"]);
  });

  it("carries the year once the year has turned", () => {
    const finished = progressAt("b1", 1, new Date(2024, 7, 3).getTime());
    expect(statusLines(i18n, finished, [], now)[1]).toBe("August 3, 2024");
  });

  // 讀到第七章 is one phrase and a space would break it; 讀到 I: Down the Rabbit-Hole is two
  // scripts and needs one. Both sentences are the same message — which of the two it becomes
  // depends on the book, so the space cannot be written into the translation.
  describe("in Chinese, where the space before a chapter name is not automatic", () => {
    beforeEach(() => i18n.activate("zh-TW"));

    it("runs a Han chapter name straight on", () => {
      expect(statusLines(i18n, progressAt("b1", 0.3, now), [], now)[0]).toBe("讀到第七章");
    });

    it("puts a space in front of a chapter the book named in Latin", () => {
      const latin = { ...progressAt("b1", 0.3, now), chapterLabel: "I: Down the Rabbit-Hole" };
      expect(statusLines(i18n, latin, [], now)[0]).toBe("讀到 I: Down the Rabbit-Hole");
    });

    it("dates a finished book the way the interface language does", () => {
      const finished = progressAt("b1", 1, new Date(2026, 7, 3).getTime());
      expect(statusLines(i18n, finished, [], now)).toEqual(["讀完了", "8月3日"]);
    });
  });
});
