// @ts-check
import { defineConfig } from "astro/config";

// tidemarks.io — the pages a reader can see before they have an account, and the ones Paddle's
// domain review asks for. The reader's app is a separate deployment on app.tidemarks.io; nothing
// here talks to it.
export default defineConfig({
  site: "https://tidemarks.io",

  // English carries no prefix, so /legal/terms is the address that goes to Paddle and into the
  // app's account pane. The other two locales are declared but have no pages yet: the routing
  // decision is made now because changing it later would move URLs that have already been
  // submitted for review. See src/i18n/ui.ts for the dictionary.
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-TW", "ja"],
    routing: { prefixDefaultLocale: false },
  },

  // Every page becomes a directory with an index.html, so /legal/terms is the address rather
  // than /legal/terms.html. `scripts/check-links.ts` resolves links against that shape.
  build: { format: "directory" },
});
