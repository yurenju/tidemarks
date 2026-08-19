import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Only tests/browser. ADR-0009 splits the tests across two runners: EpubBook runs under
  // Vitest in Node, and Renderer runs under Playwright in browsers. Were testDir to point at
  // tests/ generally, the first Vitest spec added would be swept into all three browser
  // projects and run there.
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),

  // Spelled out because the default is not what `fullyParallel` above implies. Playwright drops
  // to a single worker under CI unless told otherwise, so this suite was running its 253 specs
  // one at a time on a machine with cores to spare — `fullyParallel` was true and had nothing to
  // parallelise over.
  //
  // A whole core per worker rather than the half Playwright uses off-CI. A CI runner is doing
  // nothing else, and what this suite spends its time on is a browser laying out text, which is
  // the browser's own CPU rather than this process's. Off-CI the default stays: that machine has
  // someone using it.
  //
  // Contention does not threaten what is measured here. frond's numbers are glyph geometry and
  // page boundaries — a function of the font and the viewport, not of how busy the machine is.
  workers: process.env.CI ? "100%" : undefined,

  // **As strict as `retries: 0` was, not one word looser.** This package's value lies in one set
  // of numbers being comparable across the three browsers, and `failOnFlakyTests` keeps that:
  // a run that only passed on its retry is a failing run, so nothing flaky is laundered into
  // green — flakiness is itself one of the things to catch.
  //
  // The retry is there to name it. Without one, Playwright never labels anything flaky, and
  // every flake arrives as an anonymous red run. See docs/agents/flaky.md.
  retries: 1,
  failOnFlakyTests: true,

  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        // The report goes to the root of the monorepo, under this package's name: every
        // package runs its own Playwright, and CI collects one artifact. For it to be
        // retrievable, the container running the tests has to mount that directory out — see
        // the root's scripts/test-in-container.sh.
        ["html", { outputFolder: "../../playwright-report/frond", open: "never" }],
      ]
    : [["list"]],

  use: {
    // A fixed viewport and device scale factor. The pagination geometry is a function of
    // these two values, and letting them float would make the cross-browser comparison
    // measure environmental differences rather than frond's behaviour.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },

  // All three are equals, with no tiers (ADR-0004). Any one red means red.
  // The devices[...] presets are deliberately not used: they carry their own viewport and
  // deviceScaleFactor, which would override the values deliberately fixed above.
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
