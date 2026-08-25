// How long a line is allowed to be, and how many columns to ask for.
//
// The whole of ADR-0012 lands here. Two things it is worth having in mind while reading:
//
// **A line is a line in both writing modes.** Horizontally it is the column's width;
// vertically it is the text block's height, because vertical text runs down the page and
// frond's `column-width` measures the height there (`geometry.ts`). So this module never
// says "width" — it says **inline extent**, and picks the axis from the writing mode. That
// is the same split frond's `margin.inline` already makes, which is why the answer can be
// handed over as a single number.
//
// **The margin is the leftover, not the input.** Available extent = margin × 2 + line
// length × columns + gutters. Three of those are free; fix two and the third is settled.
// The reader's "margin" setting is therefore a **floor** — below the ceiling it is the whole
// answer, above it the ceiling takes over and the setting has nothing left to say.
//
// Everything here is pure: the box arrives measured. Reading it off the DOM belongs to the
// component, so this stays testable without a renderer — the same split `frondSettings` makes.

// The column gap is frond's own number, and everything below is frond's column arithmetic
// run backwards: "for lines of at most N ems in two columns, how much of the box does the
// text need". It used to be a copy of the digits, which fails in the quietest way there is —
// a copy does not break when the original changes, it goes on computing a slightly wrong
// line length.
import { COLUMN_GAP } from "@yurenju/frond/renderer";

/** Whether the book's characters are one em wide (CJK) or about half that (Latin). */
export type Script = "cjk" | "latin";

/** What the reader asked for. `'auto'` means "no opinion", which is the only case with a rule. */
export type ColumnChoice = "auto" | 1 | 2;

/**
 * The two numbers per script, in ems.
 *
 * `ceiling` is where a line stops growing. 40 ideographs is what a Japanese paperback sets
 * and what WCAG 1.4.8 allows for CJK; 30 ems of Latin is 63–74 letters depending on the
 * face, which sits inside the 45–75 convention. They differ because an ideograph is one em
 * and a Latin letter is about 0.41–0.48 of one, so the same physical line carries very
 * different amounts of reading.
 *
 * `columnFloor` is a different question — **not** a minimum line length. Line length has no
 * minimum (ADR-0012): a short line costs a few extra return sweeps, a small typeface costs
 * legibility, and the second is worse. This one only answers "is it worth splitting into two
 * columns", and it exists because frond's own 700px threshold produces 22 ideographs per
 * column on a tablet held landscape — fewer than the same tablet held upright.
 *
 * Each floor is the bottom of its script's comfortable band, which is the same relation on
 * both rows: 28 ideographs is where the 28–45 range starts, and 20 ems of Latin is 45–49
 * letters, where 45–75 starts. So neither split ever produces a column shorter than a book
 * would set.
 *
 * Exported because the shelf sets a quoted passage to the same ceiling, and it is the book's
 * own text there too. The alternative was writing `40em` into `library.css`, and a copy of a
 * number fails in the quietest way there is: it goes on computing a line length that used to
 * be right. Same reason `COLUMN_GAP` is public in frond.
 */
export const LINE_LENGTH: Record<Script, { ceiling: number; columnFloor: number }> = {
  cjk: { ceiling: 40, columnFloor: 28 },
  latin: { ceiling: 30, columnFloor: 20 },
};

/** The 50% mark, above which a book counts as ideographic. */
const IDEOGRAPHIC_MAJORITY = 0.5;

// Han, kana, hangul, and the CJK extensions past the BMP. Any of these is one em wide.
const IDEOGRAPHIC = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯\u{20000}-\u{2fa1f}]/u;
// Latin including the accented ranges. Cyrillic and Greek are half-width too, but no book
// spine has seen is set in them, and guessing wrong costs only a slightly long line.
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;

/**
 * Which script a book is set in, counted from its own text.
 *
 * **Deliberately not `dc:language`.** Publishers fill that in wrong often enough that it
 * cannot be trusted: of 36 books surveyed one declared `ja-JP` while containing 92% Han and
 * not a single kana, another wrote `CHT` (not a BCP 47 tag at all), and a third said only
 * `zh`. The text itself is unambiguous by comparison — the Chinese and Japanese books ran
 * 67–100% ideographs against Alice's 0%, so the halfway mark has twenty-odd points of room
 * on either side.
 *
 * This is not language detection and must not be used as such. It answers one question —
 * how wide is a character in this book — which is why Chinese, Japanese and Korean give the
 * same answer, and why a Chinese book quoting English still counts as ideographic.
 */
export function detectScript(sample: string): Script {
  let ideographic = 0;
  let latin = 0;

  for (const character of sample) {
    if (IDEOGRAPHIC.test(character)) ideographic++;
    else if (LATIN_LETTER.test(character)) latin++;
  }

  const counted = ideographic + latin;
  // Nothing to go on — punctuation, digits, or an image-only section. Both numbers in the
  // row have to be guessed then, and the column floor is where the guess shows: at latin's
  // 20 ems a page of Han characters splits into two columns of 20 ideographs, under the 28
  // a Chinese book sets. The other direction costs a line that runs slightly long. A floor
  // too low is felt on every page it splits; a ceiling too high is only reached on a wide
  // screen, so the wider floor is the cheaper thing to be wrong about.
  if (counted === 0) return "cjk";
  return ideographic / counted >= IDEOGRAPHIC_MAJORITY ? "cjk" : "latin";
}

/** The facts about the layout in front of the reader. None of these is a setting. */
export interface LayoutFacts {
  /** The box frond renders into, before any margin, in px. */
  readonly box: { readonly width: number; readonly height: number };
  /** Whether the section frond laid out runs vertically. */
  readonly vertical: boolean;
  /** What one em is, in px — the size frond was handed, not the book's own. */
  readonly fontSize: number;
  readonly script: Script;
}

/** The two settings that bear on this. */
export interface ReaderChoice {
  /** The "margin" setting, in px. A floor — see the file header. */
  readonly margin: number;
  readonly columns: ColumnChoice;
}

export interface Layout {
  /** What to hand frond as `margin.inline`, in px. A whole number. */
  readonly inlineMargin: number;
  readonly columns: 1 | 2;
  /**
   * How long one line comes out, in ems. Nothing downstream needs it — it is what the rule
   * is actually about, so tests and diagnostics can assert on the thing itself rather than
   * on a margin it has to divide back out.
   */
  readonly emsPerLine: number;
}

export function layoutFor(facts: LayoutFacts, choice: ReaderChoice): Layout {
  const { box, vertical, fontSize, script } = facts;
  const extent = vertical ? box.height : box.width;

  // Without an em there is no line length to talk about. This is not a real state — it is
  // the first paint, before the font has resolved — and answering with the reader's own
  // margin keeps the layout stable until a real size arrives.
  if (!(fontSize > 0)) {
    return { inlineMargin: inset(choice.margin, extent), columns: 1, emsPerLine: 0 };
  }

  const { ceiling, columnFloor } = LINE_LENGTH[script];
  const available = Math.max(0, extent - 2 * choice.margin);
  const columns = columnsFor(choice.columns, vertical, available, columnFloor * fontSize);

  // What the box would be if every column got a full-length line.
  const wanted = ceiling * fontSize * columns + COLUMN_GAP * (columns - 1);
  const used = Math.min(available, wanted);
  // Under the ceiling the reader's floor is the answer; over it, the leftover is.
  const margin = wanted < available ? (extent - wanted) / 2 : choice.margin;

  return {
    inlineMargin: inset(margin, extent),
    columns,
    emsPerLine: (used - COLUMN_GAP * (columns - 1)) / columns / fontSize,
  };
}

/**
 * Landing the requested column count on a real one.
 *
 * The floor applies to `'auto'` only. A reader who picked two columns has said something,
 * and a guess does not overrule it — not even on a phone, where two columns are eight
 * characters wide and plainly a bad idea. The panel disables the control when frond cannot
 * honour it at all (vertical), and that is a different thing: **can't do it** is grounds for
 * taking the choice away, **looks bad** is not.
 */
function columnsFor(
  choice: ColumnChoice,
  vertical: boolean,
  available: number,
  floor: number,
): 1 | 2 {
  // frond's vertical mode is single-column whatever it is asked (its ADR-0003). Agreeing
  // here is what keeps `emsPerLine` describing the page the reader actually gets.
  if (vertical) return 1;
  if (choice !== "auto") return choice;
  return (available - COLUMN_GAP) / 2 >= floor ? 2 : 1;
}

/**
 * A margin the box can actually give, as a whole number.
 *
 * Whole because frond derives the column width back from the container and a fractional
 * container leaves a fractional page stride, which accumulates into two half-pages on one
 * screen (frond's `geometry.ts` header). Clamped because a box narrower than twice the
 * reader's margin would otherwise inset the text out of existence.
 */
function inset(margin: number, extent: number): number {
  return Math.max(0, Math.min(Math.round(margin), Math.floor((extent - 1) / 2)));
}
