/**
 * The app's copy of Lingui, loaded and pointed at one language.
 *
 * **All three catalogs are bundled, not fetched.** The usual arrangement loads a catalog on
 * demand, which buys a smaller first download at the cost of an asynchronous boot — and the
 * screen that boot paints is the shelf, in whichever language arrives second. Three catalogs
 * of a couple of hundred short messages are a few kilobytes next to a 90 KB typeface, so
 * paying that once removes a whole class of "the interface flickered into Chinese" and lets
 * every caller treat translation as a plain synchronous function.
 *
 * The Worker has its own copy of this arrangement (`worker/i18n.ts`) rather than importing
 * this one: it activates a language per request, and this module holds one for a session.
 *
 * The `.mjs` on the imports below is what the Worker's bundler needs; Vite would resolve them
 * without it. They are written the same way on both sides so that neither reads as the odd one
 * — the reason is in `worker/i18n.ts`.
 */

import { i18n } from "@lingui/core";
import { messages as en } from "../locales/en.mjs";
import { messages as ja } from "../locales/ja.mjs";
import { messages as zhTW } from "../locales/zh-TW.mjs";
import type { Locale } from "./locale";

i18n.load({ en, ja, "zh-TW": zhTW });

/**
 * Switch the interface to `locale`, and tell the document it happened.
 *
 * **`lang` is not decoration here, it picks the glyphs.** The CJK face Tidemarks carries is a
 * pan-CJK build holding all five regional variants of the shared Han characters, selected by
 * the OpenType `locl` feature — and what an engine feeds `locl` is the language of the
 * content. Leave `lang` at `en` and a Japanese interface is drawn with Chinese character
 * forms, which a Japanese reader sees at a glance. The book gets the same treatment one layer
 * down, where frond is handed a `fontLanguage` for the book's own variant (`settings.ts`);
 * this is that same fact applied to Tidemarks' own words.
 */
export function activateLocale(locale: Locale) {
  i18n.activate(locale);
  document.documentElement.lang = locale;
}

export { i18n };
