import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type {
  FontFace as FrondFontFace,
  LayoutFacts as FrondLayoutFacts,
  ReaderSettings as FrondSettings,
} from "@yurenju/frond/renderer";
import { fontStack } from "./chinese";
import { MARK_CLEARANCE, WAVE_THICKNESS } from "./highlights";
import { BOLD_BOUNDARY, faceWeightDescriptors, fontLanguageFor, READING_WEIGHTS } from "./web-font";
import type { LoadedWebFont } from "./web-font-store";
import { layoutFor, type ColumnChoice, type Script } from "./line-length";

export type Theme = "system" | "light" | "dark";
export type FontChoice = "publisher" | "sans" | "serif";

// The reader's own settings, as the panel and localStorage see them. `frondSettings()` at
// the bottom is the one place that turns them into what frond takes.
//
// **One layer.** Every book renders from this one record, so adjusting anything adjusts every
// book. There used to be a second layer where a single book could claim four of the six for
// itself, and the reader had to press a button to move a change up to the default — which got
// the direction backwards, since what a reader is nearly always saying is "this is how I read"
// rather than "this is how this book should look" (ADR-0026).
export interface ReaderSettings {
  theme: Theme;
  /** 'publisher' keeps the book's own fonts; sans/serif resolve to a CJK stack per book language */
  fontFamily: FontChoice;
  /**
   * Font size, as a **percentage of the reader's own root font size**.
   *
   * The basis is the live root size rather than a number Tidemarks picks, so a reader who set
   * their browser's default font larger gets a larger book without touching this at all.
   * Tidemarks' own UI is all `rem` and has followed that setting all along; the book was the one
   * place that ignored it, because this used to be an absolute px.
   *
   * A percentage is also the mechanism's own vocabulary: frond relativises the book's absolute
   * sizes against 16 and sets the root, so what it wants is a ratio — the px it takes is that
   * ratio already multiplied out, which `frondSettings` does. `loadSettings` migrates the
   * stored values, of which there are now two older vocabularies.
   */
  fontSize: number;
  /** How many columns to a page. `'auto'` lets the line length decide (ADR-0012). */
  columns: ColumnChoice;
  /** unitless multiplier; 0 = book default */
  lineHeight: number;
  /**
   * Whitespace along the line-length axis, in px — a **floor**, not the final answer.
   *
   * Available extent = margin × 2 + line length × columns + gutters, so margin and line
   * length are two ends of one equation and only one of them can be a setting. This is the
   * one the panel offers, and it wins only while the line-length ceiling is out of reach;
   * past that the ceiling sets the margin and this has nothing left to say (ADR-0012).
   */
  margin: number;
}

export const FONT_FAMILIES: { label: MessageDescriptor; value: FontChoice }[] = [
  {
    label: msg({
      message: "Book's",
      comment:
        "One of three typeface choices, and the default: leave the fonts the book itself asked for. Short because the three sit side by side in a panel about a phone-width wide — Chinese says 書籍預設, which is narrower than English can be here.",
    }),
    value: "publisher",
  },
  {
    label: msg({
      message: "Sans",
      comment:
        "One of three typeface choices for the book: a sans-serif face. In Chinese and Japanese this is a named style rather than a description — 黑體 / ゴシック体 — so use that name, not a translation of 'sans'.",
    }),
    value: "sans",
  },
  {
    label: msg({
      message: "Serif",
      comment:
        "One of three typeface choices for the book: a serif face. In Chinese and Japanese this is a named style rather than a description — 明體 / 明朝体 — so use that name, not a translation of 'serif'.",
    }),
    value: "serif",
  },
];

export const FONT_SIZE_MIN = 80;
export const FONT_SIZE_MAX = 200;
/**
 * The notches the slider offers. 5% is about the smallest step a reader can tell apart on a
 * page of text, and every value that leaves `loadSettings` sits on one of them — a stored
 * value off the ladder would be a size the panel could show but never return to.
 */
export const FONT_SIZE_STEP = 5;

export const MARGINS: { label: MessageDescriptor; value: number }[] = [
  {
    label: msg({ message: "None", comment: "Smallest of four margin widths: no margin at all." }),
    value: 0,
  },
  { label: msg({ message: "Small", comment: "One of four margin widths." }), value: 16 },
  {
    label: msg({ message: "Medium", comment: "One of four margin widths, and the default." }),
    value: 32,
  },
  { label: msg({ message: "Large", comment: "Widest of four margin widths." }), value: 48 },
];

/**
 * The panel's column choices.
 *
 * Counted in columns rather than pages: frond advances a page by the whole container, so two
 * columns are turned past together. They are one page with two columns, not two pages — which
 * is why the Chinese says 欄 and not 頁.
 */
export const COLUMN_CHOICES: { label: MessageDescriptor; value: ColumnChoice }[] = [
  {
    label: msg({
      message: "Auto",
      comment:
        "One of three column choices for a page: let the line length decide how many columns fit.",
    }),
    value: "auto",
  },
  {
    label: msg({
      message: "One",
      comment: "One column to a page. The word is a count of columns, not the digit.",
    }),
    value: 1,
  },
  {
    label: msg({
      message: "Two",
      comment: "Two columns to a page, turned past together as one page.",
    }),
    value: 2,
  },
];
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.4;

/**
 * The line heights on offer. `0` is not a height — it is "leave whatever the book asked for".
 *
 * Here rather than in the panel because two panels offer them now: this book's, in the reader,
 * and every book's, in the settings drawer. One ladder, so a value set in one is a value the
 * other can show.
 */
export const LINE_HEIGHTS: { label: MessageDescriptor; value: number }[] = [
  {
    label: msg({
      message: "Book's",
      comment:
        "First of six line-height choices, and not a height at all: it means 'leave whatever the book asked for'. Same wording as the first typeface choice, which means the same thing — they share one entry deliberately.",
    }),
    value: 0,
  },
  {
    label: msg({
      message: "Tight (1.4)",
      comment: "One of six line heights. The number is the multiplier and stays as it is.",
    }),
    value: 1.4,
  },
  {
    label: msg({
      message: "Standard (1.6)",
      comment: "One of six line heights. The number is the multiplier and stays as it is.",
    }),
    value: 1.6,
  },
  {
    label: msg({
      message: "Loose (1.8)",
      comment: "One of six line heights. The number is the multiplier and stays as it is.",
    }),
    value: 1.8,
  },
  {
    label: msg({
      message: "Looser (2.0)",
      comment: "One of six line heights. The number is the multiplier and stays as it is.",
    }),
    value: 2,
  },
  {
    label: msg({
      message: "Loosest (2.2)",
      comment: "Widest of six line heights. The number is the multiplier and stays as it is.",
    }),
    value: 2.2,
  },
];

export const THEME_CHOICES: { label: MessageDescriptor; value: Theme }[] = [
  {
    label: msg({
      message: "System",
      comment: "One of three theme choices: follow whatever the operating system is set to.",
    }),
    value: "system",
  },
  {
    label: msg({
      message: "Light",
      comment: "One of three theme choices: dark text on a pale page.",
    }),
    value: "light",
  },
  {
    label: msg({
      message: "Dark",
      comment: "One of three theme choices: pale text on a dark page.",
    }),
    value: "dark",
  },
];

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "system",
  fontFamily: "publisher",
  // Not a round 100: this is exactly what the old 18px default migrates to, so the size the
  // reader sees does not move — and there is one number to explain rather than two.
  fontSize: 115,
  columns: "auto",
  lineHeight: 0,
  margin: 32,
};

const KEY = "tidemarks-settings";
const THEMES: Theme[] = ["system", "light", "dark"];
const FONT_CHOICES: FontChoice[] = ["publisher", "sans", "serif"];

// The range the setting was stored in while it was an absolute px. It cannot overlap the
// percentages — px topped out at 32 and percentages start at 70 — so a stored number says for
// itself which vocabulary it is in.
const LEGACY_PX_MIN = 14;
const LEGACY_PX_MAX = 32;
// The percentages epub.js was given. Spelled out rather than reusing the range the panel
// offers today: what an old stored value could be is a fact about the past, and reading it
// through today's range would turn a narrowing of the panel into a data loss.
const LEGACY_PERCENT_MIN = 70;
const LEGACY_PERCENT_MAX = 200;
// Every browser's `font-size: medium`, and the fallback basis when the real root cannot be read.
const BROWSER_DEFAULT_PX = 16;

// One validator per setting, each answering `undefined` for "not a value anyone chose", which
// `loadSettings` reads as "use the default".
function validTheme(v: unknown): Theme | undefined {
  return THEMES.includes(v as Theme) ? (v as Theme) : undefined;
}

function validColumns(v: unknown): ColumnChoice | undefined {
  return COLUMN_CHOICES.some((c) => c.value === v) ? (v as ColumnChoice) : undefined;
}

function validFontFamily(v: unknown): FontChoice | undefined {
  return FONT_CHOICES.includes(v as FontChoice) ? (v as FontChoice) : undefined;
}

function validLineHeight(v: unknown): number | undefined {
  if (typeof v !== "number") return undefined;
  if (v === 0) return 0; // the book's own line height
  return v >= LINE_HEIGHT_MIN && v <= LINE_HEIGHT_MAX ? v : undefined;
}

function validMargin(v: unknown): number | undefined {
  return MARGINS.some((m) => m.value === v) ? (v as number) : undefined;
}

/** Onto the nearest notch, and inside the range the panel offers. */
function snapToOfferedSize(percent: number): number {
  const snapped = Math.round(percent / FONT_SIZE_STEP) * FONT_SIZE_STEP;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, snapped));
}

// Reads a stored font size as a percentage, whichever of the three vocabularies it was
// written in.
//
// A reader who had deliberately set 160%, or 30px, keeps a comparable size rather than being
// reset to the default — the setting is one they made, and silently dropping it is the worse
// failure of the two. Clamping rather than rejecting is the same argument one step down: a
// value outside the range still says "smaller than standard", and the nearest size Tidemarks
// offers keeps that intent where the default would lose it.
function validFontSize(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;

  // px, from the frond migration. Divided by the browser default because that is what frond
  // was resolving those px against — a root size Tidemarks set absolutely, ignoring the reader's.
  if (v >= LEGACY_PX_MIN && v <= LEGACY_PX_MAX) {
    return snapToOfferedSize((v / BROWSER_DEFAULT_PX) * 100);
  }

  // A percentage: either one Tidemarks wrote, or one from before the px detour. The two need no
  // conversion between them, because epub.js resolved its percentage against the browser
  // default as well — the difference is only that the basis now follows the reader.
  if (v >= LEGACY_PERCENT_MIN && v <= LEGACY_PERCENT_MAX) return snapToOfferedSize(v);

  // Neither vocabulary — a corrupt value rather than a setting anyone made.
  return undefined;
}

/**
 * The reader's own root font size in px, which is what `fontSize` is a percentage of.
 *
 * Read live rather than assumed, because the whole point is to follow a reader who set their
 * browser's default font larger. Tidemarks sets no root size of its own, so this **is** that
 * setting; the day Tidemarks sets one, this quietly starts answering something else.
 *
 * Browser zoom deliberately does not show up here — zoom scales the rendered page, so applying
 * it again through the basis would compound it.
 */
export function readRootFontSize(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : BROWSER_DEFAULT_PX;
}

/** One per device, all six settings, every book, never synced (ADR-0026 for the sync half). */
export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      theme: validTheme(parsed.theme) ?? DEFAULT_SETTINGS.theme,
      fontFamily: validFontFamily(parsed.fontFamily) ?? DEFAULT_SETTINGS.fontFamily,
      fontSize: validFontSize(parsed.fontSize) ?? DEFAULT_SETTINGS.fontSize,
      // Under a different key from the `spread` this replaced, so the old stored value falls
      // away instead of being misread: `'double'` used to mean "let frond decide", which is
      // what `'auto'` means now, while `2` means two columns come what may. Reusing the key
      // would silently turn one into the other. No migration — that is the development
      // phase's whole point (ADR-0004).
      columns: validColumns(parsed.columns) ?? DEFAULT_SETTINGS.columns,
      lineHeight: validLineHeight(parsed.lineHeight) ?? DEFAULT_SETTINGS.lineHeight,
      margin: validMargin(parsed.margin) ?? DEFAULT_SETTINGS.margin,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ReaderSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode); settings just won't persist
  }
}

// Dark-mode ink and paper. Light mode deliberately has no theme at all: the book's own
// colours are left alone, which is what the reader gets today and what frond's authority
// order calls "no setting means no intervention".
const DARK_THEME = { foreground: "#d8d5cf", background: "#1b1b1e", link: "#8ab4f8" };

/**
 * What a native selection is painted with inside the book, per theme.
 *
 * ⚠️ **These are `--selection-wash` restated**, and the two have to be changed together.
 * Nothing enforces it, and nothing can: `::selection` matches only inside the document holding
 * the text, and that document is frond's iframe — a token in `styles/tokens.css` never reaches
 * it. So the value has to travel as a value, the same way `DARK_THEME` above does.
 *
 * **Sent under both themes, unlike the theme itself.** Light mode deliberately hands frond no
 * theme (the book keeps its own colours), but the browser's default selection blue is not one
 * of the book's colours — it is the browser's, and it fills in the counters of Han characters
 * at any hour of the day (#52).
 *
 * On touch this is never seen: native selection is off there and the wash is drawn by
 * `SelectionLayer` from the token itself (ADR-0036). The one value covers both so that the two
 * halves of the app cannot drift into two different blues — and `tokens.test.ts` compares this
 * against the stylesheet, which is the only thing that can.
 */
export const SELECTION_WASH = {
  light: "rgba(46, 74, 117, 0.16)",
  dark: "rgba(126, 166, 206, 0.22)",
} as const;

/**
 * What the mapping needs beyond the settings themselves: facts about the device and the book
 * in front of the reader, none of which anyone picked from the panel.
 */
export interface RenderContext {
  /** 'system' already resolved against the OS — frond takes a colour, not a preference. */
  theme: "light" | "dark";
  /** Whether this book is written in simplified characters, which picks the font stack. */
  simplified: boolean;
  /** Whether the book's characters are one em wide, which sets the line-length ceiling. */
  script: Script;
  /** The reader's own root size in px — what `fontSize`'s percentage is a percentage of. */
  rootFontSize: number;
  /**
   * The faces Tidemarks carries that are on this device already (ADR-0014) — empty until one
   * has been fetched, and empty for good on a book with no Han characters or a reader who
   * is offline. Empty means every mapping below behaves exactly as it did before Tidemarks
   * carried any font.
   */
  webFonts: readonly LoadedWebFont[];
}

/**
 * The reader's settings as frond takes them, **minus the two that need a layout**.
 *
 * This is the whole boundary between the two vocabularies, and it is a pure function so the
 * mapping is testable without a renderer — which is why the basis arrives as an argument
 * instead of being read off the document here (`readRootFontSize` does that).
 *
 * The split from `frondLayout` is frond's, not a preference of ours: everything here is
 * written into the document while it is still text, before there is anything on screen to
 * read a writing mode from. Three decisions worth naming:
 *
 * - **`fontSize` is multiplied out here, and only here.** The reader's setting is a ratio and
 *   frond wants px, so this is the one place that has to know what the ratio is against. It
 *   is also the only place that could know: nothing below this line has any business reading
 *   the reader's browser preferences.
 * - **`genericFamilies` is always supplied**, including for 'publisher'. That is the
 *   setting's reason for existing: a reader who wants the book's own typography still needs
 *   `font-family: serif` to land on a face with vertical punctuation glyphs, and this is the
 *   only way to say so without replacing the book's fonts wholesale.
 * - **`margin` and `columns` are not here.** Both fall out of one question — how long is a
 *   line allowed to be — and that question needs the writing mode, which does not exist yet.
 *   They are answered in `frondLayout`, at the moment it does.
 */
export function frondSettings(
  settings: ReaderSettings,
  context: RenderContext,
): Partial<FrondSettings> {
  const { theme, simplified, rootFontSize, webFonts } = context;
  const stack = (kind: "sans" | "serif") =>
    carriedFirst(fontStack(kind, simplified), webFonts, kind);

  // Keeping the book's own fonts means keeping its own weights: the faces are declared over
  // the whole axis and nothing restates anything. Picking a typeface is picking Tidemarks'
  // two-weight system along with it, and that is what both fields below carry.
  const chosen = settings.fontFamily === "publisher" ? undefined : settings.fontFamily;

  // **The kind the reader picked, not any kind.** A device that fetched the sans earlier and
  // is now on 明體 has a face in hand and none of it is the one being restated onto — the book
  // renders in the platform's serif, which has whatever weights it has. Restating the book's
  // 500 as 800 there is an intervention against a face nobody chose the weights of.
  const pinned = chosen !== undefined && webFonts.some((font) => font.kind === chosen);

  return {
    fontSize: frondFontSize(settings, rootFontSize),
    fontFamily: chosen === undefined ? undefined : stack(chosen),
    lineHeight: settings.lineHeight === 0 ? undefined : settings.lineHeight,
    // The room a mark needs between one line's ink and the next: 4px of wave, 0.7 clear of
    // this line and 1.3 clear of the next (ADR-0032). frond turns it into a line height,
    // because the arithmetic needs the book's font metrics and only frond can read them.
    //
    // Sent unconditionally, and it costs nothing to. It has no effect at all unless the book
    // is set tighter than that, and frond skips it outright when the reader has chosen a line
    // height — every rung the panel offers already leaves more than 6px.
    minimumInkGap: MARK_CLEARANCE + WAVE_THICKNESS + 1.3,
    theme: theme === "dark" ? DARK_THEME : undefined,
    selectionBackground: SELECTION_WASH[theme],
    genericFamilies: {
      serif: stack("serif"),
      sansSerif: stack("sans"),
    },
    fontFaces:
      webFonts.length === 0
        ? undefined
        : webFonts.flatMap((font) => frondFontFaces(font, font.kind === chosen)),
    // The one weight the descriptors above cannot reach — see frond's `FontWeights` for what
    // the gap is and why no third descriptor closes it. Sent only where there is a pinned face
    // for it to land on.
    fontWeights:
      pinned && chosen !== undefined
        ? { ...READING_WEIGHTS[chosen], boundary: BOLD_BOUNDARY }
        : undefined,
    // Only alongside a face Tidemarks actually carries. The property shapes whatever face the
    // text lands on, and against a platform font that is an instruction to something nobody
    // here has seen — some faces carry no `locl` at all, and which regional forms one holds
    // is not knowable from its name. Our own is a pan-CJK build with all five language
    // systems in it, which is what makes the tag mean something.
    fontLanguage: webFonts.length === 0 ? undefined : fontLanguageFor(simplified),
  };
}

/**
 * A carried face as frond takes it — **one `@font-face` per weight descriptor, all naming
 * the same file.**
 *
 * `family` is a CSS value, so it carries its own quotes. The descriptors are where the
 * reader's choice lands: keeping the book's own fonts declares the whole axis and the book's
 * weights are drawn as written, while picking 黑體 or 明體 declares two single-value ranges
 * that pin every weight onto one of the reader's two (`web-font.ts`'s
 * `faceWeightDescriptors`).
 *
 * Two rules over one URL costs nothing: the font cache is keyed on the URL, so the file is
 * parsed once however many times it is named (`web-font-store.ts`).
 */
function frondFontFaces(font: LoadedWebFont, quantise: boolean): FrondFontFace[] {
  return faceWeightDescriptors(font.kind, quantise).map((weight) => ({
    family: `'${font.family}'`,
    src: font.src,
    weight,
  }));
}

/**
 * The carried face moved to the front of a stack it is already somewhere in.
 *
 * `chinese.ts` names it first **for the book's own variant** — but a Simplified book leads
 * with `Noto Serif CJK SC`, a face Tidemarks does not carry, so ours would sit behind whatever
 * a reader happens to have installed under that name. Moving it to the front is what makes
 * "the same font on every machine" true for Simplified books too; the variant of the glyphs
 * is `fontLanguage`'s job, not the stack's.
 *
 * Moved rather than prepended, so the name is never in the list twice.
 */
function carriedFirst(
  stack: string,
  webFonts: readonly LoadedWebFont[],
  kind: "sans" | "serif",
): string {
  const carried = webFonts.find((font) => font.kind === kind);
  if (!carried) return stack;

  const quoted = `'${carried.family}'`;
  const families = stack.split(", ").filter((family) => family !== quoted);
  return [quoted, ...families].join(", ");
}

/**
 * The two settings that cannot be answered until the book is on screen — frond's
 * `resolveLayout`.
 *
 * Both fall out of one question, "how long is a line allowed to be" (ADR-0012), and that
 * question needs two facts nobody has before `attach()`: **which axis the line lies along**,
 * which is the writing mode, and how big the container is. frond states both at the moment
 * it has them and asks for the answer back, so it is in force for that same layout — the
 * axis is never guessed and nothing is corrected afterwards. Correcting afterwards is what
 * costs a second layout, and a second layout under a restored position is #29.
 *
 * The block axis keeps a small fixed inset: what the reader adjusts is line length, and the
 * block axis is not it.
 *
 * frond is handed a **settled** column count rather than `'auto'`, because its own `'auto'`
 * splits at a fixed 700px, and that lands at 22 ideographs per column on a tablet held
 * landscape — fewer than the same tablet held upright.
 */
export function frondLayout(
  settings: ReaderSettings,
  context: Pick<RenderContext, "script" | "rootFontSize">,
  facts: FrondLayoutFacts,
): Partial<Pick<FrondSettings, "margin" | "columns">> {
  const layout = layoutFor(
    {
      box: facts.viewport,
      vertical: facts.writingMode === "vertical-rl",
      fontSize: frondFontSize(settings, context.rootFontSize),
      script: context.script,
    },
    { margin: settings.margin, columns: settings.columns },
  );

  return { margin: { block: 16, inline: layout.inlineMargin }, columns: layout.columns };
}

/**
 * The reader's ratio multiplied out into the px frond wants.
 *
 * Rounded to two places: frond writes this straight into the stylesheet it injects, and that
 * text is the only thing visible when investigating a problem. It is shared because the line
 * length is measured in ems of it — the two answers have to be against the same number, or
 * the ceiling lands somewhere other than where the text actually is.
 */
function frondFontSize(settings: ReaderSettings, rootFontSize: number): number {
  return Math.round(rootFontSize * settings.fontSize) / 100;
}
