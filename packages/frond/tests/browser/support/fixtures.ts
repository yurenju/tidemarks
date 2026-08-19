import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { ORIGIN } from "./harness.js";

/**
 * The `test` these specs import instead of Playwright's own. It differs in one thing: the
 * `page` it hands out **outlives the test**, and the next test in the same file gets it back.
 *
 * ## Why
 *
 * Measured on the test image, `renderer/location.spec.ts` across the three browsers, one
 * worker, two cores — each row adds one layer to the row above it:
 *
 * | what the 90 tests do                            | time  |
 * | ----------------------------------------------- | ----- |
 * | nothing; empty bodies                           |  1.3s |
 * | open a page and `goto("about:blank")`           | 13.3s |
 * | + `openHarness`                                 | 21.1s |
 * | + `mountFixture`                                | 25.1s |
 * | the real spec, assertions and all               | 26.2s |
 *
 * Under 5% of that is the questions the spec asks. Nearly half is Playwright opening a page
 * for a test that has not started yet. Over the whole browser suite, reuse takes 730 tests
 * from 197s to 103s.
 *
 * ## What makes it safe
 *
 * A navigation replaces the document and with it the JavaScript realm, so nothing a spec put
 * on `window` survives — and every spec here either calls `openHarness` or `page.setContent`,
 * both of which navigate. What outlives a navigation is what belongs to the page or its
 * context rather than to the document, and there are three such things:
 *
 * - **Route handlers.** `openHarness` registers one per call, so unremoved they would stack
 *   up until an early handler answered a later test's request.
 * - **Event listeners.** `collectPageErrors` attaches to `pageerror` and `console`, and the
 *   array it returns is live — left attached, it keeps filling from the *next* test.
 * - **What the context stores**, `localStorage` above all.
 *
 * All three are undone below. Two cases skip the reuse entirely and get a page nobody has
 * touched: a test that **failed**, because a failure leaves the page in a state nobody
 * predicted and the next test's red should not be a consequence of it; and a test whose
 * context options differ from its neighbours', which is what makes `test.use({ hasTouch })`
 * keep working.
 *
 * ## Why a file's worth, and not a worker's
 *
 * The first version of this held one page for the entire worker, and the suite got *slower*
 * as it went: 244 tests' worth of mounted books, iframes and object URLs is a heap the engine
 * then has to work around, and by the last spec file that cost more than opening a page. Per
 * file is where the curve is still flat.
 */

/** The page a worker currently holds, and what it was opened for. */
interface LeasedPage {
  /** The page for `key`, opening one if what is held was opened for something else. */
  take(key: string, options: BrowserContextOptions): Promise<Page>;
  /** Throws away what is held, so the next `take` opens a fresh one. */
  drop(): Promise<void>;
}

export const test = base.extend<Record<never, never>, { leased: LeasedPage }>({
  leased: [
    async ({ browser }, use) => {
      let held: { key: string; context: BrowserContext; page: Page } | undefined;

      const drop = async () => {
        const spent = held;
        held = undefined;
        await spent?.context.close();
      };

      await use({
        async take(key, options) {
          if (held?.key === key) return held.page;

          await drop();
          const context = await browser.newContext(options);
          held = { key, context, page: await context.newPage() };
          return held.page;
        },
        drop,
      });

      await drop();
    },
    { scope: "worker" },
  ],

  // Every context option Playwright resolves per test is named here, and the context is built
  // from them. **An option left out of this list would be silently ignored** — a spec would
  // say `test.use({ colorScheme: "dark" })`, get a light one, and measure the wrong thing
  // without anything going red. The list is `PlaywrightTestOptions` minus the three that do
  // not describe a context (`actionTimeout`, `navigationTimeout`, `testIdAttribute`).
  page: async (
    {
      leased,
      acceptDownloads,
      baseURL,
      bypassCSP,
      clientCertificates,
      colorScheme,
      contextOptions,
      deviceScaleFactor,
      extraHTTPHeaders,
      geolocation,
      hasTouch,
      httpCredentials,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      proxy,
      serviceWorkers,
      storageState,
      timezoneId,
      userAgent,
      viewport,
    },
    use,
    testInfo,
  ) => {
    // The same merge order Playwright's own context fixture uses: whatever `contextOptions`
    // carries first, then the individually named options that were actually set.
    const named = {
      acceptDownloads,
      baseURL,
      bypassCSP,
      clientCertificates,
      colorScheme,
      deviceScaleFactor,
      extraHTTPHeaders,
      geolocation,
      hasTouch,
      httpCredentials,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      proxy,
      serviceWorkers,
      storageState,
      timezoneId,
      userAgent,
      viewport,
    };
    const options: BrowserContextOptions = {
      ...contextOptions,
      ...Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined)),
    };

    const page = await leased.take(JSON.stringify([testInfo.file, options]), options);

    await use(page);

    if (testInfo.status !== testInfo.expectedStatus) {
      await leased.drop();
      return;
    }

    // `ignoreErrors`, because a handler still answering a request from the test that just
    // ended is this suite's ordinary shutdown rather than a defect worth a red.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    page.removeAllListeners();

    // Only on the harness's origin. A spec that worked through `page.setContent` leaves the
    // page on `about:blank`, whose origin is opaque — `localStorage` there does not read as
    // an empty store, it throws.
    if (page.url().startsWith(ORIGIN)) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    }
  },
});

export { expect } from "@playwright/test";
