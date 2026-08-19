import { defineConfig, devices } from "@playwright/test";

// The screen sweep: one pass over every screen the app has, each one captured as a PNG.
//
// **This is not a test**, and that is why it has a configuration of its own rather than a
// fourth project inside `playwright.config.ts`. `scripts/test-in-container.sh` filters that
// suite with `--project=<engine>`, so a sweep project sitting beside chromium, firefox and
// webkit would be caught by the filter and run as part of the tests — three times over, once
// per engine, producing three copies of the same pictures.
//
// What the images are for, and what CI does with this file, is docs/adr/0027.
//
// The port is this file's own. Nothing stops the two suites from sharing 5174, but a developer
// with the test suite's server already up would then have a sweep quietly reusing it — and
// `reuseExistingServer` cannot tell a stale server from a fresh one.
const PORT = 5175;

export default defineConfig({
  testDir: "./tests/sweep",

  // One test per device, and each is 27 screens of clicking. The suite's per-test default of
  // 30s is written for tests that assert one thing.
  timeout: 10 * 60_000,

  // **Where this parts company with the test suite.** That one now runs `retries: 1` with
  // `failOnFlakyTests`, which costs seconds and buys the name of the unstable spec
  // (docs/agents/flaky.md). Here a retry is ten more minutes — the timeout above is the scale of
  // one — to confirm something the sweep never needed a retry to answer: whether these 27 steps
  // still walk. Flakiness here means the sweep is on its way to being ignored, and that shows up
  // just as well without one.
  retries: 0,

  reporter: [["list"]],

  // The two devices run one after the other rather than side by side. They are independent —
  // separate contexts, separate storage — so this costs about 30 seconds of wall clock. What it
  // buys is that neither run is competing with the other for the one Vite server and the one
  // machine: several waits in the sweep are for animations to finish, and an animation on a busy
  // machine is where a false red would come from.
  workers: 1,

  use: {
    baseURL: `http://localhost:${PORT}`,

    // **Load-bearing, and the whole "collect the failures and carry on" design rests on it.**
    // Playwright's default for both is 0, meaning an action waits for as long as the test has
    // left — so one click on something that never appears does not fail that step, it eats the
    // remaining nine minutes and takes every step after it down with the timed-out test. That
    // is exactly what the first run of this sweep did. A bounded action turns the same mistake
    // into one red step out of 27, which is what the sweep is for.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // **Both sizes are picked so the model reading these images does not have to resample them.**
  // The screenshots are for discussing visual design with an assistant, and an assistant scales
  // anything whose long edge is over about 1568px — which is exactly the step that would take
  // away the hairlines and the small type the discussion is about.
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        // A laptop, and 1440 is already under the ceiling at scale 1.
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile",
      use: {
        // Pixel 10's own scale is 3, which puts 360×732 out at 1080×2196 — the long edge the
        // previous sweep had resampled down to 2000. Halving the scale keeps the CSS viewport,
        // and with it every breakpoint and every line break, and lands at 720×1464.
        ...devices["Pixel 10"],
        deviceScaleFactor: 2,
      },
    },
  ],

  // The root's `dev` rather than this package's: the root builds frond first. Inside the image
  // that is already done, but on a fresh checkout the difference is between sweeping the
  // renderer in the tree and sweeping whatever `packages/frond/dist` happened to hold.
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
