import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { getConfig } from "@lingui/conf";

import { VitePWA } from "vite-plugin-pwa";
import { workerNavigationDenylist } from "./src/lib/worker-paths.ts";
// Loaded from a spelled-out path rather than discovered, because discovery starts at the
// working directory — and `npm test` starts at the repository root, where there is no Lingui
// config and the error says only "No Lingui config found". Handing the resolved config to the
// macro plugin as well means nothing downstream goes looking for it either.
const linguiConfigPath = fileURLToPath(new URL("./lingui.config.ts", import.meta.url));
const linguiConfig = getConfig({ configPath: linguiConfigPath });

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
    babel({
      presets: [linguiTransformerBabelPreset({ linguiConfig }, { configPath: linguiConfigPath })],
    }),
    VitePWA({
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
        // `--surface-page` in the dark theme, spelled out: a manifest is read before any CSS
        // is, so this is the one place a token has to be a literal.
        background_color: "#1a1815",
        theme_color: "#1a1815",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
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
