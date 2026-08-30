/**
 * The CJK faces spine carries itself, rather than borrowing whatever the machine happens to
 * have (ADR-0014).
 *
 * This module is the "which and whether" half — it names the faces, decides whether a book
 * needs them at all, and says which glyph variant they should be shaped with. Getting the
 * bytes onto the device and back out as a URL is `web-font-store.ts`.
 *
 * Everything here is pure, so the decision that costs the reader 16 MB is testable without a
 * network or a database.
 */

import type { FontChoice } from "./settings";

export type WebFontKind = "sans" | "serif";

export interface WebFont {
  /**
   * The family name, which is deliberately **the name the typeface itself ships under**
   * rather than one of spine's own.
   *
   * A machine that already has Noto installed registers the same name, and an `@font-face`
   * beats an installed face of the same name in all three engines — so reusing the name
   * means the reader gets our copy, of a version we know, instead of whatever the distro
   * packaged. A spine-specific name would have needed adding to every stack in `chinese.ts`
   * and would have won nothing.
   */
  readonly family: string;
  readonly kind: WebFontKind;
  /** Absolute path on Tidemarks' own origin. Never a third party — see ADR-0014. */
  readonly path: string;
}

/**
 * The faces, one file per kind.
 *
 * Each is the **variable** build, whose wght axis is drawn continuously rather than at two
 * fixed stops — and it is the cheaper of the two shapes, which is the reverse of what
 * `measurements.md` concluded when it compared the uncompressed files. Two static faces each
 * carry a full set of outlines and compress separately (68% of the OTF); one variable face
 * carries one set plus the deltas between the masters, and those compress to 34–42%. Over
 * the wire the serif is 18.83 MB against 32.93, the sans 12.86 against 22.46.
 *
 * What it costs is the half-arrived state. Regular used to be fetched before Bold so that a
 * reader was already reading in the right face while the headings caught up; there is one
 * file now, so nothing applies until all of it has. Against the serif's old 15.94 MB before
 * the first paragraph changed face, this is 18.83 — 18% longer to start, 43% shorter to
 * finish.
 *
 * Synthesised bold is still what this is all for. The browser outlining a Regular varies
 * 14–18% in ink coverage across the three engines against a drawn weight's 1–2%
 * (docs/specs/cjk-web-font/measurements.md), and "the same face on every machine" is the
 * whole of ADR-0014.
 */
export const WEB_FONTS: readonly WebFont[] = [
  {
    family: "Noto Serif CJK TC",
    kind: "serif",
    path: "/fonts/NotoSerifCJKtc-VF.woff2",
  },
  {
    family: "Noto Sans CJK TC",
    kind: "sans",
    path: "/fonts/NotoSansCJKtc-VF.woff2",
  },
];

/** How a stored copy is looked up: one file per family, and the family is the whole of it. */
export function webFontKey(font: WebFont): string {
  return font.family;
}

/** The two weights a reader's chosen face is drawn at. */
export interface ReadingWeights {
  readonly normal: number;
  readonly bold: number;
}

/**
 * The two weights each face is pinned to when the reader has picked it.
 *
 * Measured as ink coverage over stroke-dense glyphs at 48px, these lift the ratio between
 * body and bold from 1.37× to 1.56× for the serif and from 1.42× to 1.74× for the sans
 * (docs/specs/cjk-web-font/measurements.md). **The asymmetry is deliberate**: the sans has
 * even strokes and separates at 600, while the serif's stroke contrast and small counters
 * need 800 before the difference reads at a glance.
 *
 * The body weight carries most of that gain, and more so for the sans — Noto Sans CJK's axis
 * steps hard between 300 and 400 (12.87% to 17.35%), so dropping the body a stop takes out
 * more ink than raising the bold one does.
 */
export const READING_WEIGHTS: Record<WebFontKind, ReadingWeights> = {
  sans: { normal: 300, bold: 600 },
  serif: { normal: 300, bold: 800 },
};

/**
 * Where a book's own numeric weight starts counting as bold.
 *
 * The same boundary the two static faces were declared around, and it is safe for the same
 * measured reason: **no book puts 500 on its body text.** Over 34 commercially circulating
 * Chinese books, 10 declare a weight between 400 and 700 and every one of them hangs it on a
 * named class (`.bold`, `span.emph`, `.tips`, `p.img_text`), never on `body`, a bare `p` or
 * `*` (docs/specs/cjk-web-font/measurements.md).
 */
export const BOLD_BOUNDARY = 500;

const AXIS: Record<WebFontKind, string> = { sans: "100 900", serif: "200 900" };

/**
 * The whole wght axis a carried file actually draws, as a `font-weight` descriptor.
 *
 * Noto Serif CJK's starts at 200 and Noto Sans CJK's at 100. Declaring more than the file
 * holds would be clamped to the file's own range anyway, so the harm is not in the rendering
 * — it is that the declaration would be a claim about the bytes that is not true.
 */
export function weightAxis(kind: WebFontKind): string {
  return AXIS[kind];
}

/**
 * The `font-weight` descriptors to declare the carried face under — one `@font-face` each.
 *
 * With `quantise` the face is pinned to the reader's two weights, and **each descriptor is a
 * single value rather than a range**. That is what does the pinning: a variable font's wght
 * axis is clamped to the descriptor's range (CSS Fonts 4 §4.6), so a range that contains the
 * requested weight passes it through untouched. Declared `800 900`, a book's `font-weight:
 * 900` would draw at 900 and the two-weight rule would break in its topmost cell. Measured on
 * all three engines.
 *
 * Without it — the reader kept the book's own fonts — the face answers for the whole axis and
 * draws whatever the book asked for, which is the setting's entire meaning.
 *
 * **One value is out of reach of any descriptor, and `frondSettings` closes it** by asking
 * frond to restate the book's own weights (its `quantise-font-weight`, where the gap is
 * written down).
 */
export function faceWeightDescriptors(kind: WebFontKind, quantise: boolean): readonly string[] {
  if (!quantise) return [weightAxis(kind)];
  const { normal, bold } = READING_WEIGHTS[kind];
  return [`${normal} ${normal}`, `${bold} ${bold}`];
}

/**
 * Stored keys that belong to no face this build ships, so the caller can delete them.
 *
 * This used to be something to **ignore**: an unrecognised key said nothing about today's
 * faces, and the bytes behind it were an older build's business. Moving to one variable file
 * per kind changes that from a hypothetical to a certainty — every device that ever picked a
 * face holds two static faces under `family/weight` keys, 22 MB for the sans and 33 for the
 * serif, that nothing will ever read again. That is the reader's own storage, which is not
 * covered by ADR-0004's "the data can be thrown away".
 *
 * **The rule is general rather than a list of the two old keys**, so that it needs no editing
 * the next time a face is replaced. The cost is that rolling a reader back to an older build
 * makes them fetch again — which is the same cost as never having deleted anything, paid by
 * the far smaller group who roll back rather than by everyone who does not.
 */
export function staleFontKeys(storedKeys: readonly string[]): readonly string[] {
  const shipped = new Set(WEB_FONTS.map(webFontKey));
  return storedKeys.filter((key) => !shipped.has(key));
}

/**
 * Which faces to fetch for the font the reader picked.
 *
 * Only what is needed right now — a reader who never picks [[Sans]] never pays for it. Switching
 * the setting later fetches the other one then, which is the same code path as opening the
 * first book.
 *
 * **`'publisher'` fetches the serif face.** That setting leaves the book's own `font-family`
 * declarations standing, so what spine supplies is only the generic families the book
 * delegated — and a book that names no face delegates to `serif` far more often than to
 * `sans-serif`. Fetching both would double the cost to cover the rarer half.
 */
export function webFontsFor(choice: FontChoice): readonly WebFont[] {
  const kind: WebFontKind = choice === "sans" ? "sans" : "serif";
  return WEB_FONTS.filter((font) => font.kind === kind);
}

/**
 * Which carried faces this device already holds, from the keys a store hands back.
 *
 * One file answers for every weight, so a kind is carried or it is not — there is no longer a
 * half-held state where the body text is our face and the headings are the browser's
 * outlining of it. A key this build does not ship counts for nothing, which now includes the
 * two static faces every earlier device holds; `staleFontKeys` is what clears them out.
 */
export function carriedFontKinds(storedKeys: readonly string[]): Record<WebFontKind, boolean> {
  const stored = new Set(storedKeys);
  const carried = (kind: WebFontKind) =>
    WEB_FONTS.filter((font) => font.kind === kind).every((font) => stored.has(webFontKey(font)));
  return { serif: carried("serif"), sans: carried("sans") };
}

/**
 * The OpenType language system the faces should be shaped with, handed to frond as
 * `settings.fontLanguage` and emitted as `font-language-override`.
 *
 * A pan-CJK face carries the full CJK glyph set once and switches between the regional forms
 * on `locl` — 直, 骨, 令 and 迫 are drawn differently for ZHT and ZHS out of the same file.
 * What normally triggers that is the book's `lang`, and books get it wrong: `lang="zh"` is
 * extremely common and all three engines shape it as Simplified, so a Traditional book
 * declaring it comes out in Simplified glyphs. spine counted the characters
 * (`chinese.ts`'s `detectVariant`) and knows better than the declaration does.
 *
 * These are OpenType tags, **not** BCP 47 — `ZHT`, not `zh-Hant`.
 */
export function fontLanguageFor(simplified: boolean): string {
  return simplified ? "ZHS" : "ZHT";
}

const HAN = /[\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{f900}-\u{faff}\u{20000}-\u{2fa1f}]/u;
// Kana and hangul \u2014 what says a book is **not** Chinese. Han alone cannot say it is:
// Japanese prose is full of Han, and a great deal of it is the very same code points.
const KANA_OR_HANGUL = /[\u{3040}-\u{30ff}\u{ac00}-\u{d7af}]/u;

/**
 * How many characters of a kind before they count as what the book is written in.
 *
 * Absolute rather than a proportion, because the populations are two orders of magnitude
 * apart and nothing sits in between: `sampleText` reads 5000 characters, of which a Chinese
 * book gives thousands of Han and a Japanese one thousands of kana, while a book quoting a
 * name or a term in either gives a handful. Any number in that gap separates them, so the
 * one chosen only has to be obviously above "quoted in passing".
 *
 * A proportion would have been the fragile choice \u2014 a book opening with a title page and a
 * few lines of front matter has a short sample, and a ratio taken over it swings on a
 * handful of characters.
 *
 * One number for both counts, because it is the same question asked twice.
 */
const THRESHOLD = 100;

/**
 * Whether this book is worth fetching a CJK face for, counted from its own text.
 *
 * Two counts, and **both matter**. Han says the book might be Chinese; kana or hangul says
 * it is not. spine carries the Traditional Chinese build and tells it to shape with `ZHT` or
 * `ZHS` (`fontLanguageFor`), so handing that to a Japanese book would draw its Han in the
 * Chinese forms \u2014 a difference a Japanese reader sees at a glance. Under Han unification the
 * code points are shared, so counting Han alone would call every Japanese book a Chinese
 * one. Those books keep the platform's own face, which is where they already were (#55).
 *
 * **This is not `detectScript`, and merging the two would be a bug.** That one answers "how
 * wide is a character in this book" to set the line length, and when it counts nothing it
 * answers `'cjk'` \u2014 the safe default there, since a line that is too short costs a reader
 * almost nothing. Here the safe default runs the other way: counting nothing must not start
 * a 16 MB download in the background of a reader's phone. Same sample, opposite failure,
 * two functions.
 */
export function needsWebFont(sample: string): boolean {
  let han = 0;
  let other = 0;

  for (const ch of sample) {
    if (KANA_OR_HANGUL.test(ch)) {
      if (++other >= THRESHOLD) return false;
    } else if (HAN.test(ch)) {
      han++;
    }
  }

  return han >= THRESHOLD;
}
