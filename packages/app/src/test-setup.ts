/**
 * The language every test starts in.
 *
 * English, because it is the source: the messages asserted in these files are the ones written
 * into the code beside them, so a failure reads as a difference in behaviour rather than as a
 * difference in translation. A test about a language-specific rule activates that language for
 * itself and says why.
 *
 * Without this, any module reaching for the shared `i18n` outside a component would throw on
 * first use with "call i18n.activate(locale) before using Lingui functions" — true, but a long
 * way from the test that tripped it.
 */

import { i18n } from "./lib/i18n";

i18n.activate("en");
