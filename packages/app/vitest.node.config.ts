import { defineConfig } from "vitest/config";

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
  test: {
    name: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts"],
  },
});
