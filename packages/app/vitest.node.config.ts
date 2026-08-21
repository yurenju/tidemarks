import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import babel from "@rolldown/plugin-babel";
import { linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { getConfig } from "@lingui/conf";

// Loaded from a spelled-out path rather than discovered, because discovery starts at the
// working directory — and `npm test` starts at the repository root, where there is no Lingui
// config and the error says only "No Lingui config found". Handing the resolved config to the
// macro plugin as well means nothing downstream goes looking for it either.
const linguiConfigPath = fileURLToPath(new URL("./lingui.config.ts", import.meta.url));
const linguiConfig = getConfig({ configPath: linguiConfigPath });

// The app's decision modules, in Node. Direction inversion, TOC flattening, highlight
// clipping, the settings mapping, the MCP tools against a fake shelf. None of them need a
// browser or a server, and they run in under a second.
//
// One of the projects the root `vitest.config.ts` collects; the expensive half of this
// package's Vitest coverage is next door in `vitest.worker.config.ts`.
//
// **`include` has to be explicit.** Vitest's default pattern matches every `*.spec.ts` in the
// tree, so without this it sweeps up `tests/browser/` and each spec fails on
// `test.describe() was not expected to be called here` — a confusing error a long way from its
// cause. That is not hypothetical; it happened on the first run after the browser suite landed.
export default defineConfig({
  // The same macro transform the app is built with (`vite.config.ts`). Without it a module
  // that writes `msg({...})` fails to import at all, with an error about `babel-plugin-macros`
  // that says nothing about which of these two configs is missing a plugin.
  plugins: [
    babel({
      presets: [linguiTransformerBabelPreset({ linguiConfig }, { configPath: linguiConfigPath })],
    }),
  ],
  test: {
    name: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["**/*.integration.test.ts"],
  },
});
