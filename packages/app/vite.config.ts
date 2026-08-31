import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { workerNavigationDenylist } from "./src/lib/worker-paths.ts";
import { linguiMacros } from "./lingui-babel.ts";

// The build stamp the app shows (`src/lib/version.ts`). Read here rather than at runtime
// because the service worker can be serving a bundle older than the one on the server, and
// only a value baked into that bundle describes the code actually running.
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a checkout — a tarball, or the test image, which copies sources without .git. The UI
    // says "dev build" rather than printing a hash that would be a guess.
    return "";
  }
}

const build = {
  commit: git("rev-parse", "--short", "HEAD"),
  dirty: git("status", "--porcelain") !== "",
  builtAt: new Date().toISOString(),
};

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [
    react(),
    // Lingui's macros, which are the whole point of writing `t` and `<Trans>` rather than
    // catalog lookups: they leave the English in the code where it is read and reviewed, and
    // turn it into a message id at build time. The preset filters itself down to files that
    // import a macro, so this is not a Babel pass over the whole tree.
    //
    // The Worker cannot have this — wrangler bundles it with esbuild and there is no Babel in
    // that path — so it names its messages explicitly instead (`worker/i18n.ts`).
    linguiMacros(),
    VitePWA({
      // **Off for the server the browser suite runs against** (`playwright.config.ts` sets
      // this), and for nothing else. That suite used to be pointed at the dev server, where a
      // service worker never registers at all; it is pointed at a real build now, where one
      // does — and a service worker answering the app shell from its cache is state carried
      // between specs, which is the shape flakiness takes when it has nothing to do with the
      // code. Every spec starts from an empty profile, so each would also pay for installing
      // one.
      //
      // The screen sweep is deliberately not given this: it still runs the dev server
      // (`playwright.sweep.config.ts`), which is what keeps `npm run dev` exercised in CI.
      disable: process.env.TIDEMARKS_NO_SW === "1",
      registerType: "autoUpdate",
      // app shell only: books and data live in Dexie, not the SW cache
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        // The interface's own Latin face, and only it. `woff2` is not in the patterns above
        // because the CJK faces beside it are 58 MB and belong to IndexedDB instead
        // (`lib/web-font-store.ts`); these two are 90 KB and are the chrome, so an offline
        // open should draw in them rather than falling back to the platform's serif.
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/source-serif-4-.*\.woff2$/,
            handler: "CacheFirst",
            options: { cacheName: "ui-font", expiration: { maxEntries: 4 } },
          },
        ],
        // Everything the Worker owns, or the service worker answers a navigation to it from
        // the cache with index.html and the request never reaches the network. That is not a
        // slow failure — the Worker is simply never asked (`lib/worker-paths.ts`).
        navigateFallbackDenylist: workerNavigationDenylist(),
      },
      manifest: {
        name: "Tidemarks",
        short_name: "Tidemarks",
        description: "epub reader with cross-device sync",
        display: "standalone",
        // The light theme's `--surface-page`, spelled out: a manifest is read before any CSS
        // is, so this is the one place a token has to be a literal. It is the light value and
        // not the dark one because both icons below are painted on that same paper — a splash
        // screen in night colours would frame them in a rectangle of the wrong century.
        background_color: "#f4eee2",
        theme_color: "#f4eee2",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          // Android crops a maskable icon to whatever shape the launcher uses, so this one is
          // a separate drawing: square, full-bleed, and with the mark inside the 80% safe
          // circle. Feeding it the SVG above would let a round mask cut the waves off.
          { src: "maskable-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5001,
    // Always strict, never Vite's "port taken, take the next one". The API sits on the very
    // next port, so drifting upward lands the app on top of it and the proxy below then talks
    // to itself. Refusing to start says which port is occupied; drifting says nothing until
    // every request to /api comes back as the React app.
    strictPort: true,
    // dev: API served by `wrangler dev` on 5002 (wrangler.jsonc sets that port)
    proxy: {
      "/api": "http://localhost:5002",
      "/auth": "http://localhost:5002",
    },
  },
});
