// The line-length rule itself: how the script is read, how the ceiling and the column floor
// are computed, and what is left over as margin. All pure arithmetic, no layout — that the
// numbers computed here actually land on the element is one wiring test in
// tests/browser/reader/line-length.spec.ts.
import { describe, expect, it } from "vitest";
import { detectScript, layoutFor, type LayoutFacts } from "./line-length";
import { COLUMN_GAP } from "@yurenju/frond/renderer";

// The default font size, 115% of a 16px root — the size every number below is in ems of.
const EM = 18.4;

// The box frond renders into, at the window sizes that were actually measured. The reader's
// two page buttons take 96px off the window above 700px wide; below that they are hidden.
const PHONE = { width: 390, height: 844 };
const TABLET_LANDSCAPE = { width: 1024 - 96, height: 768 - 79 };
const LAPTOP = { width: 1440 - 96, height: 900 - 79 };
const WIDE = { width: 2560 - 96, height: 1440 - 79 };

function facts(
  box: { width: number; height: number },
  over: Partial<LayoutFacts> = {},
): LayoutFacts {
  return { box, vertical: false, fontSize: EM, script: "cjk", ...over };
}

const READER = { margin: 32, columns: "auto" as const };

describe("detectScript", () => {
  it("reads a Chinese book as ideographic", () => {
    expect(detectScript("我冒了嚴寒，回到相隔二千餘里，別了二十餘年的故鄉去。")).toBe("cjk");
  });

  it("reads a Japanese book as ideographic, kana included", () => {
    expect(detectScript("山路を登りながら、こう考えた。智に働けば角が立つ。")).toBe("cjk");
  });

  it("reads an English book as latin", () => {
    expect(detectScript("Alice was beginning to get very tired of sitting by her sister")).toBe(
      "latin",
    );
  });

  // The most Latin-heavy Chinese book in the 34 surveyed still ran 74% ideographs, and the
  // sample spine takes is the front of the book, where the English is densest.
  it("reads a Chinese book with English in it as ideographic", () => {
    const sample = "創業投資聖經：Startup 募資、天使投資人、投資契約、談判策略全方位教戰法則";
    expect(detectScript(sample)).toBe("cjk");
  });

  // A book with no letters at all — an image-only front matter, say. The answer picks the
  // wider column floor, which is the cheaper thing to be wrong about: too low a floor splits
  // pages it should not, while too high a ceiling is only reached on a wide screen.
  it("answers ideographic when there is nothing to count", () => {
    expect(detectScript("   ——…… 「」 ")).toBe("cjk");
    expect(detectScript("")).toBe("cjk");
  });
});

describe("layoutFor", () => {
  describe("the ceiling", () => {
    it("caps an ideographic line at 40 ems and turns the rest into margin", () => {
      const layout = layoutFor(facts(WIDE), READER);
      expect(layout.columns).toBe(2);
      expect(layout.emsPerLine).toBeCloseTo(40, 1);
      // The reader asked for 32px; the ceiling wants far more, so the ceiling wins.
      expect(layout.inlineMargin).toBe(476);
    });

    it("caps a latin line at 30 ems", () => {
      const layout = layoutFor(facts(WIDE, { script: "latin" }), READER);
      expect(layout.emsPerLine).toBeCloseTo(30, 1);
    });

    it("leaves the reader their margin when the ceiling is out of reach", () => {
      // A phone: 390px is 21 ems, nowhere near 40, so the ceiling never comes into it.
      const layout = layoutFor(facts(PHONE), READER);
      expect(layout.inlineMargin).toBe(32);
      expect(layout.columns).toBe(1);
      expect(layout.emsPerLine).toBeCloseTo(17.7, 1);
    });

    it("still lets the reader widen the margin below the ceiling", () => {
      const narrow = layoutFor(facts(PHONE), { ...READER, margin: 48 });
      const wide = layoutFor(facts(PHONE), { ...READER, margin: 0 });
      expect(narrow.emsPerLine).toBeLessThan(wide.emsPerLine);
    });

    it("does not let the reader shrink the margin below the ceiling", () => {
      // Above the ceiling the margin is derived, so the setting has nothing left to say.
      const none = layoutFor(facts(WIDE), { ...READER, margin: 0 });
      const large = layoutFor(facts(WIDE), { ...READER, margin: 48 });
      expect(none.inlineMargin).toBe(large.inlineMargin);
    });
  });

  describe("vertical writing", () => {
    it("measures the line along the height, not the width", () => {
      const layout = layoutFor(facts(WIDE, { vertical: true }), READER);
      expect(layout.emsPerLine).toBeCloseTo(40, 1);
      // 1361 tall, 736 of it text: the rest is split top and bottom.
      expect(layout.inlineMargin).toBe(313);
    });

    it("is single column whatever the reader asked for", () => {
      // frond's vertical mode is always one column, so agreeing with it is what keeps
      // `emsPerLine` honest.
      expect(layoutFor(facts(WIDE, { vertical: true }), { ...READER, columns: 2 }).columns).toBe(1);
    });
  });

  describe("how many columns", () => {
    it("does not split when each column would fall under 28 ideographs", () => {
      // A tablet held landscape. frond's own rule splits at 700px available, which lands
      // here at 22 ideographs per column — shorter than the same tablet held upright.
      const layout = layoutFor(facts(TABLET_LANDSCAPE), READER);
      expect(layout.columns).toBe(1);
      expect(layout.emsPerLine).toBeCloseTo(40, 1);
    });

    it("splits once each column clears the floor", () => {
      const layout = layoutFor(facts(LAPTOP), READER);
      expect(layout.columns).toBe(2);
      expect(layout.emsPerLine).toBeCloseTo(33.7, 1);
    });

    it("honours an explicit single column on a wide screen", () => {
      const layout = layoutFor(facts(WIDE), { ...READER, columns: 1 });
      expect(layout.columns).toBe(1);
      expect(layout.emsPerLine).toBeCloseTo(40, 1);
    });

    // The floor is a guess for when nobody has said anything. A reader who picked two
    // columns has said something, and spine does not overrule it — the panel disables the
    // control when frond cannot do it at all, which is a different thing.
    it("honours an explicit two columns even on a phone", () => {
      const layout = layoutFor(facts(PHONE), { ...READER, columns: 2 });
      expect(layout.columns).toBe(2);
      expect(layout.emsPerLine).toBeLessThan(10);
    });
  });

  // The cases above all sit comfortably on one side or the other, which means an off-by-one
  // in a threshold — or an inequality facing the wrong way — would sail past them. These sit
  // one pixel either side of each threshold instead.
  describe("right on the thresholds", () => {
    // 40 ems of text plus the reader's own margin on each side: one pixel narrower and the
    // ceiling has nothing to trim, one pixel wider and it does.
    const CEILING_EXACT = 40 * EM + 2 * READER.margin;

    it("leaves the margin alone at exactly the ceiling", () => {
      const layout = layoutFor(facts({ width: CEILING_EXACT, height: 800 }), {
        ...READER,
        columns: 1,
      });
      expect(layout.inlineMargin).toBe(READER.margin);
      expect(layout.emsPerLine).toBeCloseTo(40, 2);
    });

    it("starts trimming one pixel past it", () => {
      const layout = layoutFor(facts({ width: CEILING_EXACT + 1, height: 800 }), {
        ...READER,
        columns: 1,
      });
      expect(layout.inlineMargin).toBe(READER.margin + 1);
      expect(layout.emsPerLine).toBeCloseTo(40, 2);
    });

    // Two columns of exactly 28 ems with the gutter between them, plus the reader's margin.
    const SPLIT_EXACT = 2 * 28 * EM + COLUMN_GAP + 2 * READER.margin;

    it("splits at exactly 28 ideographs a column", () => {
      const layout = layoutFor(facts({ width: SPLIT_EXACT, height: 800 }), READER);
      expect(layout.columns).toBe(2);
      expect(layout.emsPerLine).toBeCloseTo(28, 2);
    });

    it("does not split one pixel below it", () => {
      const layout = layoutFor(facts({ width: SPLIT_EXACT - 1, height: 800 }), READER);
      expect(layout.columns).toBe(1);
    });

    it("holds the same threshold for latin, at its own floor", () => {
      const exact = 2 * 20 * EM + COLUMN_GAP + 2 * READER.margin;
      const at = facts({ width: exact, height: 800 }, { script: "latin" });
      const below = facts({ width: exact - 1, height: 800 }, { script: "latin" });
      expect(layoutFor(at, READER).columns).toBe(2);
      expect(layoutFor(below, READER).columns).toBe(1);
    });
  });

  describe("degenerate boxes", () => {
    it("survives a box with no room in it", () => {
      const layout = layoutFor(facts({ width: 0, height: 0 }), READER);
      expect(layout.columns).toBe(1);
      expect(layout.inlineMargin).toBe(0);
      expect(layout.emsPerLine).toBe(0);
    });

    it("never insets more than the box can give", () => {
      const layout = layoutFor(facts({ width: 60, height: 400 }), { ...READER, margin: 48 });
      expect(layout.inlineMargin * 2).toBeLessThan(60);
    });

    it("survives a font size of zero", () => {
      const layout = layoutFor(facts(LAPTOP, { fontSize: 0 }), READER);
      expect(Number.isFinite(layout.emsPerLine)).toBe(true);
      expect(layout.columns).toBe(1);
    });
  });

  it("keeps the gutter out of the line length", () => {
    // Two columns share the box with a gap between them, and that gap is not text.
    const layout = layoutFor(facts(LAPTOP), READER);
    const text = layout.emsPerLine * EM * layout.columns;
    const box = LAPTOP.width - layout.inlineMargin * 2;
    expect(box - text).toBeCloseTo(COLUMN_GAP, 0);
  });
});
