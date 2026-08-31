// oxlint-disable react/rules-of-hooks -- the `use` a fixture is handed is Playwright's, not
// React's. The lint config turns React's rules on for everything under `packages/app`, and this
// file is the one place in the suite where that name collides.
import { test as base, type BrowserContext } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The `test` these specs import instead of Playwright's own. It differs in one thing: every
 * context answers `/auth/*` locally.
 *
 * ## It used to differ in a second, much more expensive way
 *
 * WebKit ran in a **persistent** context, backed by a profile directory on disk, because an
 * ephemeral WebKit session cannot put a `Blob` into IndexedDB and Tidemarks stored the epub body
 * and the cover as Blobs. A persistent context owns the browser it runs in, so WebKit launched
 * and tore down a browser process inside every test's own budget instead of sharing one per
 * worker — measured at about a second a test, a third of that engine's whole suite.
 *
 * `BookRecord` holds `ArrayBuffer`s now (`src/lib/types.ts`), which every engine stores in an
 * ephemeral session, so the workaround is gone and this file is back to Playwright's own
 * behaviour. That matters beyond the second it saves: a shared, hand-built context could not
 * honour `test.use({ hasTouch, isMobile, locale, colorScheme })`, since those are fixed when a
 * context is created — seventeen places in this suite set one. Playwright resolves them for
 * free, and nothing here has to keep a list of which options exist.
 *
 * `reader/storage.spec.ts` is where the platform fact itself is pinned, including the Blob
 * failure that used to make the workaround necessary.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await refuseAuth(context);
    await use(context);
  },
});

/**
 * The same thing, in a session with a profile on disk. **Opt into it only for a spec that puts a
 * `Blob` into IndexedDB.**
 *
 * One spec does: `reader/font-weight.spec.ts`, which goes through the font store. A CJK face is
 * 19 MB and is held as a `Blob` on purpose — `src/lib/db.ts` has the argument, and it is the
 * opposite of the book's: a face is only ever handed to `URL.createObjectURL`, so keeping it out
 * of memory is the whole point, where a book is parsed and materialised anyway.
 *
 * So the platform fact `reader/storage.spec.ts` pins still bites in exactly one place, and this
 * is the whole of what is left of a workaround the entire suite used to pay for. It costs about
 * a second per test in WebKit, on two tests rather than on four hundred.
 *
 * ⚠️ **A profile of its own per test**, so the store starts empty the way an ephemeral session
 * would — a shared one would carry a downloaded face into the next test and hide the download.
 */
export const testWithProfile = base.extend({
  context: async ({ playwright, browser, browserName }, use) => {
    // Options are not passed to either call on purpose. Playwright's instrumentation fills in
    // every resolved context option (viewport, `hasTouch`, `isMobile`, `baseURL`, and whatever a
    // spec set with `test.use`) as a context is created, for a persistent one as well — so
    // naming them here would be a second, staler copy of that list.
    //
    // A temporary directory rather than `testInfo.outputPath()`, whose name is built from the
    // test's title: WebKit's launcher parses its own arguments through GLib and dies on a
    // non-ASCII `--user-data-dir` with "Invalid byte sequence in conversion input". Plenty of
    // titles in this suite are written in Chinese.
    const profile =
      browserName === "webkit" ? await mkdtemp(join(tmpdir(), "tidemarks-webkit-")) : null;
    const context =
      profile === null
        ? await browser.newContext()
        : await playwright.webkit.launchPersistentContext(profile);

    await refuseAuth(context);
    await use(context);

    await context.close();
    if (profile !== null) await rm(profile, { recursive: true, force: true });
  },

  page: async ({ context }, use) => {
    // A persistent context opens with a page already in it; an ephemeral one starts empty.
    const [opened] = context.pages();
    await use(opened ?? (await context.newPage()));
  },
});

/**
 * Answers `/auth/*` with the 401 a logged-out reader would really get.
 *
 * No Worker runs beside this suite — Vite forwards `/api` and `/auth` to port 5002 and nothing
 * is listening — so every such request used to end as a red `ECONNREFUSED` line in the run's
 * output. The account panel asks `/auth/me` on mount and offers a passkey from the email field,
 * which was a dozen of them; sync's own share is gone now that it refuses to run signed out
 * (`src/lib/session.ts`). Green runs printing red lines is how a real failure gets missed.
 *
 * **Fulfilled rather than aborted.** 401 is what the server says to a browser with no session,
 * so the app takes exactly the path it takes in production; an abort would make `fetch` throw
 * and put it on a different one.
 *
 * **`/auth` only.** A signed-out app makes no `/api` request at all now, so stubbing that too
 * would be insurance against nothing — and it would quietly absorb the day someone adds a sync
 * trigger that skips the check, which is precisely what `library/signed-out.spec.ts` is there to
 * turn red.
 */
async function refuseAuth(context: BrowserContext): Promise<void> {
  await context.route("**/auth/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    }),
  );
}

export { expect } from "@playwright/test";
