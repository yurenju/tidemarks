/**
 * Where the ink is, as opposed to where the boxes are.
 *
 * A consumer drawing a mark beside a line needs to know what the glyphs occupy, and the boxes
 * the DOM hands out are not that. A text node's rectangle is the font's **content area** —
 * ascent plus descent, both of which carry internal leading the glyphs never reach — and the
 * line box around it adds half-leading on each side. Measured on Alice in chromium, 15.33px
 * Times New Roman set at `line-height: normal`:
 *
 * | | px |
 * | --- | --- |
 * | line pitch | 18 |
 * | rectangle (font ascent 14 + descent 3) | 17 |
 * | ink (ascent 11 + descent 3) | 14 |
 * | **gap between one line's ink and the next line's** | **4** |
 *
 * Asking the boxes gives 1px there and says the case is hopeless; asking the ink gives 4px and
 * says it nearly fits. Every number in Tidemarks' ADR-0032 rests on the second answer.
 *
 * This module is the arithmetic, kept apart from the DOM so it can be tested without one. What
 * needs a browser — the font's own metrics — is measured in `section-view.ts` and passed in.
 */

/**
 * Characters that paint an empty box the width of a glyph.
 *
 * Deliberately short. An ordinary space, a tab and a newline collapse away under normal white
 * space processing, so they occupy nothing and there is nothing to leave unmarked; splitting a
 * rectangle around them would multiply rectangles and change no pixel. These two do occupy a
 * cell: the ideographic space that opens a paragraph in Chinese and Japanese setting, and the
 * no-break space some books use for the same job.
 */
const BLANK = /^[　 ]+$/;

/** A stretch of one text node, and whether it is all blank. */
export interface Run {
  readonly start: number;
  readonly end: number;
  readonly blank: boolean;
}

/**
 * A string cut into maximal runs of blank and non-blank.
 *
 * The reason this exists is the paragraph indent: Chinese and Japanese books very often open a
 * paragraph with two ideographic spaces, and those live in the **same text node** as the prose
 * after them, so they land in the same rectangle. A mark drawn across that rectangle starts two
 * cells before the first word. Cutting the node into runs lets the consumer drop the blank one
 * and keep the rest.
 *
 * An empty string yields no runs, not one empty run: a caller iterating these is asking "what
 * is there to measure", and the answer is nothing.
 */
export function blankRuns(text: string): readonly Run[] {
  const runs: Run[] = [];
  let start = 0;

  for (let index = 1; index <= text.length; index += 1) {
    const ends = index === text.length;
    const changes = !ends && isBlank(text[index]!) !== isBlank(text[start]!);
    if (!ends && !changes) continue;

    runs.push({ start, end: index, blank: isBlank(text[start]!) });
    start = index;
  }

  return runs;
}

function isBlank(character: string): boolean {
  return BLANK.test(character);
}

/** A font's vertical metrics, in px, all measured from the baseline. */
export interface FontInk {
  /** `fontBoundingBoxAscent` — the top of the rectangle the DOM reports. */
  readonly boxAscent: number;
  /** `fontBoundingBoxDescent` — the bottom of it. */
  readonly boxDescent: number;
  /** How far the tallest glyphs actually reach. */
  readonly inkAscent: number;
  /** How far the deepest ones do. */
  readonly inkDescent: number;
}

/**
 * The ink's own top and bottom inside a text node's rectangle.
 *
 * The rectangle's top is the baseline minus the **box** ascent, so the ink starts that much
 * further down and ends at the baseline plus the ink descent. Where a font reports no useful
 * metrics — the numbers arrive as zeros — the rectangle is returned unchanged rather than
 * collapsed to a line: a mark drawn against a wrong-but-plausible edge is worse than one drawn
 * where it has always been.
 */
export function inkWithin(
  rect: { readonly top: number; readonly bottom: number },
  font: FontInk,
): { readonly top: number; readonly bottom: number } {
  const usable = font.boxAscent > 0 && font.inkAscent > 0 && font.inkAscent <= font.boxAscent;
  if (!usable) return { top: rect.top, bottom: rect.bottom };

  const baseline = rect.top + font.boxAscent;
  return {
    top: baseline - font.inkAscent,
    // Clamped to the rectangle: a font whose glyphs overshoot their own descent would otherwise
    // push the mark past the box and into the next line, which is the fault being fixed here.
    bottom: Math.min(rect.bottom, baseline + font.inkDescent),
  };
}

/**
 * The smallest unitless line-height that leaves `gap` px between one line's ink and the next.
 *
 * Straight from the identity this whole file is about — the half-leading cancels, being added
 * once on each side:
 *
 *     gap between the ink of consecutive lines = line-height − ink height
 *
 * The answer is a ratio because that is what `line-height` takes, but it is **not** a constant
 * ratio: the gap is an absolute number of pixels, so the same font needs a looser line at a
 * smaller size. Tidemarks' ADR-0032 tabulates what that comes to across the sizes the reader
 * can pick.
 */
export function minimumLineHeight(font: FontInk, fontSize: number, gap: number): number {
  if (fontSize <= 0) return 0;
  return (font.inkAscent + font.inkDescent + gap) / fontSize;
}
