import { describe, expect, test } from "vitest";
import {
  blockExtentOf,
  inlineExtentOf,
  marginInsets,
  maxScrollOffsetFor,
  pageAt,
  pageAtScroll,
  pageAxisFor,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  turnPlacement,
  type PageMetrics,
} from "../../../src/renderer/geometry.ts";

/**
 * Unit tests for the pagination arithmetic. This layer is pure functions, so it sits at
 * the bottom of the test pyramid (ADR-0009) — a boundary condition can be answered
 * without opening three browsers.
 *
 * The premise that "columns overflow along the inline axis" is not verified here; that
 * is browser behaviour, and `tests/browser/renderer/multicol-geometry.spec.ts` pins it
 * once per engine. What is verified here is **the arithmetic that follows from
 * accepting that premise**.
 */

const VIEWPORT = { width: 800, height: 600 };

describe("the pagination axis", () => {
  test("horizontal pages advance along x, vertical ones along y", () => {
    expect(pageAxisFor("horizontal-tb")).toBe("x");
    expect(pageAxisFor("vertical-rl")).toBe("y");
  });

  test("extent along the inline axis: width when horizontal, height when vertical", () => {
    expect(inlineExtentOf("horizontal-tb", VIEWPORT)).toBe(800);
    expect(inlineExtentOf("vertical-rl", VIEWPORT)).toBe(600);
  });

  test("the block axis is the inline axis's complement", () => {
    expect(blockExtentOf("horizontal-tb", VIEWPORT)).toBe(600);
    expect(blockExtentOf("vertical-rl", VIEWPORT)).toBe(800);
  });
});

describe("margins landing on physical edges", () => {
  test("a scalar means all four edges alike, regardless of writing mode", () => {
    const expected = { top: 24, right: 24, bottom: 24, left: 24 };
    expect(marginInsets(24, "horizontal-tb")).toEqual(expected);
    expect(marginInsets(24, "vertical-rl")).toEqual(expected);
  });

  test("horizontal: the inline axis is left and right, the block axis top and bottom", () => {
    expect(marginInsets({ block: 16, inline: 48 }, "horizontal-tb")).toEqual({
      top: 16,
      right: 48,
      bottom: 16,
      left: 48,
    });
  });

  /**
   * When vertical, the inline axis **is the vertical one** (characters run top to bottom),
   * so `inline` gives top and bottom.
   *
   * Getting this slot backwards raises no error: the margins still shrink, it is just that
   * what the reader is adjusting becomes the invisible gutter between pages while the line
   * length does not move at all. Which reads as "the slider does nothing".
   */
  test("vertical: the inline axis is top and bottom, the block axis left and right — the opposite of horizontal", () => {
    expect(marginInsets({ block: 16, inline: 48 }, "vertical-rl")).toEqual({
      top: 48,
      right: 16,
      bottom: 48,
      left: 16,
    });
  });

  test("one axis-relative setting takes up the same total margin in both modes, just on swapped axes", () => {
    const horizontal = marginInsets({ block: 16, inline: 48 }, "horizontal-tb");
    const vertical = marginInsets({ block: 16, inline: 48 }, "vertical-rl");

    expect(horizontal.left + horizontal.right).toBe(vertical.top + vertical.bottom);
    expect(horizontal.top + horizontal.bottom).toBe(vertical.left + vertical.right);
  });
});

describe("column count", () => {
  test("vertical is always one column, even when the reader asks for two", () => {
    // ADR-0003's deliberate simplification. The reader's preference is not an error, it
    // just does not apply right now — so nothing is thrown.
    expect(resolveColumns("vertical-rl", 2, VIEWPORT)).toBe(1);
    expect(resolveColumns("vertical-rl", "auto", VIEWPORT)).toBe(1);
  });

  test("horizontal follows what the reader specified", () => {
    expect(resolveColumns("horizontal-tb", 1, VIEWPORT)).toBe(1);
    expect(resolveColumns("horizontal-tb", 2, VIEWPORT)).toBe(2);
  });

  test("auto decides on the available width, giving one column when narrow", () => {
    expect(resolveColumns("horizontal-tb", "auto", { width: 1200, height: 600 })).toBe(2);
    expect(resolveColumns("horizontal-tb", "auto", { width: 480, height: 600 })).toBe(1);
  });

  test("auto looks at the inline axis rather than width itself — vertical's inline axis is height", () => {
    // The vertical case is caught by the one-column rule first, so what this asks is that
    // "auto did not use height as width". A vertical viewport 1200 tall and 480 wide would
    // give one column on a width criterion and two on a height criterion. Neither is right
    // — vertical's answer is always 1.
    expect(resolveColumns("vertical-rl", "auto", { width: 480, height: 1200 })).toBe(1);
  });
});

describe("column setup", () => {
  test("horizontal, one column: the column width equals the available width, and the stride adds one gap", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("x");
    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(metrics.columnCount).toBe(1);
    // The next page's first column sits one page plus one gap away — that gutter falls
    // between two pages, where the reader never sees it.
    expect(metrics.stride).toBe(840);
  });

  test("vertical, one column: the column width is taken from the height", () => {
    const metrics = pageMetrics({
      writingMode: "vertical-rl",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("y");
    // This is the machine-readable form of spine's "a vertical column's width must equal
    // exactly one viewer height". If the column width followed the width, this would be
    // 800, and the screen would stack several pages into one.
    expect(metrics.inlineSize).toBe(600);
    expect(metrics.columnWidth).toBe(600);
    expect(metrics.blockSize).toBe(800);
    expect(metrics.stride).toBe(640);
  });

  test("horizontal, two columns: the two columns plus the gutter between fill the available width exactly", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 1000, height: 600 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.columnWidth).toBe(480);
    expect(metrics.columnCount).toBe(2);
    expect(metrics.columnWidth * 2 + metrics.columnGap).toBe(metrics.inlineSize);
    // The stride is the same formula as for one column: with two, the in-page gutter makes
    // up exactly the difference.
    expect(metrics.stride).toBe(1040);
  });

  test("fractional sizes are always floored — a stride cannot be fractional at fractional DPI", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 800.4, height: 600.6 },
      columns: 1,
      gap: 0,
    });

    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(Number.isInteger(metrics.stride)).toBe(true);
  });

  test("an extremely narrow viewport still yields a usable setup, never 0 or negative", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 10, height: 10 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.inlineSize).toBeGreaterThan(0);
    expect(metrics.columnWidth).toBeGreaterThan(0);
  });
});

describe("page count and page position", () => {
  const metrics: PageMetrics = pageMetrics({
    writingMode: "horizontal-tb",
    viewport: VIEWPORT,
    columns: 1,
    gap: 40,
  });

  test("content filling exactly one screen is one page", () => {
    expect(pageCountFor(metrics, metrics.inlineSize)).toBe(1);
  });

  test("an empty document is still one page, not zero", () => {
    // No consumer can handle zero pages — the page number becomes 1/0, and every
    // page-turn boundary check flips.
    expect(pageCountFor(metrics, 0)).toBe(1);
  });

  test("the total extent of three pages converts back to three pages", () => {
    // Three columns have two gutters between them, so the total is three strides less one
    // gap.
    const extent = metrics.stride * 3 - metrics.columnGap;
    expect(pageCountFor(metrics, extent)).toBe(3);
  });

  test("a fraction of a pixel over does not conjure an extra page", () => {
    // The most common slot at fractional DPI. Rounding up unconditionally would report a
    // blank fourth page.
    expect(pageCountFor(metrics, metrics.inlineSize + 0.4)).toBe(1);
    expect(pageCountFor(metrics, metrics.stride * 3 - metrics.columnGap + 0.4)).toBe(3);
  });

  test("a page's position is an integer multiple of the stride", () => {
    expect(pageOffsetFor(metrics, 0)).toBe(0);
    expect(pageOffsetFor(metrics, 1)).toBe(840);
    expect(pageOffsetFor(metrics, 3)).toBe(2520);
  });

  test("a scroll position converts back to the nearest page number", () => {
    expect(pageAt(metrics, 0)).toBe(0);
    expect(pageAt(metrics, 840)).toBe(1);
    // The browser nudges the scroll position by a fraction of a pixel — the reported page
    // number must not fall back a page because of it.
    expect(pageAt(metrics, 839.6)).toBe(1);
    expect(pageAt(metrics, 840.4)).toBe(1);
  });

  test("page number and page position are inverses of each other", () => {
    for (let page = 0; page < 20; page += 1) {
      expect(pageAt(metrics, pageOffsetFor(metrics, page))).toBe(page);
    }
  });
});

/**
 * The last page of a section whose content stops short of filling it (#96).
 *
 * The numbers are one real section of one real book, measured in the consumer rather than
 * invented here: 笑傲江湖's 【八】面壁 in a 1909×1167 window at 115%, two columns. They are
 * kept verbatim because the defect lives in the last digit — at integer DPI the clamped
 * scroll position rounds *up* into the last page and nothing is wrong, and 0.67px lower it
 * rounds down and the section can never be left.
 */
describe("a last page the document cannot scroll to", () => {
  const metrics: PageMetrics = pageMetrics({
    writingMode: "horizontal-tb",
    viewport: { width: 1511, height: 1062 },
    columns: 2,
    gap: 40,
  });

  const SCROLL_EXTENT = 33307;
  const PAGE_COUNT = pageCountFor(metrics, SCROLL_EXTENT);
  const MAX_OFFSET = maxScrollOffsetFor(SCROLL_EXTENT, metrics.inlineSize);

  test("the stride, page count and scroll ceiling are the measured ones", () => {
    expect(metrics.stride).toBe(1551);
    expect(PAGE_COUNT).toBe(22);
    expect(MAX_OFFSET).toBe(31796);
  });

  test("the last page's position is past what the document can scroll", () => {
    // Half a stride past it: the last page holds one column of text and an empty second
    // column, so the document stops half a page short of being able to head it.
    expect(pageOffsetFor(metrics, PAGE_COUNT - 1)).toBeGreaterThan(MAX_OFFSET);
  });

  test("scrolled to the end is the last page, whichever side of the rounding it lands", () => {
    // 31795.334 / 1551 = 20.49989, so `pageAt` alone answers 20 — one short, forever.
    expect(pageAt(metrics, 31795.333984375)).toBe(20);

    expect(pageAtScroll(metrics, 31795.333984375, MAX_OFFSET, PAGE_COUNT)).toBe(21);
    expect(pageAtScroll(metrics, MAX_OFFSET, MAX_OFFSET, PAGE_COUNT)).toBe(21);
  });

  test("a page short of the end is still reported by its scroll position", () => {
    expect(pageAtScroll(metrics, pageOffsetFor(metrics, 19), MAX_OFFSET, PAGE_COUNT)).toBe(19);
    expect(pageAtScroll(metrics, pageOffsetFor(metrics, 20), MAX_OFFSET, PAGE_COUNT)).toBe(20);
  });

  test("a section that fits on one screen scrolls nowhere and is page 0", () => {
    // maxOffset 0 with offset 0 satisfies "scrolled to the end" — and the answer it gives
    // is the right one, since page 0 is also the last page.
    expect(pageAtScroll(metrics, 0, 0, 1)).toBe(0);
  });

  test("a page count of zero cannot produce a page of -1", () => {
    expect(pageAtScroll(metrics, 0, 0, 0)).toBe(0);
  });
});

/**
 * Where the two pages of a turn in progress sit while the reader drags.
 *
 * The arithmetic is here rather than in `renderer.ts` for the same reason as the rest of this
 * module: every way it can be wrong is a way the incoming page comes in from the wrong side or
 * lags the finger, and neither is provable from inside a browser without a person looking.
 */
describe("a turn in progress", () => {
  const EXTENT = 600;

  test("nothing has moved before the finger does", () => {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const at = turnPlacement(edge, 0, EXTENT);
      expect(at.current).toEqual({ x: 0, y: 0 });
      // The incoming page is a whole page away, on whichever side it comes from.
      expect(Math.abs(at.incoming.x) + Math.abs(at.incoming.y)).toBe(EXTENT);
    }
  });

  test("the incoming page comes in from the edge it was given, and the current one gives way", () => {
    expect(turnPlacement("left", 150, EXTENT)).toEqual({
      current: { x: 150, y: 0 },
      incoming: { x: -450, y: 0 },
    });

    expect(turnPlacement("right", 150, EXTENT)).toEqual({
      current: { x: -150, y: 0 },
      incoming: { x: 450, y: 0 },
    });

    expect(turnPlacement("top", 150, EXTENT)).toEqual({
      current: { x: 0, y: 150 },
      incoming: { x: 0, y: -450 },
    });

    expect(turnPlacement("bottom", 150, EXTENT)).toEqual({
      current: { x: 0, y: -150 },
      incoming: { x: 0, y: 450 },
    });
  });

  test("a completed turn puts the incoming page exactly where the current one was", () => {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      expect(turnPlacement(edge, EXTENT, EXTENT).incoming).toEqual({ x: 0, y: 0 });
    }
  });

  test("the two pages never overlap: they are always one extent apart", () => {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      for (const distance of [0, 1, 199, EXTENT / 2, EXTENT]) {
        const at = turnPlacement(edge, distance, EXTENT);
        const apart =
          Math.abs(at.current.x - at.incoming.x) + Math.abs(at.current.y - at.incoming.y);
        expect(apart).toBe(EXTENT);
      }
    }
  });

  test("dragging past either end is clamped rather than scrolling on", () => {
    expect(turnPlacement("left", -80, EXTENT).current).toEqual({ x: 0, y: 0 });
    expect(turnPlacement("left", EXTENT + 80, EXTENT).current).toEqual({ x: EXTENT, y: 0 });
  });
});
