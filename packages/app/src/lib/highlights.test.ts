import { describe, expect, it } from "vitest";
import { boxesContain, markVar, visibleBoxes, DEFAULT_MARK, MARKS } from "./highlights";

// The container the reader is looking at. frond reports rectangles in these coordinates, with
// the margin already added back, and reports them **truthfully** — a position two pages ahead
// comes back at a large x because pages are made by scrolling one long multi-column layout.
// Deciding what to do about that is this module's job.
const CONTAINER = { width: 600, height: 400 };

describe("visibleBoxes", () => {
  it("keeps a rectangle on the current page", () => {
    expect(visibleBoxes([{ x: 40, y: 50, width: 200, height: 24 }], CONTAINER)).toEqual([
      { left: 40, top: 50, width: 200, height: 24 },
    ]);
  });

  it("drops a rectangle on the next page", () => {
    // Measured in frond's own test: at a container width of 600, a position one page ahead
    // comes back at x = 632. Painting it unconditionally would put the highlight outside the
    // page — which is why frond calls clipping the consumer's policy.
    expect(visibleBoxes([{ x: 632, y: 50, width: 200, height: 24 }], CONTAINER)).toEqual([]);
  });

  it("drops a rectangle on the previous page", () => {
    expect(visibleBoxes([{ x: -240, y: 50, width: 200, height: 24 }], CONTAINER)).toEqual([]);
  });

  it("drops a rectangle touching the far edge exactly", () => {
    // The first sliver of the next page has no area on this one.
    expect(visibleBoxes([{ x: 600, y: 0, width: 100, height: 24 }], CONTAINER)).toEqual([]);
  });

  it("cuts a rectangle that straddles the edge at the boundary", () => {
    // A highlight whose line breaks across a column boundary. Clipping rather than leaving it
    // to `overflow: hidden` keeps one answer for painting and for hit-testing, so the
    // invisible half never becomes a tap target.
    expect(visibleBoxes([{ x: 560, y: 10, width: 100, height: 24 }], CONTAINER)).toEqual([
      { left: 560, top: 10, width: 40, height: 24 },
    ]);
  });

  it("clips along the block axis too, which is the one vertical books page along", () => {
    expect(visibleBoxes([{ x: 10, y: -10, width: 30, height: 60 }], CONTAINER)).toEqual([
      { left: 10, top: 0, width: 30, height: 50 },
    ]);
  });

  it("returns nothing for a range frond could not locate at all", () => {
    // A highlight in another section: frond answers with an empty array rather than guessing.
    expect(visibleBoxes([], CONTAINER)).toEqual([]);
  });

  it("keeps one box per line of a multi-line selection", () => {
    const boxes = visibleBoxes(
      [
        { x: 40, y: 50, width: 200, height: 24 },
        { x: 40, y: 74, width: 160, height: 24 },
      ],
      CONTAINER,
    );
    expect(boxes).toHaveLength(2);
  });
});

describe("boxesContain", () => {
  const boxes = [{ left: 100, top: 100, width: 80, height: 20 }];

  it("recognises a tap inside a highlight", () => {
    expect(boxesContain({ x: 140, y: 110 }, boxes)).toBe(true);
  });

  it("includes the edges, because a fingertip is not a pixel", () => {
    expect(boxesContain({ x: 100, y: 100 }, boxes)).toBe(true);
    expect(boxesContain({ x: 180, y: 120 }, boxes)).toBe(true);
  });

  it("rejects a tap outside", () => {
    expect(boxesContain({ x: 99, y: 110 }, boxes)).toBe(false);
    expect(boxesContain({ x: 140, y: 130 }, boxes)).toBe(false);
  });

  it("rejects everything when nothing is painted", () => {
    expect(boxesContain({ x: 140, y: 110 }, [])).toBe(false);
  });
});

describe("markVar", () => {
  it("names the ink rather than spelling its value", () => {
    // A hex here would be a value read once at render, and a mark drawn before the reader
    // switched themes would keep the old theme's colour until the next layout.
    expect(markVar("ochre")).toBe("var(--mark-ochre)");
  });

  it("carries the four names this app used to write to the ink nearest each", () => {
    // `color` has always held a name, so nothing has to be migrated — but a row saying
    // `yellow` is still out there, on an older copy of the app and on the reader's other
    // device, and letting all four collapse onto the default would lose which was which.
    expect(markVar("yellow")).toBe("var(--mark-ochre)");
    expect(markVar("blue")).toBe("var(--mark-indigo)");
    expect(markVar("green")).toBe("var(--mark-moss)");
    expect(markVar("pink")).toBe("var(--mark-soot)");
  });

  it("falls back to the default ink for a name from nowhere", () => {
    // A fifth ink synced down from a newer version of the app. An invisible highlight is a
    // passage the reader marked and cannot find.
    expect(markVar("chartreuse")).toBe(`var(--mark-${DEFAULT_MARK})`);
  });

  it("gives every offered ink a Chinese name", () => {
    expect(MARKS.map((mark) => mark.label)).toEqual(["蓼藍", "赭石", "苔綠", "松煙"]);
  });
});
