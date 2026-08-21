import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

/**
 * The interface's own words, in three languages.
 *
 * **English is the source**, which is what makes the code and its comments one language
 * (CLAUDE.md, 〈程式碼用英文，文件用中文〉). The Traditional Chinese that used to be written
 * straight into the JSX is now a catalog entry, carried over word for word rather than
 * retranslated — see ADR-0031 for what that trade costs and buys.
 *
 * `zh-TW` and `ja` are equal citizens: a message missing from either fails the build. Nobody
 * here can proofread the Japanese, so falling back to English for it would have meant a
 * language that is quietly half-finished forever, and no one looking at the list.
 */
export default defineConfig({
  locales: ["en", "zh-TW", "ja"],
  sourceLocale: "en",

  // No fallbacks. A missing translation is a hole to fill, not a hole to paper over — and
  // `--strict` only has something to fail on if nothing quietly fills it first.
  fallbackLocales: false,

  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      // Both halves of the app: the PWA's chrome and the mail the Worker sends. They are one
      // set of catalogs because they are one product's voice — a reader who set the interface
      // to Japanese should not get a Chinese login mail.
      include: ["<rootDir>/src", "<rootDir>/worker"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/node_modules/**"],
    },
  ],

  // PO, for `msgctxt`. The whole reason this project needed a framework rather than a JSON
  // file of its own is that two identical English strings sometimes have to become two
  // different Chinese ones, and `msgctxt` is the field that splits them (GNU gettext has
  // spelled it that way since 0.15).
  //
  // `lineNumbers: false` because the alternative is a catalog that churns on every edit above
  // a message: moving one line of JSX would rewrite a hundred `#:` comments and bury the
  // change that mattered.
  format: formatter({ lineNumbers: false, explicitIdAsDefault: false }),

  // Alphabetical by message, so a diff of a catalog reads as "these entries changed" rather
  // than "everything moved".
  orderBy: "message",

  // ES modules, because both things that read a compiled catalog are ESM: the app's bundle and
  // the Worker's. The default is CommonJS, which `"type": "module"` in this package's manifest
  // would then have to be talked out of.
  compileNamespace: "es",
});
