import { describe, expect, it } from "vitest";
import { hitBoxes, markStrips, MARK_CLEARANCE, WAVE_THICKNESS } from "./highlights";
import type { MarkedRectLike } from "./highlights";

// The container the reader is looking at, big enough that nothing here is clipped by it —
// clipping has its own tests in `highlights.test.ts`.
const CONTAINER = { width: 2000, height: 2000 };

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
    expect(markStrips([latinLine(0, 0, 200)], CONTAINER, false)).toEqual([
      { left: 0, top: 17 + MARK_CLEARANCE, width: 200, height: WAVE_THICKNESS },
    ]);
  });

  it("draws one strip per line, not one per rectangle", () => {
    // A line broken by an <em>: `rectsFor` reports three rectangles, and three elements would
    // each restart the mask at its own left edge — a visible jump at every seam.
    const line = [latinLine(0, 0, 80), latinLine(0, 80, 40), latinLine(0, 120, 60)];
    expect(markStrips(line, CONTAINER, false)).toEqual([
      { left: 0, top: 17 + MARK_CLEARANCE, width: 180, height: WAVE_THICKNESS },
    ]);
  });

  it("keeps two lines apart even when both start at the same place", () => {
    const strips = markStrips([latinLine(0, 0, 200), latinLine(1, 0, 140)], CONTAINER, false);
    expect(strips).toHaveLength(2);
    expect(strips[1]!.top).toBe(18 + 17 + MARK_CLEARANCE);
  });

  // The pair below is the whole case for frond's `minimum-ink-gap`. The placement here cannot
  // make 4px fit into 4px; what makes the mark clear of both lines is the line height having
  // been raised before any of this ran.
  it("does not fit between two lines the book set solid — which is why the floor exists", () => {
    const [first] = markStrips([latinLine(0, 0, 200), latinLine(1, 0, 200)], CONTAINER, false);
    const nextInkTop = 18 + 3;
    expect(first!.top + first!.height).toBeGreaterThan(nextInkTop);
  });

  it("clears both lines once the floor has raised the line height to 20px", () => {
    const raised = [latinLine(0, 0, 200, 20), latinLine(1, 0, 200, 20)];
    const [first] = markStrips(raised, CONTAINER, false);
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
    expect(markStrips([latinLine(0, 0, 80), sub, latinLine(0, 90, 60)], CONTAINER, false)).toEqual([
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
    expect(markStrips([base, ruby, rest], CONTAINER, true)).toEqual([
      {
        left: 724.75 + MARK_CLEARANCE,
        top: 0,
        width: WAVE_THICKNESS,
        height: 147.21,
      },
    ]);
  });

  it("hugs the base where there is no ruby", () => {
    expect(markStrips([base, rest], CONTAINER, true)).toEqual([
      { left: 716.75 + MARK_CLEARANCE, top: 0, width: WAVE_THICKNESS, height: 147.21 },
    ]);
  });

  it("draws one strip per column", () => {
    const second = verticalRun(669.55, 0, 147.21);
    expect(markStrips([base, ruby, rest, second], CONTAINER, true)).toHaveLength(2);
  });
});

describe("what a mark is not drawn on", () => {
  it("skips the ruby's own rectangle", () => {
    // The annotation is text the reader selected, but marking it draws a second line beside
    // the first. It still moves the mark outwards — that is the test above.
    const strips = markStrips([verticalRun(701.75, 0, 36.81, "ruby", 8)], CONTAINER, true);
    expect(strips).toEqual([]);
  });

  it("skips the two ideographic spaces a paragraph opens with", () => {
    const indent: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 30, height: 17 },
      ink: { x: 0, y: 3, width: 30, height: 14 },
    };
    const prose = latinLine(0, 30, 170);
    expect(markStrips([indent, prose], CONTAINER, false)).toEqual([
      { left: 30, top: 17 + MARK_CLEARANCE, width: 170, height: WAVE_THICKNESS },
    ]);
  });

  it("draws nothing at all on a line that is only blank", () => {
    const spacer: MarkedRectLike = {
      role: "blank",
      rect: { x: 0, y: 0, width: 15, height: 17 },
      ink: { x: 0, y: 3, width: 15, height: 14 },
    };
    expect(markStrips([spacer], CONTAINER, false)).toEqual([]);
  });

  it("clips a strip to the container like any other box", () => {
    const strips = markStrips([latinLine(0, 560, 100)], { width: 600, height: 400 }, false);
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
    expect(hitBoxes([indent, ruby], CONTAINER)).toHaveLength(2);
  });

  it("uses the text's own rectangle, not the strip beside it", () => {
    expect(hitBoxes([latinLine(0, 0, 200)], CONTAINER)).toEqual([
      { left: 0, top: 0, width: 200, height: 17 },
    ]);
  });
});
