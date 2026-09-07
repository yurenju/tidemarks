// @ts-check
import { defineConfig } from "astro/config";

// ⚠️ **This package has no type check, and `astro check` is not the answer.** It was tried:
// `@astrojs/check` peer-depends on TypeScript 5/6, `app` and `frond` are on 7, and npm hoists the
// 7 to the root — where `@volar/kit` finds it and dies with "Cannot read properties of undefined
// (reading 'useCaseSensitiveFileNames')" before it checks a single file. Pinning a second
// TypeScript inside this package does not help, because the resolution that breaks happens at the
// root. So there is no tsconfig.json here either: one that nothing reads is worse than none.
//
// What that leaves unchecked is the `.astro` files, which are templates with almost no logic in
// them. `scripts/check-site-links.ts` is the one piece of real code, and it lives at the
// repository root precisely so that `tsconfig.scripts.json` covers it.

// tidemarks.io — the pages a reader can see before they have an account, and the ones Paddle's
// domain review asks for. The reader's app is a separate deployment on app.tidemarks.io; nothing
// here talks to it.
export default defineConfig({
  site: "https://tidemarks.io",

  // English carries no prefix, so /legal/terms is the address that goes to Paddle and into the
  // app's account pane, and a translated page will live at /zh-TW/legal/terms.
  //
  // ⚠️ **This block changes nothing today** — it is what Astro does anyway with no `i18n` at all.
  // It is here to make the choice explicit rather than accidental, because the alternative
  // (`prefixDefaultLocale: true`) would put /en/ in front of every address now being submitted for
  // a domain review, and that is not a thing to discover later. See src/i18n/ui.ts for the
  // dictionary, and CLAUDE.md on why a translated page is a `.md`.
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-TW", "ja"],
    routing: { prefixDefaultLocale: false },
  },

  // Every page becomes a directory with an index.html, so /legal/terms is the address rather
  // than /legal/terms.html. `scripts/check-links.ts` resolves links against that shape.
  build: { format: "directory" },
});
