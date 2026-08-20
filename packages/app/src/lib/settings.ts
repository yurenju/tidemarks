import type {
  FontFace as FrondFontFace,
  LayoutFacts as FrondLayoutFacts,
  ReaderSettings as FrondSettings,
} from "@yurenju/frond/renderer";
import { fontStack } from "./chinese";
import { fontLanguageFor, weightRange } from "./web-font";
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
   * The basis is the live root size rather than a number Folis picks, so a reader who set
   * their browser's default font larger gets a larger book without touching this at all.
   * Folis's own UI is all `rem` and has followed that setting all along; the book was the one
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

export const FONT_FAMILIES: { label: string; value: FontChoice }[] = [
  { label: "書籍預設", value: "publisher" },
  { label: "黑體", value: "sans" },
  { label: "明體", value: "serif" },
];

export const FONT_SIZE_MIN = 80;
export const FONT_SIZE_MAX = 200;
/**
 * The notches the slider offers. 5% is about the smallest step a reader can tell apart on a
 * page of text, and every value that leaves `loadSettings` sits on one of them — a stored
 * value off the ladder would be a size the panel could show but never return to.
 */
export const FONT_SIZE_STEP = 5;

export const MARGINS: { label: string; value: number }[] = [
  { label: "無", value: 0 },
  { label: "小", value: 16 },
  { label: "中", value: 32 },
  { label: "大", value: 48 },
];

/**
 * The panel's column choices.
 *
 * Labelled 欄 rather than 頁: frond advances a page by the whole container, so two columns
 * are turned past together. They are one page with two columns, not two pages.
 */
export const COLUMN_CHOICES: { label: string; value: ColumnChoice }[] = [
  { label: "自動", value: "auto" },
  { label: "單欄", value: 1 },
  { label: "雙欄", value: 2 },
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
export const LINE_HEIGHTS: { label: string; value: number }[] = [
  { label: "書籍預設", value: 0 },
  { label: "緊密（1.4）", value: 1.4 },
  { label: "標準（1.6）", value: 1.6 },
  { label: "寬鬆（1.8）", value: 1.8 },
  { label: "更寬鬆（2.0）", value: 2 },
  { label: "最寬（2.2）", value: 2.2 },
];

export const THEME_CHOICES: { label: string; value: Theme }[] = [
  { label: "跟隨系統", value: "system" },
  { label: "淺色", value: "light" },
  { label: "深色", value: "dark" },
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

const KEY = "folis-settings";
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
// value outside the range still says "smaller than standard", and the nearest size Folis
// offers keeps that intent where the default would lose it.
function validFontSize(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;

  // px, from the frond migration. Divided by the browser default because that is what frond
  // was resolving those px against — a root size Folis set absolutely, ignoring the reader's.
  if (v >= LEGACY_PX_MIN && v <= LEGACY_PX_MAX) {
    return snapToOfferedSize((v / BROWSER_DEFAULT_PX) * 100);
  }

  // A percentage: either one Folis wrote, or one from before the px detour. The two need no
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
 * browser's default font larger. Folis sets no root size of its own, so this **is** that
 * setting; the day Folis sets one, this quietly starts answering something else.
 *
 * Browser zoom deliberately does not show up here — zoom scales the rendered page, so applying
 * it again through the basis would compound it.
 */
export function readRootFontSize(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : BROWSER_DEFAULT_PX;
}

/** One per device, all six settings, every book, never synced (ADR-0005 for the sync half). */
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
   * The faces Folis carries that are on this device already (ADR-0014) — empty until one
   * has been fetched, and empty for good on a book with no Han characters or a reader who
   * is offline. Empty means every mapping below behaves exactly as it did before Folis
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

  return {
    fontSize: frondFontSize(settings, rootFontSize),
    fontFamily: settings.fontFamily === "publisher" ? undefined : stack(settings.fontFamily),
    lineHeight: settings.lineHeight === 0 ? undefined : settings.lineHeight,
    theme: theme === "dark" ? DARK_THEME : undefined,
    genericFamilies: {
      serif: stack("serif"),
      sansSerif: stack("sans"),
    },
    fontFaces: webFonts.length === 0 ? undefined : webFonts.map(frondFontFace),
    // Only alongside a face Folis actually carries. The property shapes whatever face the
    // text lands on, and against a platform font that is an instruction to something nobody
    // here has seen — some faces carry no `locl` at all, and which regional forms one holds
    // is not knowable from its name. Our own is a pan-CJK build with all five language
    // systems in it, which is what makes the tag mean something.
    fontLanguage: webFonts.length === 0 ? undefined : fontLanguageFor(simplified),
  };
}

/**
 * A carried face as frond takes it. `family` is a CSS value, so it carries its own quotes,
 * and `weight` is the **range** the face answers to rather than the single weight it was
 * drawn at — see `weightRange`, which is what keeps a book's `font-weight: 500` emphasis
 * visible once the reader has chosen a face.
 */
function frondFontFace(font: LoadedWebFont): FrondFontFace {
  return { family: `'${font.family}'`, src: font.src, weight: weightRange(font.weight) };
}

/**
 * The carried face moved to the front of a stack it is already somewhere in.
 *
 * `chinese.ts` names it first **for the book's own variant** — but a Simplified book leads
 * with `Noto Serif CJK SC`, a face Folis does not carry, so ours would sit behind whatever
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
