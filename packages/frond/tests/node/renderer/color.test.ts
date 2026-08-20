import { describe, expect, test } from "vitest";
import {
  adaptColor,
  colorTheme,
  contrastRatio,
  parseColor,
  type ColorTheme,
} from "../../../src/renderer/color.ts";

/** Tidemarks' own dark theme, so the numbers here are the ones a reader actually meets. */
const DARK = colorTheme("#d8d5cf", "#1b1b1e") as ColorTheme;

/** How readable something is once `adaptColor` is done with it. */
function contrastAfter(value: string, theme: ColorTheme = DARK): number {
  const adapted = adaptColor(value, theme) ?? value;
  return contrastRatio(parseColor(adapted)!, theme.background);
}

describe("reading a colour value", () => {
  test("hex, in all four lengths", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, alpha: 1 });
    expect(parseColor("#aabbcc")).toEqual({ r: 170, g: 187, b: 204, alpha: 1 });
    expect(parseColor("#abcd")).toEqual({ r: 170, g: 187, b: 204, alpha: 221 / 255 });
    expect(parseColor("#aabbccdd")).toEqual({ r: 170, g: 187, b: 204, alpha: 221 / 255 });
  });

  test("rgb() in both notations, with numbers or percentages", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, alpha: 1 });
    expect(parseColor("rgb(1 2 3 / 0.5)")).toEqual({ r: 1, g: 2, b: 3, alpha: 0.5 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, alpha: 0.5 });
    expect(parseColor("rgb(100%, 0%, 0%)")).toEqual({ r: 255, g: 0, b: 0, alpha: 1 });
  });

  test("hsl(), where a bare number means a percentage", () => {
    // The same colour three ways. Measured against all three engines, which serialise
    // `hsl(210, 50%, 40%)` as `rgb(51, 102, 153)`.
    expect(parseColor("hsl(210, 50%, 40%)")).toEqual({ r: 51, g: 102, b: 153, alpha: 1 });
    expect(parseColor("hsl(210 50 40)")).toEqual({ r: 51, g: 102, b: 153, alpha: 1 });
    expect(parseColor("hsl(0.5833turn 50% 40%)")).toEqual({ r: 51, g: 102, b: 153, alpha: 1 });
  });

  test("named colours, the whole list rather than the obvious ones", () => {
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, alpha: 1 });
    expect(parseColor("REBECCAPURPLE")).toEqual({ r: 102, g: 51, b: 153, alpha: 1 });
    // 25 declarations of this one across the sample of 34 books, which is the whole
    // argument for carrying every name rather than the sixteen everyone remembers.
    expect(parseColor("steelblue")).toEqual({ r: 70, g: 130, b: 180, alpha: 1 });
  });

  test("what frond does not read comes back undefined rather than approximated", () => {
    for (const value of [
      "transparent",
      "currentColor",
      "inherit",
      "initial",
      "var(--ink)",
      "color-mix(in srgb, red, blue)",
      "oklch(0.7 0.1 200)",
      "#ab",
      "rgb(1, 2)",
      "rgb(1, 2, 3, 4, 5)",
      "",
    ]) {
      expect(parseColor(value), value).toBeUndefined();
    }
  });
});

describe("contrast", () => {
  test("the two ends of the scale", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor("#000")!, parseColor("#000")!)).toBeCloseTo(1, 5);
  });

  test("which way round the two colours are given does not matter", () => {
    const ink = parseColor("#518fcc")!;
    const paper = parseColor("#1b1b1e")!;
    expect(contrastRatio(ink, paper)).toBeCloseTo(contrastRatio(paper, ink), 10);
  });
});

describe("the reader's theme", () => {
  test("a background frond cannot read means no theme to measure against", () => {
    // The caller's signal to fall back to replacing every colour, which is what frond did
    // for every theme before ADR-0014.
    expect(colorTheme("#d8d5cf", "oklch(0.2 0 0)")).toBeUndefined();
    expect(colorTheme("#d8d5cf", "rgba(0, 0, 0, 0)")).toBeUndefined();
  });

  test("the foreground is carried verbatim, not normalised", () => {
    expect(colorTheme("var(--reader-ink)", "#1b1b1e")?.foreground).toBe("var(--reader-ink)");
  });
});

describe("adapting the book's colour to the reader's page", () => {
  test("a colour that already reads is left exactly as the book wrote it", () => {
    // The case this whole rule exists for. These are chapter-heading colours from the
    // sample: 190 of 951 declarations across 34 books are legible on a dark page already.
    for (const value of ["#518fcc", "#649056", "#8e8e8e", "#fff", "white"]) {
      expect(adaptColor(value, DARK), value).toBeUndefined();
    }
  });

  test("the book's body ink becomes the reader's", () => {
    for (const value of ["#000000", "#000", "black", "#333", "#231815"]) {
      expect(adaptColor(value, DARK), value).toBe("#d8d5cf");
    }
  });

  test("a grey the book dimmed on purpose stays a grey, dimmer than the reader's ink", () => {
    // Not the reader's ink: "this is a caption" is information the book put there, and
    // flattening it is the same defect as flattening a chapter heading, one size smaller.
    const adapted = adaptColor("#696969", DARK)!;
    expect(contrastRatio(parseColor(adapted)!, DARK.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseColor(adapted)!, DARK.background)).toBeLessThan(
      contrastRatio(parseColor(DARK.foreground)!, DARK.background),
    );
  });

  test("a colour that cannot be read keeps its hue and only moves in lightness", () => {
    // kusamakura's sesame dots, a committed fixture: #0000FF at contrast 2.00.
    const adapted = parseColor(adaptColor("#0000ff", DARK)!)!;
    expect(adapted.b).toBeGreaterThan(adapted.r);
    expect(adapted.r).toBe(adapted.g);
    expect(contrastAfter("#0000ff")).toBeGreaterThanOrEqual(4.5);
  });

  test("it moves as little as it can", () => {
    // #ff0000 is 4.30, a fifth of a step short, and comes out somewhere nobody can tell
    // apart from red. A fixed target lightness would drag it across the room for that.
    expect(adaptColor("#ff0000", DARK)).toBe("#ff2222");
  });

  test("everything it touches ends up readable", () => {
    for (const value of ["#000000", "#0000ff", "#4c4c4c", "#696969", "#a16a2b", "#00008b"]) {
      expect(contrastAfter(value), value).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("a translucent colour is judged by what the reader actually sees", () => {
    expect(adaptColor("rgba(0, 0, 0, 0.6)", DARK)).toBe("#d8d5cf");

    // The case that says why compositing has to happen at all. A fifth-strength white
    // measures 17.18 against the reader's page on its own, which is as readable as a
    // colour gets — and on the page it is a grey barely off the background. Judged
    // composited it fails, and comes out readable.
    expect(contrastRatio(parseColor("rgba(255, 255, 255, 0.2)")!, DARK.background)).toBeGreaterThan(
      15,
    );
    expect(contrastAfter("rgba(255, 255, 255, 0.2)")).toBeGreaterThanOrEqual(4.5);
  });

  test("text the book hid stays hidden", () => {
    // Both spellings of invisible. Replacing them would dig out text the book put away on
    // purpose, which is a worse outcome than any unreadable colour.
    expect(adaptColor("transparent", DARK)).toBeUndefined();
    expect(adaptColor("rgba(0, 0, 0, 0)", DARK)).toBeUndefined();
  });

  test("a light theme darkens rather than lightens, and reaches the same bar", () => {
    // Nothing in the rule assumes the reader's page is dark. Tidemarks sets no theme at all in
    // light mode, so this is unused today, but a rule that only worked one way round would
    // be a trap the day it is.
    const light = colorTheme("#1b1b1e", "#ffffff")!;
    expect(adaptColor("#000000", light)).toBeUndefined();
    expect(contrastAfter("#ffff00", light)).toBeGreaterThanOrEqual(4.5);

    // White is the one asymmetry, and it is held here rather than fixed: only the dark end
    // of the neutral scale has a threshold, so white comes out a readable mid grey instead
    // of the reader's ink. It cannot happen on a dark page, where white already reads.
    expect(adaptColor("#ffffff", light)).toBe("#767676");
    expect(adaptColor("#ffffff", DARK)).toBeUndefined();
  });
});
