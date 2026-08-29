// What a mark is drawn on and what it can be tapped on, given rectangles frond has already
// measured: clipped to the page, one strip per line, clear of ruby and of the indent. The
// rectangles themselves come from a real engine — packages/app/tests/browser/reader/highlights.spec.ts
// paints one in three browsers and measures where it landed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boxesContain,
  hitBoxes,
  markStrips,
  markVar,
  textBoxes,
  visibleBoxes,
  DEFAULT_MARK,
  MARKS,
  MARK_CLEARANCE,
  WAVELENGTH,
  WAVE_THICKNESS,
} from "./highlights";
import type { MarkedRectLike } from "./highlights";
import { i18n } from "./i18n";

// The page the reader is looking at, as frond's `pageBox()` states it. Rectangles arrive in
// the container's coordinates with the margin already added back, and arrive **truthfully** —
// a position two pages ahead comes back at a large x because pages are made by scrolling one
// long multi-column layout. Deciding what to do about that is this module's job.
//
// It sits at the container's own corner here, which is the no-margin case. `WIDE` below is the
// one that separates page from container, and it is the case the clipping got wrong.
const PAGE = { left: 0, top: 0, width: 600, height: 400 };

describe("visibleBoxes", () => {
  it("keeps a rectangle on the current page", () => {
    expect(visibleBoxes([{ x: 40, y: 50, width: 200, height: 24 }], PAGE)).toEqual([
      { left: 40, top: 50, width: 200, height: 24 },
    ]);
  });

  it("drops a rectangle on the next page", () => {
    // Measured in frond's own test: at a container width of 600, a position one page ahead
    // comes back at x = 632. Painting it unconditionally would put the highlight outside the
    // page — which is why frond calls clipping the consumer's policy.
    expect(visibleBoxes([{ x: 632, y: 50, width: 200, height: 24 }], PAGE)).toEqual([]);
  });

  it("drops a rectangle on the previous page", () => {
    expect(visibleBoxes([{ x: -240, y: 50, width: 200, height: 24 }], PAGE)).toEqual([]);
  });

  it("drops a rectangle touching the far edge exactly", () => {
    // The first sliver of the next page has no area on this one.
    expect(visibleBoxes([{ x: 600, y: 0, width: 100, height: 24 }], PAGE)).toEqual([]);
  });

  it("cuts a rectangle that straddles the edge at the boundary", () => {
    // A highlight whose line breaks across a column boundary. Clipping rather than leaving it
    // to `overflow: hidden` keeps one answer for painting and for hit-testing, so the
    // invisible half never becomes a tap target.
    expect(visibleBoxes([{ x: 560, y: 10, width: 100, height: 24 }], PAGE)).toEqual([
      { left: 560, top: 10, width: 40, height: 24 },
    ]);
  });

  it("clips along the block axis too, which is the one vertical books page along", () => {
    expect(visibleBoxes([{ x: 10, y: -10, width: 30, height: 60 }], PAGE)).toEqual([
      { left: 10, top: 0, width: 30, height: 50 },
    ]);
  });

  it("returns nothing for a range frond could not locate at all", () => {
    // A highlight in another section: frond answers with an empty array rather than guessing.
    expect(visibleBoxes([], PAGE)).toEqual([]);
  });

  // The page is not the container, and on a wide screen the difference is most of the margin.
  //
  // Measured in Chrome at 1273×853 (#41): the container is 1273 wide, the page 959, and the
  // reader's margin 157 on each side. Two pages are only `COLUMN_GAP` apart, so the next page
  // starts at 157 + 959 + 40 = 1156 — which is **inside the container** by 117px, exactly
  // `margin - gap`. Clipping to the container therefore paints the head of the next page's
  // marks in this page's right-hand margin, half cut off.
  const WIDE = { left: 157, top: 16, width: 959, height: 821 };

  it("drops a rectangle on the next page even when the margin leaves room for it", () => {
    expect(visibleBoxes([{ x: 1156, y: 22.5, width: 300, height: 34.5 }], WIDE)).toEqual([]);
  });

  it("keeps a rectangle in the last stretch of this page, which sits past the page's width", () => {
    // The other half of the same claim, and the one that says the page is a box rather than a
    // size: this rectangle is genuinely on screen — the page ends at 157 + 959 = 1116 — and
    // clipping from the container's origin would cut it at 959.
    expect(visibleBoxes([{ x: 1000, y: 100, width: 100, height: 24 }], WIDE)).toEqual([
      { left: 1000, top: 100, width: 100, height: 24 },
    ]);
  });

  it("drops a rectangle in the margin before the page begins", () => {
    // The previous page's tail, which leaks in on the left by the same `margin - gap`.
    expect(visibleBoxes([{ x: 40, y: 100, width: 100, height: 24 }], WIDE)).toEqual([]);
  });

  it("keeps one box per line of a multi-line selection", () => {
    const boxes = visibleBoxes(
      [
        { x: 40, y: 50, width: 200, height: 24 },
        { x: 40, y: 74, width: 160, height: 24 },
      ],
      PAGE,
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

  it("names every offered ink after the pigment, in the reader's language", () => {
    expect(MARKS.map((mark) => i18n._(mark.label))).toEqual(["Indigo", "Ochre", "Moss", "Soot"]);

    i18n.activate("zh-TW");
    expect(MARKS.map((mark) => i18n._(mark.label))).toEqual(["蓼藍", "赭石", "苔綠", "松煙"]);
    i18n.activate("en");
  });
});

// Big enough that nothing in the mark-placement cases below is clipped by it; clipping has
// its own cases above.
const ROOMY = { left: 0, top: 0, width: 2000, height: 2000 };

/**
 * Alice, 15.33px Times New Roman, `line-height: normal`, measured in the running reader.
 *
 * The rectangle is the font's content area (ascent 14 + descent 3) and the ink sits 3px inside
 * its top, reaching the bottom. Lines are 18px apart, so the ink of one line ends 4px before
 * the ink of the next begins — the number ADR-0032 is built on.
 */
function latinLine(index: number, x: number, width: number, pitch = 18): MarkedRectLike {
  const top = index * pitch;
  return {
    role: "text",
    rect: { x, y: top, width, height: 17 },
    ink: { x, y: top + 3, width, height: 14 },
  };
}

/** 草枕, vertical: the rectangle is already tight to the glyphs, so ink and rect coincide. */
function verticalRun(
  left: number,
  y: number,
  height: number,
  role: MarkedRectLike["role"] = "text",
  width = 15,
): MarkedRectLike {
  const box = { x: left, y, width, height };
  return { role, rect: box, ink: box };
}

describe("markStrips, horizontally", () => {
  it("puts the wave just below the ink, not below the box", () => {
    // The box ends at 17; the ink ends there too on this line, and the strip clears it by
    // MARK_CLEARANCE. Drawing from the box's bottom would be the same number here and the
    // wrong one on any line without descenders — which is why the ink is what is measured.
    expect(markStrips([latinLine(0, 0, 200)], ROOMY, false)).toEqual([
      { left: 0, top: 17 + MARK_CLEARANCE, width: 200, height: WAVE_THICKNESS },
    ]);
  });

  it("draws one strip per line, not one per rectangle", () => {
    // A line broken by an <em>: `rectsFor` reports three rectangles, and three elements would
    // each restart the mask at its own left edge — a visible jump at every seam.
    const line = [latinLine(0, 0, 80), latinLine(0, 80, 40), latinLine(0, 120, 60)];
    expect(markStrips(line, ROOMY, false)).toEqual([
      { left: 0, top: 17 + MARK_CLEARANCE, width: 180, height: WAVE_THICKNESS },
    ]);
  });

  it("keeps two lines apart even when both start at the same place", () => {
    const strips = markStrips([latinLine(0, 0, 200), latinLine(1, 0, 140)], ROOMY, false);
    expect(strips).toHaveLength(2);
    expect(strips[1]!.top).toBe(18 + 17 + MARK_CLEARANCE);
  });

  // The pair below is the whole case for frond's `minimum-ink-gap`. The placement here cannot
  // make 4px fit into 4px; what makes the mark clear of both lines is the line height having
  // been raised before any of this ran.
  it("does not fit between two lines the book set solid — which is why the floor exists", () => {
    const [first] = markStrips([latinLine(0, 0, 200), latinLine(1, 0, 200)], ROOMY, false);
    const nextInkTop = 18 + 3;
    expect(first!.top + first!.height).toBeGreaterThan(nextInkTop);
  });

  it("clears both lines once the floor has raised the line height to 20px", () => {
    const raised = [latinLine(0, 0, 200, 20), latinLine(1, 0, 200, 20)];
    const [first] = markStrips(raised, ROOMY, false);
    const nextInkTop = 20 + 3;
    expect(first!.top).toBeGreaterThan(17);
    expect(first!.top + first!.height).toBeLessThanOrEqual(nextInkTop);
  });

  it("is pushed down by a subscript, and stays one line", () => {
    // A <sub> hangs below the baseline. Taking the outermost ink on the line is what keeps the
    // mark off it — and keeps it one line rather than a step in the middle of a word.
    const sub: MarkedRectLike = {
      role: "text",
      rect: { x: 80, y: 4, width: 10, height: 17 },
      ink: { x: 80, y: 7, width: 10, height: 14 },
    };
    expect(markStrips([latinLine(0, 0, 80), sub, latinLine(0, 90, 60)], ROOMY, false)).toEqual([
      { left: 0, top: 21 + MARK_CLEARANCE, width: 150, height: WAVE_THICKNESS },
    ]);
  });
});

describe("markStrips, vertically", () => {
  // 草枕: the base runs down x 701.75–716.75 and its ruby sits immediately to the right.
  const base = verticalRun(701.75, 0, 36.81);
  const ruby = verticalRun(716.75, 0, 36.81, "ruby", 8);
  const rest = verticalRun(701.75, 36.81, 110.4);

  it("goes outside the ruby, not against the base characters", () => {
    expect(markStrips([base, ruby, rest], ROOMY, true)).toEqual([
      {
        left: 724.75 + MARK_CLEARANCE,
        top: 0,
        width: WAVE_THICKNESS,
        height: 147.21,
      },
    ]);
  });

  it("hugs the base where there is no ruby", () => {
    expect(markStrips([base, rest], ROOMY, true)).toEqual([
      { left: 716.75 + MARK_CLEARANCE, top: 0, width: WAVE_THICKNESS, height: 147.21 },
    ]);
  });

  it("draws one strip per column", () => {
    const second = verticalRun(669.55, 0, 147.21);
    expect(markStrips([base, ruby, rest, second], ROOMY, true)).toHaveLength(2);
  });
});

describe("what a mark is not drawn on", () => {
  it("skips the ruby's own rectangle", () => {
    // The annotation is text the reader selected, but marking it draws a second line beside
    // the first. It still moves the mark outwards — that is the test above.
    const strips = markStrips([verticalRun(701.75, 0, 36.81, "ruby", 8)], ROOMY, true);
    expect(strips).toEqual([]);
  });

  it("skips the two ideographic spaces a paragraph opens with", () => {
    const indent: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 30, height: 17 },
      ink: { x: 0, y: 3, width: 30, height: 14 },
    };
    const prose = latinLine(0, 30, 170);
    expect(markStrips([indent, prose], ROOMY, false)).toEqual([
      { left: 30, top: 17 + MARK_CLEARANCE, width: 170, height: WAVE_THICKNESS },
    ]);
  });

  it("draws nothing at all on a line that is only blank", () => {
    const spacer: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 15, height: 17 },
      ink: { x: 0, y: 3, width: 15, height: 14 },
    };
    expect(markStrips([spacer], ROOMY, false)).toEqual([]);
  });

  it("clips a strip to the page like any other box", () => {
    const strips = markStrips(
      [latinLine(0, 560, 100)],
      { left: 0, top: 0, width: 600, height: 400 },
      false,
    );
    expect(strips).toEqual([
      { left: 560, top: 17 + MARK_CLEARANCE, width: 40, height: WAVE_THICKNESS },
    ]);
  });
});

describe("hitBoxes", () => {
  it("counts the ruby and the blank, which the mark is not drawn on", () => {
    // Tapping the annotation over a passage the reader marked has to open its note; so does
    // tapping the indent in front of it. Painting and hit-testing part company here, and this
    // is the half that stays generous.
    const indent: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 30, height: 17 },
      ink: { x: 0, y: 3, width: 30, height: 14 },
    };
    const ruby = verticalRun(716.75, 0, 36.81, "ruby", 8);
    expect(hitBoxes([indent, ruby], ROOMY)).toHaveLength(2);
  });

  it("uses the text's own rectangle, not the strip beside it", () => {
    expect(hitBoxes([latinLine(0, 0, 200)], ROOMY)).toEqual([
      { left: 0, top: 0, width: 200, height: 17 },
    ]);
  });
});

describe("textBoxes", () => {
  it("drops the ruby and the blank, which hit-testing keeps", () => {
    // The third answer, and the one in the middle: it is drawn, so it follows `markStrips` in
    // refusing the gloss and the indent — a passage filled in over its own furigana is a block
    // of colour a line taller than the words the reader marked. `hitBoxes` above keeps both,
    // for the opposite reason: tapping the gloss of a marked word is tapping that word.
    const indent: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 30, height: 17 },
      ink: { x: 0, y: 3, width: 30, height: 14 },
    };
    const ruby = verticalRun(716.75, 0, 36.81, "ruby", 8);
    const text = verticalRun(700, 0, 36.81, "text", 16);
    expect(textBoxes([indent, ruby, text], ROOMY)).toEqual([
      { left: 700, top: 0, width: 16, height: 36.81 },
    ]);
  });
});

describe("the wave's two numbers, which live in two languages", () => {
  // `markStrips` sizes the strip and the stylesheet sizes the mask that fills it. They have to
  // agree: a mask larger than its box repeats inside it and the wave comes out chopped, a
  // smaller one leaves a gap — and neither raises anything. The ADR names this as the failure
  // mode that argued for one wave height everywhere, so it is worth a line of test.
  //
  // **Two files, because the two halves of the wave live apart**: `mask-size` is on the strip
  // in `book.css`, while the tile it repeats is a token — `--wave-h` and `--wave-v` in
  // `tokens.css` — since the four inks all draw the same wave. Naming them rather than
  // reassembling the whole sheet (which is `tokens.test.ts`'s job) is what makes a failure here
  // say which of the two drifted, and reading the wrong file cannot pass quietly: `toContain`
  // would simply find nothing.
  const css = ["../styles/tokens.css", "../styles/book.css"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");

  it("the mask is exactly as thick as the strip, on both axes", () => {
    expect(css).toContain(`mask-size: ${WAVELENGTH}px ${WAVE_THICKNESS}px`);
    expect(css).toContain(`mask-size: ${WAVE_THICKNESS}px ${WAVELENGTH}px`);
  });

  it("and each tile's own viewBox is that size, so no crest is clipped", () => {
    expect(css).toContain(`width='${WAVELENGTH}' height='${WAVE_THICKNESS}'`);
    expect(css).toContain(`width='${WAVE_THICKNESS}' height='${WAVELENGTH}'`);
  });
});
