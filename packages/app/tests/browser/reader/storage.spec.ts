import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";

/**
 * What each engine can put in IndexedDB.
 *
 * This spec exists because of a measurement, not a suspicion: **WebKit cannot store a `Blob`
 * unless its session has a profile on disk.** In an ephemeral session a three-byte one fails
 * with
 *
 *     Error preparing Blob/File data to be stored in object store
 *
 * while the same store accepts an `ArrayBuffer`. Chromium and Firefox accept both either way.
 * Tidemarks writes the epub body and the cover as Blobs (`lib/types.ts`'s `BookRecord`), so in an
 * ephemeral WebKit session a book cannot be imported at all — which is what the whole reader
 * suite used to skip that engine for.
 *
 * Every context Playwright hands out is ephemeral unless it came from
 * `launchPersistentContext`, and that is the whole of what those skips were measuring. The
 * suite now gives WebKit a persistent context (`support/fixtures.ts`) and skips nothing.
 *
 * ## The two halves below
 *
 * The first two tests use this suite's own context, so they assert what every other spec
 * depends on: a Blob goes in, in all three engines.
 *
 * The third opens an ephemeral context by hand and pins the failure that makes the fixture
 * necessary. **It is the one that says when the fixture can go**: the day WebKit stores a Blob
 * in an ephemeral session, that test goes red, and whoever sees it can drop the persistent
 * context and have a shared browser per worker back.
 *
 * ## What this does not say about a device
 *
 * Safari on a phone has a profile, so the session this fails in is not one a reader is ever in.
 * That is an argument rather than a measurement — nothing here runs on iOS. Storing the body as
 * an `ArrayBuffer` instead is still filed as
 * https://github.com/yurenju/spine/issues/23, and this spec no longer makes the case for it.
 */

test("an ArrayBuffer can be stored, in every engine", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();

  expect(await probe(page, "arrayBuffer")).toBe("ok");
});

test("a Blob can be stored, in every engine", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();

  expect(await probe(page, "blob")).toBe("ok");
});

test("in WebKit that takes a session with a profile on disk", async ({ browser, browserName }) => {
  // Ephemeral, which is what `browser.newContext()` gives and what this suite's own fixture
  // deliberately does not use for WebKit.
  const ephemeral = await browser.newContext();
  const page = await ephemeral.newPage();
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();

  const verdict = await probe(page, "blob");
  await ephemeral.close();

  if (browserName === "webkit") {
    // Pinning the status quo. When this stops matching, `support/fixtures.ts` can stop
    // launching a persistent context — and this assertion failing is how anyone finds out.
    expect(verdict).toContain("Error preparing Blob/File data");
  } else {
    expect(verdict).toBe("ok");
  }
});

/** Puts one value into a store of its own and reports what IndexedDB said. */
async function probe(page: Page, kind: "blob" | "arrayBuffer") {
  return page.evaluate(async (which) => {
    const value = which === "blob" ? new Blob(["abc"]) : new Uint8Array([1, 2, 3]).buffer;

    return new Promise<string>((resolve) => {
      const open = indexedDB.open(`probe-${which}`, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("t");
      open.onerror = () => resolve("error: cannot open");
      open.onsuccess = () => {
        const transaction = open.result.transaction("t", "readwrite");
        const request = transaction.objectStore("t").put(value, "k");
        request.onsuccess = () => resolve("ok");
        // Both handlers: the engine reports this failure on the request in one place and on the
        // transaction in another.
        request.onerror = () => resolve(`error: ${request.error?.message ?? "unknown"}`);
        transaction.onerror = () => resolve(`error: ${transaction.error?.message ?? "unknown"}`);
      };
    });
  }, kind);
}
