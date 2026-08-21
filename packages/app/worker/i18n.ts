/**
 * The Worker's side of the catalogs: one language per request, chosen by `Accept-Language`.
 *
 * ⚠️ **Messages here name themselves, and that is not a style choice.** Everywhere in `src/`
 * a message is written with a Lingui macro and its English text becomes its id. wrangler
 * bundles the Worker with esbuild, which runs no Babel, so a macro anywhere the Worker can
 * reach throws at runtime — "the macro you imported is being executed outside the context of
 * compilation". The Worker therefore writes message descriptors by hand, with an explicit `id`,
 * and `lingui extract` reads them out of `i18n._()` calls just the same.
 *
 * The consequence worth knowing: **changing the English of one of these does not change its
 * id**, so the translations do not fall out of date on their own the way the app's do. When you
 * edit the English here, edit the other two locales in the same commit.
 *
 * Ids read `email.magicCode.subject` — the surface, then what it is. They are never shown to a
 * reader; they exist so two identical English strings in two different letters stay two
 * entries.
 *
 * ⚠️ **The `.mjs` on the catalog imports below is load-bearing.** `lingui compile` writes
 * `.mjs` under `compileNamespace: "es"`, and esbuild — the same bundler as the paragraph above
 * — only tries `.tsx .ts .jsx .js .css .json` for an extensionless specifier. Vite tries `.mjs`
 * too, so dropping the extension type-checks, passes every test and builds the PWA, then fails
 * at `wrangler deploy` with "Could not resolve ../src/locales/en" — after the migrations have
 * already been applied. Spell the extension out.
 */

import { I18n } from "@lingui/core";
import { matchLocale, parseAcceptLanguage, type Locale } from "../src/lib/locale";
import { messages as en } from "../src/locales/en.mjs";
import { messages as ja } from "../src/locales/ja.mjs";
import { messages as zhTW } from "../src/locales/zh-TW.mjs";

const CATALOGS = { en, ja, "zh-TW": zhTW };

/**
 * The language this request should be answered in.
 *
 * `Accept-Language` covers both kinds of caller with one mechanism: the app sets the header
 * from the reader's chosen interface language on every request it makes (`src/lib/api.ts`), and
 * a browser arriving at the consent page sets its own. A field in the request body would have
 * served only the first kind.
 *
 * ⚠️ This is a **request-scoped** answer. A Worker isolate serves many readers, so activating a
 * shared instance would let one reader's language leak into the next reader's reply. Hence a
 * new `I18n` per request rather than a module-level one.
 */
export function i18nFor(request: Request): I18n {
  return i18nOf(matchLocale(parseAcceptLanguage(request.headers.get("accept-language"))));
}

export function i18nOf(locale: Locale): I18n {
  return new I18n({ locale, messages: { [locale]: CATALOGS[locale] } });
}
