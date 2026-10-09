import { defineConfig } from "@playwright/test";

// Page turns under load, measured rather than tested (issue #261). See the header of
// `tests/perf/turn-load.spec.ts` for what it measures and why nothing asserts on a number.
//
// A configuration of its own, for the reason the screen sweep has one: a project inside
// `playwright.config.ts` would be caught by `test-in-container.sh`'s `--project=<engine>` filter
// and run with the test suite, and this takes minutes.
//
// The port is this file's own, so a test or sweep server already up is never quietly reused.
const PORT = 5176;

export default defineConfig({
  testDir: "./tests/perf",

  // One test per direction and CPU rate, each about forty runs of a dozen page turns.
  timeout: 30 * 60_000,

  // A retry would double the run to say nothing new: there is no assertion to be flaky.
  retries: 0,

  reporter: [["list"]],

  // One at a time. Two runs sharing the machine would each be measuring the other.
  workers: 1,

  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // The layout the issue asks for: a laptop screen, where a horizontal book gets two columns.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    // Pinned for the same reason `playwright.config.ts` pins it.
    locale: "en",
  },

  // The production build, as the test suite runs: a development build carries React's own
  // checks and StrictMode's double effects, and timing those would be timing the wrong app.
  webServer: {
    command: `npm run build && npm run preview -w app -- --port ${PORT} --strictPort`,
    cwd: "../..",
    env: { TIDEMARKS_NO_SW: "1" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
