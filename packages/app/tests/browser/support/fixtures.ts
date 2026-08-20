// oxlint-disable react/rules-of-hooks -- the `use` a fixture is handed is Playwright's, not
// React's. The lint config turns React's rules on for everything under `packages/app`, and this
// file is the one place in the suite where that name collides.
import { test as base } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The `test` these specs import instead of Playwright's own. It differs in one thing: **in
 * WebKit the context is a persistent one**, backed by a profile directory on disk.
 *
 * ## Why
 *
 * Tidemarks stores the epub body and the cover as `Blob`s (`lib/types.ts`'s `BookRecord`), and an
 * ephemeral WebKit session cannot put a `Blob` in IndexedDB. A three-byte one fails with
 *
 *     Error preparing Blob/File data to be stored in object store
 *
 * while the same store takes an `ArrayBuffer`. Every context Playwright hands out is ephemeral
 * unless it came from `launchPersistentContext` — so no book could be imported in WebKit at
 * all, and the whole reader suite used to skip that engine.
 *
 * Give the session a profile on disk and the same put succeeds. Both halves are pinned by
 * `reader/storage.spec.ts`, which measures the ephemeral failure and the persistent success
 * side by side, so the day WebKit stops needing this, that spec says so.
 *
 * **This is a property of the session, not of the engine's storage code**, which is why it is
 * fixed here rather than by changing what Tidemarks stores: Safari on a device has a profile, and
 * every context in this suite now has one too.
 *
 * ## What it costs
 *
 * A persistent context owns the browser it runs in, so WebKit launches one process per test
 * instead of sharing one per worker. Measured in the test image: about 400ms to launch and
 * 100ms to close, per test. Over the whole app suite that is 41s for 148 tests with 77 skipped,
 * against 66s for 218 with 10 skipped — nearly all of the difference being the 67 tests that
 * were not running at all before. It is also why the WebKit project gets twice the default test
 * timeout (`playwright.config.ts`).
 *
 * Two smaller costs, both deliberate:
 *
 * - The `browser` fixture is still built for a WebKit worker even though nothing uses it, and
 *   that is one idle process per worker. Playwright resolves fixture dependencies from the
 *   parameter list, so the only way to avoid it would be to launch the other two engines by
 *   hand as well — which would cost every worker far more than the idle process does.
 * - A context built here does not go through Playwright's `recordVideo` wiring. This config
 *   records no video; if that changes, WebKit will be the engine that records none.
 *
 * Each test gets a profile directory of its own, so it starts with an empty IndexedDB the way
 * an ephemeral context does — a shared profile would carry one spec's imported books into the
 * next.
 */
export const test = base.extend({
  context: async ({ playwright, browser, browserName }, use) => {
    // Options are not passed to either call on purpose. Playwright's instrumentation fills in
    // every resolved context option (viewport, `hasTouch`, `isMobile`, `baseURL`, and whatever
    // a spec set with `test.use`) as a context is created, for a persistent one as well — so
    // naming them here would be a second, staler copy of that list.
    if (browserName === "webkit") {
      // A temporary directory rather than `testInfo.outputPath()`, whose name is built from the
      // test's title: WebKit's launcher parses its own arguments through GLib and dies on a
      // non-ASCII `--user-data-dir` with "Invalid byte sequence in conversion input". Plenty of
      // titles in this suite are written in Chinese.
      const profile = await mkdtemp(join(tmpdir(), "tidemarks-webkit-"));
      const context = await playwright.webkit.launchPersistentContext(profile);
      await use(context);
      await context.close();
      await rm(profile, { recursive: true, force: true });
      return;
    }

    const context = await browser.newContext();
    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    // A persistent context opens with a page already in it; an ephemeral one starts empty.
    // Taking the one that is there keeps WebKit from carrying a blank second page around.
    const [opened] = context.pages();
    await use(opened ?? (await context.newPage()));
  },
});

export { expect } from "@playwright/test";
