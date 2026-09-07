// The site's dictionary. English is the source, as it is in the app (ADR-0031) — the difference
// is that these strings live in TypeScript rather than in a `.po` catalog, because this site has
// its own routing (`astro.config.mjs`) and lingui's macros need a Babel pass that Astro's build
// does not run.
//
// **Only the chrome is in here so far**, and only English: the pages themselves are English-only
// for now, so a second locale would be a dictionary with nothing to say. What this file buys
// today is the shape — a translated page reads its strings from here rather than from the markup,
// so adding zh-TW is adding a key set, not moving every string first.

export const DEFAULT_LOCALE = "en";

export const LOCALES = ["en", "zh-TW", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

export const ui = {
  en: {
    "nav.home": "Tidemarks",
    "nav.pricing": "Pricing",
    "nav.terms": "Terms",
    "nav.refunds": "Refunds",
    "nav.privacy": "Privacy",
    "footer.app": "Open the reader",
    "footer.source": "Source on GitHub",
  },
} as const satisfies Partial<Record<Locale, Record<string, string>>>;

export type UiKey = keyof (typeof ui)[typeof DEFAULT_LOCALE];

/**
 * The string for a key, falling back to English.
 *
 * The fallback is silent on purpose: a half-translated site should show the English sentence
 * rather than the key, because a reader who hits a gap is better served by a language they may
 * not read than by `nav.refunds`.
 */
export function t(key: UiKey, locale: Locale = DEFAULT_LOCALE): string {
  const table: Record<string, string> = ui[locale as keyof typeof ui] ?? ui[DEFAULT_LOCALE];
  return table[key] ?? ui[DEFAULT_LOCALE][key];
}
