import { defineConfig } from "@playwright/test";

// The cross-browser half of spine's tests, ported from frond's configuration.
//
// Vitest covers the decision modules (`src/lib/*.test.ts`) in Node: direction inversion, TOC
// flattening, highlight clipping, the settings mapping. None of those need a browser, and
// they run in a quarter of a second.
//
// This runner covers what only a browser can answer: does the real app, driving frond, open a
// real book and behave. The split is the same cut frond's ADR-0009 makes, one layer up.
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),

  // Spelled out for the same reason as frond's, and read that one first: Playwright drops to a
  // single worker under CI unless told otherwise, which left `fullyParallel` with nothing to
  // parallelise over.
  //
  // This half has something at stake that frond's does not. `turn-pacing.spec.ts` measures frame
  // intervals, and frame intervals are a function of how busy the machine is. Its thresholds
  // were set for exactly this: taken across "running alone and running inside the full parallel
  // suite", and left about four times above the worst of them, so that a busy runner does not
  // turn it red. That headroom was written for a world with several browsers painting at once —
  // which, with one worker, had quietly stopped being the world it ran in. If it starts flaking,
  // the thresholds are the thing to look at, not this line: `retries: 0` below is deliberate and
  // a flaky pacing test is itself the finding.
  workers: process.env.CI ? "100%" : undefined,

  // **This is as strict as `retries: 0` was, not one word looser.** `failOnFlakyTests` makes a
  // run that only passed on its retry a failing run, so the rule frond and this suite have always
  // kept still holds: a flaky result is never laundered into green, because flakiness is itself
  // one of the things worth catching.
  //
  // What the retry buys is the name. With no retry at all, Playwright never labels anything
  // flaky — every flake is just a red run, and working out which spec it was means reading the
  // log by hand. One retry costs a few seconds and produces "this one is unstable" as a fact
  // that can be filed. See docs/agents/flaky.md for what to do with it.
  //
  // The screen sweep does not take this — `playwright.sweep.config.ts` stays at 0, because a
  // retry there is ten more minutes to confirm something it never needed a retry to answer.
  retries: 1,
  failOnFlakyTests: true,

  // The report goes to the repository root, under this package's name: every package runs its
  // own Playwright, and CI uploads one artifact. Written from here rather than collected
  // afterwards, because the path a reporter writes to is the only one it will ever use.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { outputFolder: "../../playwright-report/app", open: "never" }],
      ]
    : [["list"]],

  use: {
    baseURL: "http://localhost:5174",
    // **Kept for a failed attempt, thrown away for a passing one.** A flake nobody can reproduce
    // is diagnosed from what CI kept, and what CI kept was the error plus one accessibility
    // snapshot of whatever the failing locator pointed at. #109 is what that costs: a press on
    // Reset that left the settings untouched, where telling "the press never reached the button"
    // from "something wrote the old values back" needs the frames either side of it, and nothing
    // held them. A trace holds the action log and a DOM snapshot before and after every step.
    //
    // `retain-on-failure` rather than `on-first-retry`, because the attempt worth reading is the
    // first one: a red here opens an issue immediately (docs/agents/flaky.md) and the retry is
    // the attempt that often goes green. It costs a fifth of a run — the app's webkit suite is
    // 1.0m without and 1.2m with — paid on every run, green ones included.
    trace: "retain-on-failure",
    // Fixed, because pagination geometry is a function of the viewport: a floating size would
    // make the three browsers' numbers incomparable. Wider than frond's 800×600 so both
    // sidebars and the two-page spread have somewhere to be — this is an app, not a renderer.
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 1,
    // A book has to be imported before anything can be read, and importing goes through the
    // real file input.
    acceptDownloads: false,
    // **The interface language, pinned.** Tidemarks picks one from `navigator.languages`
    // (`src/lib/locale.ts`), so without this the words on screen would depend on the machine
    // the suite happens to be running on — and every selector below names a word. English
    // because it is the source language: what these specs look for is then the string written
    // in the component beside them, so a failure is a difference in behaviour rather than one
    // in translation. Same reasoning as `src/test-setup.ts` on the Vitest side.
    locale: "en",
  },

  // **A real build, served back, rather than the dev server** — and the reason is that every
  // spec pays for this page load, in an empty profile, with nothing cached from the last one.
  //
  // Measured in the test image, one `goto("/")`:
  //
  //     dev server    885ms   120 requests   8.9 MB
  //     this build    140ms     4 requests    51 KB
  //
  // Dev mode does not bundle, so the app arrives as a module per file; a fresh context has an
  // empty cache, so none of it carries over. Across a suite where opening a book is the first
  // line of nearly every spec, that is about a third of the whole run: the same seventeen specs
  // total 115.8s against the dev server and 83.5s against this one.
  //
  // The build costs 6.3s in the image, once, against 2.8s for the dev server starting — so it
  // is paid back several times over inside a single shard.
  //
  // **What this gives up, said out loud: React's StrictMode double-mounts only in development.**
  // `support/library.ts`'s `settled()` waits for exactly one page frame because two used to
  // exist for a moment, and that is a hazard this suite no longer walks into. It is a real
  // reduction in what is covered, taken knowingly — the double mount is a development-only
  // behaviour, and what these specs are for is the app a reader gets.
  //
  // The service worker a build normally registers is turned off for it (`vite.config.ts` reads
  // `TIDEMARKS_NO_SW`), which is what the dev server used to be giving us for free.
  //
  // Started from the root rather than from this package, because the root's `build` builds the
  // renderer first and this package's does not. Inside the test image that is redundant (the
  // image builds it), but on a fresh checkout the difference is between the suite testing the
  // renderer in the tree and testing whatever `packages/frond/dist` happened to hold.
  webServer: {
    command: "npm run build && npm run preview -w app -- --port 5174 --strictPort",
    cwd: "../..",
    env: { TIDEMARKS_NO_SW: "1" },
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  // All three are equals. A failure in any one is a failure — spine's hard requirement is
  // vertical CJK, and vertical is where the engines disagree most (frond's ADR-0004).
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      // Twice the default 30s, and only here. WebKit runs in a persistent context
      // (`tests/browser/support/fixtures.ts`), which puts a browser launch and a browser
      // shutdown inside every test's own budget instead of once per worker — measured at about
      // 400ms and 100ms. That is small, but the longest specs in this suite already sit in the
      // twenties when all three engines are competing for the same cores, and they were failing
      // in teardown with everything they assert already green.
      timeout: 60_000,
    },
  ],
});
