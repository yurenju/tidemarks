// The arithmetic behind "a mark goes beside the ink, not beside the box": where the ink sits
// inside a text rectangle, which runs of a text node are blank, and the line height a mark needs
// to clear. The glyph metrics it is fed can only be measured by an engine, and the rectangles
// that come out are checked against one in tests/browser/renderer/marked-rects.spec.ts.
import { describe, expect, test } from "vitest";
import { blankRuns, inkAcross, inkWithin, minimumLineHeight } from "../../../src/renderer/ink.ts";

/**
 * The numbers in the line-height cases are the ones measured on Alice in chromium and written
 * down in Tidemarks' ADR-0032, so a change to this file's behaviour shows up as a change to a
 * documented figure rather than as an unexplained diff.
 */

/** 15.33px Times New Roman at `line-height: normal`, measured in the running reader. */
const TIMES: Parameters<typeof minimumLineHeight>[0] = {
  boxAscent: 14,
  boxDescent: 3,
  inkAscent: 11,
  inkDescent: 3,
};

const TIMES_AT = 15.3333;

/**
 * The same face at another size.
 *
 * Metrics are proportional to the size, and forgetting that is an easy way to get a wrong
 * answer that looks plausible: holding the 15.33px ink height fixed while shrinking the type
 * says 12.8px needs a line-height of 1.56, when it needs 1.38.
 */
function timesAt(fontSize: number): Parameters<typeof minimumLineHeight>[0] {
  const scale = fontSize / TIMES_AT;
  return {
    boxAscent: TIMES.boxAscent * scale,
    boxDescent: TIMES.boxDescent * scale,
    inkAscent: TIMES.inkAscent * scale,
    inkDescent: TIMES.inkDescent * scale,
  };
}

describe("cutting a text node into blank and non-blank runs", () => {
  test("a paragraph opening with an ideographic indent yields the indent and then the prose", () => {
    expect(blankRuns("　　王文華說過")).toEqual([
      { start: 0, end: 2, blank: true },
      { start: 2, end: 7, blank: false },
    ]);
  });

  test("prose with nothing blank in it stays one run", () => {
    expect(blankRuns("happy typography")).toEqual([{ start: 0, end: 16, blank: false }]);
  });

  test("an ordinary space is not blank, because it collapses and paints nothing", () => {
    expect(blankRuns("a b")).toEqual([{ start: 0, end: 3, blank: false }]);
  });

  test("a no-break space counts, because it does paint a cell", () => {
    expect(blankRuns("a b")).toEqual([
      { start: 0, end: 1, blank: false },
      { start: 1, end: 2, blank: true },
      { start: 2, end: 3, blank: false },
    ]);
  });

  test("blank at both ends is two runs around the prose", () => {
    expect(blankRuns("　x　")).toEqual([
      { start: 0, end: 1, blank: true },
      { start: 1, end: 2, blank: false },
      { start: 2, end: 3, blank: true },
    ]);
  });

  test("empty text has nothing to measure", () => {
    expect(blankRuns("")).toEqual([]);
  });

  test("a spacer paragraph is one blank run, which is how a whole line goes unmarked", () => {
    expect(blankRuns("　")).toEqual([{ start: 0, end: 1, blank: true }]);
  });
});

describe("finding the ink inside a text node's rectangle", () => {
  test("the top comes in by the internal leading and the bottom stays at the descent", () => {
    // Alice: the rectangle is 17 tall (14 + 3) and the ink is 14 (11 + 3), so the ink starts
    // 3px down and reaches the rectangle's own bottom.
    expect(inkWithin({ top: 100, bottom: 117 }, TIMES)).toEqual({ top: 103, bottom: 117 });
  });

  test("a font reporting nothing leaves the rectangle alone", () => {
    const nothing = { boxAscent: 0, boxDescent: 0, inkAscent: 0, inkDescent: 0 };
    expect(inkWithin({ top: 100, bottom: 117 }, nothing)).toEqual({ top: 100, bottom: 117 });
  });

  test("glyphs overshooting their own descent are clamped to the rectangle", () => {
    const overshooting = { ...TIMES, inkDescent: 9 };
    expect(inkWithin({ top: 100, bottom: 117 }, overshooting).bottom).toBe(117);
  });
});

describe("finding the ink across a vertical line", () => {
  // Noto Serif CJK TC at 18.67px, measured in chromium: the rectangle is 26 across, the em box
  // inside it is 18.67, and the glyphs' own ink is 17 — so the mark stood 5px off the column.
  const NOTO_AT = 18.67;

  test("one em, centred, is what an ordinary CJK face leaves inside its rectangle", () => {
    // Written out rather than derived, so that transcribing the implementation back into the
    // expectation cannot make this pass: 26 across, 18.67 of em, 3.665 of slack each side.
    const { start, end } = inkAcross({ start: 100, end: 126 }, NOTO_AT);
    expect(start).toBeCloseTo(103.665, 3);
    expect(end).toBeCloseTo(122.335, 3);
  });

  test("a rectangle already narrower than an em is left alone", () => {
    // 草枕's first available font covers four dashes and reports a 15px box, which the 18.4px
    // characters spill out of. Insetting there would move the mark onto the glyphs.
    expect(inkAcross({ start: 100, end: 115 }, 18.4)).toEqual({ start: 100, end: 115 });
  });

  test("no usable font size leaves the rectangle alone rather than returning NaN", () => {
    // Zero is a replaced element, which has no type in it; NaN is a `font-size` that would not
    // parse, and it fails every comparison on the way past rather than being caught by one.
    for (const emSize of [0, Number.NaN]) {
      expect(inkAcross({ start: 100, end: 126 }, emSize)).toEqual({ start: 100, end: 126 });
    }
  });
});

describe("the line-height a mark needs", () => {
  // 4px of wave, 0.7 clear of this line's ink and 1.3 clear of the next line's.
  const GAP = 6;

  test("Alice's body text needs 1.30, which is what ADR-0032 records", () => {
    expect(minimumLineHeight(TIMES, TIMES_AT, GAP)).toBeCloseTo(1.3, 2);
  });

  test("the same face needs a looser line at a smaller size, because the gap is absolute", () => {
    expect(minimumLineHeight(timesAt(12.8), 12.8, GAP)).toBeGreaterThan(
      minimumLineHeight(timesAt(32), 32, GAP),
    );
  });

  test("the whole table in ADR-0032 comes out of this function", () => {
    const table: readonly [number, number][] = [
      [12.8, 1.38],
      [16, 1.29],
      [18.4, 1.24],
      [32, 1.1],
    ];
    for (const [size, expected] of table) {
      expect(minimumLineHeight(timesAt(size), size, GAP)).toBeCloseTo(expected, 2);
    }
  });

  test("every rung the reader can pick already clears it", () => {
    // `LINE_HEIGHTS` in the app starts at 1.4 above "the book's", so the floor never binds on
    // a line height the reader chose — only on the book's own.
    for (const size of [12.8, 16, 18.4, 32]) {
      expect(minimumLineHeight(timesAt(size), size, GAP)).toBeLessThan(1.4);
    }
  });

  test("a font size of zero cannot be divided by, and answers no requirement", () => {
    expect(minimumLineHeight(TIMES, 0, GAP)).toBe(0);
  });
});
