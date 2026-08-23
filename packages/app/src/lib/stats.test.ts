// Reading speed and what may be divided to get one: which sittings count, the two floors that
// keep a nonsense number off the screen, and how much of the book is left. The sentences these
// numbers turn into are book-status.test.ts.
import { describe, it, expect } from "vitest";
import {
  formatDuration,
  readingSpeed,
  remainingHours,
  SPEED_MIN_FRACTION,
  SPEED_MIN_MS,
  totalReadingMs,
} from "./stats";
import type { ReadingSession } from "./types";

const MINUTE = 60_000;

/**
 * A sitting, spelled as "when, how long, how far" — which is what the speed reads.
 *
 * Sessions are numbered forwards in time from `endedAt`, an hour apart, so a test can say
 * "the sixth one" and mean "the one that falls out of the window".
 */
function sitting(n: number, ms: number, moved: number, from = 0): ReadingSession {
  const endedAt = n * 3_600_000;
  return {
    id: `s${n}`,
    bookId: "b1",
    startedAt: endedAt - ms,
    endedAt,
    startFraction: from,
    endFraction: from + moved,
  };
}

describe("totalReadingMs", () => {
  it("sums session durations", () => {
    const sessions: ReadingSession[] = [
      {
        id: "s1",
        bookId: "b1",
        startedAt: 0,
        endedAt: 60_000,
        startFraction: null,
        endFraction: null,
      },
      {
        id: "s2",
        bookId: "b1",
        startedAt: 100_000,
        endedAt: 160_000,
        startFraction: null,
        endFraction: null,
      },
    ];
    expect(totalReadingMs(sessions)).toBe(120_000);
  });

  it("ignores sessions that never ended (endedAt 0)", () => {
    expect(
      totalReadingMs([
        {
          id: "s1",
          bookId: "b1",
          startedAt: 500,
          endedAt: 0,
          startFraction: null,
          endFraction: null,
        },
      ]),
    ).toBe(0);
  });

  it("returns 0 for no sessions", () => {
    expect(totalReadingMs([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });
});

describe("readingSpeed", () => {
  // One sitting is a sample of one: it can be the reader skimming an index or stuck on a poem,
  // and either would be published as "how fast you read this book".
  it("says nothing after a single sitting", () => {
    expect(readingSpeed([sitting(1, 30 * MINUTE, 0.2)])).toBeNull();
  });

  it("speaks on the second sitting", () => {
    const speed = readingSpeed([sitting(1, 30 * MINUTE, 0.1), sitting(2, 30 * MINUTE, 0.1, 0.1)]);
    expect(speed).toBeCloseTo(0.2 / (60 * MINUTE), 12);
  });

  // The reader who opened the book twice and read a paragraph each time: the clock ran, so a
  // speed divides out, and it would say four hundred hours.
  it("says nothing until the reader has moved 0.02 of the book", () => {
    const short = SPEED_MIN_FRACTION / 2 - 0.001;
    expect(
      readingSpeed([sitting(1, 30 * MINUTE, short), sitting(2, 30 * MINUTE, short)]),
    ).toBeNull();

    const enough = SPEED_MIN_FRACTION / 2;
    expect(
      readingSpeed([sitting(1, 30 * MINUTE, enough), sitting(2, 30 * MINUTE, enough)]),
    ).not.toBeNull();
  });

  // And its mirror: two sittings of a minute each that happened to cross a chapter break would
  // divide a real displacement by a duration too small to mean anything.
  it("says nothing until the clock has run five minutes", () => {
    const short = SPEED_MIN_MS / 2 - 1;
    expect(readingSpeed([sitting(1, short, 0.05), sitting(2, short, 0.05)])).toBeNull();

    const enough = SPEED_MIN_MS / 2;
    expect(readingSpeed([sitting(1, enough, 0.05), sitting(2, enough, 0.05)])).not.toBeNull();
  });

  it("reads the last five sittings and lets the sixth fall out", () => {
    // One slow evening long ago, then five at a steady 0.1 an hour. The old one is out of the
    // window, so it moves the answer not at all.
    const window = [2, 3, 4, 5, 6].map((n) => sitting(n, 60 * MINUTE, 0.1));
    const speed = readingSpeed([sitting(1, 60 * MINUTE, 0.001), ...window]);
    expect(speed).toBeCloseTo(0.1 / (60 * MINUTE), 12);
  });

  it("leaves out a sitting the device could not place in the book", () => {
    const unplaced: ReadingSession = {
      ...sitting(3, 60 * MINUTE, 0),
      startFraction: null,
      endFraction: null,
    };
    // Two placed sittings and one that is only a duration: counting the third would halve the
    // speed by adding an hour that moved nowhere.
    const speed = readingSpeed([
      sitting(1, 30 * MINUTE, 0.1),
      sitting(2, 30 * MINUTE, 0.1),
      unplaced,
    ]);
    expect(speed).toBeCloseTo(0.2 / (60 * MINUTE), 12);
  });

  it("counts a sitting spent going backwards as no ground gained", () => {
    // Re-reading the previous chapter is reading, so the time counts; it just did not advance
    // the book, and a negative displacement would make the total say the reader sped up.
    const back = { ...sitting(3, 30 * MINUTE, 0), startFraction: 0.3, endFraction: 0.2 };
    const speed = readingSpeed([sitting(1, 30 * MINUTE, 0.1), sitting(2, 30 * MINUTE, 0.1), back]);
    expect(speed).toBeCloseTo(0.2 / (90 * MINUTE), 12);
  });
});

describe("remainingHours", () => {
  // Two hours for a fifth of the book: ten hours for the whole of it.
  const steady = [sitting(1, 60 * MINUTE, 0.1), sitting(2, 60 * MINUTE, 0.1, 0.1)];

  it("is the ground left over the measured speed", () => {
    expect(remainingHours(steady, 0.5)).toBe(5);
  });

  it("rounds up to the next half hour", () => {
    // 4.8 hours left, which is not a number anyone should be shown to one decimal place.
    expect(remainingHours(steady, 0.52)).toBe(5);
    expect(remainingHours(steady, 0.55)).toBe(4.5);
  });

  it("says nothing when there is no speed to divide by", () => {
    expect(remainingHours([sitting(1, 60 * MINUTE, 0.1)], 0.5)).toBeNull();
  });

  it("says nothing about a book with nothing left", () => {
    expect(remainingHours(steady, 1)).toBeNull();
  });
});
