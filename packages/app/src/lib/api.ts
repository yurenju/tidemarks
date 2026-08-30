/**
 * `fetch`, with the one header every request to the Worker has to carry.
 *
 * The Worker answers in a language, and the only thing it knows about the caller is the
 * request. `Accept-Language` is that channel: what a reader chose in [[Settings]] is stated on every
 * call, so a refusal or a sign-in letter comes back in the language the app around it is in.
 *
 * **The browser's own header is not enough**, which is the whole reason this exists. A reader
 * on an English phone who set Tidemarks to 繁體中文 would otherwise get English mail about a
 * Chinese app — the interface language is a choice, and the browser knows nothing about it.
 * Stating the chosen locale alone, rather than adding it to what the browser would send, is
 * deliberate for the same reason: it is an answer, not a preference to be weighed.
 *
 * A caller may still set `accept-language` itself and win, which is what the tests do.
 */

import { i18n } from "./i18n";

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept-language")) headers.set("accept-language", i18n.locale);
  return fetch(input, { ...init, headers });
}
