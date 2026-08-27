/**
 * Which language Tidemarks' own words are in — the interface language, and nothing else.
 *
 * **This is not the book's language.** What a book is written in is a fact frond states about
 * that book (CONTEXT.md, 〈書寫系統〉), and it decides the line-length ceiling, the font stack
 * and the glyph variant the book is drawn with. None of that moves when the reader changes the
 * language of the interface, and a Japanese reader reading a Traditional Chinese book gets
 * exactly that: a Japanese interface around a Chinese book.
 *
 * One per device, never synced — the same argument as the typography settings (ADR-0026). A
 * language is a fact about the machine in the reader's hand, not about the account behind it.
 */

export type Locale = "en" | "zh-TW" | "ja";

/**
 * The languages on offer, **each written in itself**.
 *
 * A reader who has landed in a language they cannot read is exactly the reader who needs this
 * control, and to them a list translated into that language says nothing. So these labels are
 * not messages and never go through the catalogs — the same reasoning that keeps 黑體 / 明體
 * out of them.
 */
export const LOCALES: readonly { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
];

/**
 * Where matching lands when the browser asks for nothing Tidemarks speaks.
 *
 * It is the source language, so this is also the one locale that cannot be missing a
 * translation — the messages in the code are already in it.
 */
export const DEFAULT_LOCALE: Locale = "en";

const STORAGE_KEY = "tidemarks-locale";

/**
 * A language tag as the primary subtag plus the rest, lowercased.
 *
 * Split rather than compared with `startsWith`, because `jam` (Jamaican Creole) starts with
 * `ja` and `enm` (Middle English) starts with `en`. Prefix matching would answer Japanese and
 * English for two languages Tidemarks has never heard of.
 */
function subtags(tag: string): { primary: string; rest: string } {
  const lower = tag.toLowerCase();
  const cut = lower.indexOf("-");
  return cut === -1
    ? { primary: lower, rest: "" }
    : { primary: lower.slice(0, cut), rest: lower.slice(cut + 1) };
}

/**
 * The interface language for a browser's ordered language preferences (`navigator.languages`).
 *
 * Walked in order and the first tag Tidemarks speaks wins, which is what the order in that
 * list means. Region is dropped for English and Japanese because Tidemarks has one catalog for
 * each; the interesting one is Chinese.
 *
 * **Every Chinese tag lands on `zh-TW`, Simplified included.** A Simplified reader given
 * Traditional gets characters in a variant they are not used to, and a Simplified reader given
 * English gets a language they may not read at all — the first is plainly the smaller cost.
 * Converting Traditional to Simplified would be a third answer, and a different decision: the
 * conversion table in `chinese.ts` exists for **books**, where the text is the author's and
 * Tidemarks only picks a font for it. Reaching over and rewriting the interface with it is not
 * the same act, so it is not done here.
 */
export function matchLocale(preferences: readonly string[]): Locale {
  for (const tag of preferences) {
    const { primary } = subtags(tag);
    if (primary === "ja") return "ja";
    if (primary === "zh") return "zh-TW";
    if (primary === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

/**
 * An `Accept-Language` header as an ordered preference list, ready for `matchLocale`.
 *
 * The Worker's only signal about what language to answer in. The app sets the header from the
 * interface language on every request it makes, and a browser navigating to the consent page
 * sets its own — one mechanism covering both, rather than a body field that only the first
 * kind of request could carry.
 *
 * Sorted by `q` rather than trusting the written order. Browsers write the list in preference
 * order already, so the two agree in practice; but `q` is what the specification says decides,
 * and anything at all may send this header.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];

  return (
    header
      .split(",")
      .map((part) => {
        const [tag, ...params] = part.split(";").map((piece) => piece.trim());
        const quality = params
          .map((param) => /^q=([\d.]+)$/.exec(param))
          .find((match) => match !== null);
        return { tag: tag ?? "", quality: quality ? Number(quality[1]) : 1 };
      })
      // The wildcard asks for nothing in particular, so there is nothing to match it against.
      .filter((entry) => entry.tag !== "" && entry.tag !== "*" && Number.isFinite(entry.quality))
      .sort((a, b) => b.quality - a.quality)
      .map((entry) => entry.tag)
  );
}

function validLocale(value: unknown): Locale | undefined {
  return LOCALES.some((locale) => locale.value === value) ? (value as Locale) : undefined;
}

/**
 * The language to open in: what the reader chose, or what their browser asked for.
 *
 * The stored value wins whenever there is one, because it is the only signal a person made on
 * purpose. Readers running an English system in Chinese — or the reverse — are common enough
 * that automatic detection alone would be wrong for a lot of people, and there would be no way
 * to say so.
 */
export function loadLocale(preferences: readonly string[]): Locale {
  try {
    return validLocale(localStorage.getItem(STORAGE_KEY)) ?? matchLocale(preferences);
  } catch {
    // Storage unavailable (private mode). Detection still works; the choice just will not last.
    return matchLocale(preferences);
  }
}

export function saveLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage unavailable (private mode); the choice just won't persist
  }
}

/**
 * What `navigator` is asking for, as a plain list.
 *
 * `languages` is the ordered preference list and `language` is only the top of it; older or
 * stripped-down engines have just the latter, and an empty list is a fine answer — matching
 * falls back to the source language.
 */
export function browserPreferences(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}
