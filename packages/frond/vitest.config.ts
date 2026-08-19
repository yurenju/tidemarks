import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Named, because the root config collects every package's projects into one run and the
    // name is how one suite is asked for on its own (`vitest run --project frond`).
    name: "frond",
    // Only tests/node. ADR-0009 splits the tests across two runners: EpubBook and the pure
    // TypeScript code around it run under Vitest in Node, and Renderer runs under Playwright
    // in browsers. Were include to point at tests/ generally, the browser half's specs would
    // be swept up by Vitest and fail in a Node environment with no browser.
    include: ["tests/node/**/*.test.ts"],
  },
});
