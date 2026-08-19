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
  /** The CSS weight, which is also half the key a stored copy is looked up by. */
  readonly weight: 400 | 700;
  /** Absolute path on spine's own origin. Never a third party — see ADR-0014. */
  readonly path: string;
}

/**
 * The faces, in the order they are fetched — **Regular before Bold** within each kind,
 * because Regular is the body text and Bold is the headings and the emphasis inside it. A
 * reader who has the first one is already reading in the right face; the second one arrives
 * and the headings redraw.
 *
 * Both kinds carry a real Bold. Synthesised bold — the browser outlining the Regular — is
 * what the goal of "the same face on every machine" fails on: measured coverage over
 * stroke-dense glyphs at 48px (docs/specs/cjk-web-font/measurements.md) varies 14–18% across
 * the three engines against a drawn Bold's 1–2%. The serif is the worse of the two (its
 * counters fill in and the character turns to mush; +25–27% over the drawn face against the
 * sans's +10%), which is why it was carried first — but a heading is a heading in either
 * face, so both get the real weight.
 */
export const WEB_FONTS: readonly WebFont[] = [
  {
    family: "Noto Serif CJK TC",
    kind: "serif",
    weight: 400,
    path: "/fonts/NotoSerifCJKtc-Regular.woff2",
  },
  {
    family: "Noto Serif CJK TC",
    kind: "serif",
    weight: 700,
    path: "/fonts/NotoSerifCJKtc-Bold.woff2",
  },
  {
    family: "Noto Sans CJK TC",
    kind: "sans",
    weight: 400,
    path: "/fonts/NotoSansCJKtc-Regular.woff2",
  },
  {
    family: "Noto Sans CJK TC",
    kind: "sans",
    weight: 700,
    path: "/fonts/NotoSansCJKtc-Bold.woff2",
  },
];

/** How a stored copy is looked up: one face is a family at a weight, nothing else. */
export function webFontKey(font: WebFont): string {
  return `${font.family}/${font.weight}`;
}

/**
 * The range of weights a carried face answers to, which is wider than the weight it was drawn
 * at: Regular takes everything up to 400, Bold everything from 500 up.
 *
 * **The interesting half is the 500.** CSS matches a weight the family does not hold by
 * searching outwards, and for 500 it looks *down* before it looks up — so with faces declared
 * at 400 and 700 alone, a book's `font-weight: 500` lands on the same Regular as its body
 * text and draws identically. That is not a rare shape in Chinese books: there is no italic
 * to emphasise with, so emphasis is a heavier face, a different family, or both. FIRE．致富
 * 實踐 marks 「另一本」with `.sans { font-family: sans-serif; font-weight: 500 }`, and once the
 * reader picks 黑體 or 明體 the family half is overridden by their choice (frond's
 * `readerStylesheet`) — leaving the 500, which without this range resolves to Regular and
 * leaves the emphasis invisible.
 *
 * Moving the boundary to 500 is safe because **no book puts 500 on its body text**: over 34
 * commercially circulating Chinese books, 10 declare a weight between 400 and 700 and every
 * one of them hangs it on a named class (`.bold`, `span.emph`, `.tips`, `p.img_text`,
 * `div.example0 li`), never on `body`, a bare `p` or `*`. Nine of the ten put under 1.4% of
 * their text in those classes (docs/specs/cjk-web-font/measurements.md).
 *
 * 600 needs nothing from this: CSS searches upwards from 600, so it already found the Bold.
 */
export function weightRange(weight: number): string {
  return weight >= 700 ? "500 900" : "100 400";
}

/**
 * Which faces to fetch for the font the reader picked.
 *
 * Only what is needed right now — a reader who never picks 黑體 never pays for it. Switching
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
 * A kind counts only when **every** weight of it is here: a serif with no Bold still leaves
 * the headings to a synthesised weight, which is the thing carrying a face was for
 * (ADR-0014). Keys naming a face this build no longer ships are ignored rather than
 * flagged — an older copy left in the store says nothing about today's faces.
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
