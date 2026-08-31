// A platform assumption kept on its own so that a failure names it rather than arriving as a
// batch of books that will not import (testing.md principle 3): what each engine will accept into
// IndexedDB. The last of the three is what says when support/fixtures.ts can stop launching
// WebKit with a profile on disk.
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
 *
 * That is why `BookRecord` holds `ArrayBuffer`s rather than Blobs (`lib/types.ts`). Every
 * context Playwright hands out is ephemeral, so with Blobs a book could not be imported in
 * WebKit at all — first the whole reader suite skipped that engine, then it launched a
 * persistent context per test to get a profile, at about a second each. Storing the bytes
 * instead is what let `support/fixtures.ts` go back to nothing but a route.
 *
 * ## The two halves below
 *
 * The first test is the one the rest of the suite rests on: the shape Tidemarks stores goes in,
 * in every engine, in the session these specs actually run in.
 *
 * The second pins the failure that decided the shape. **It is the record of why**, so that
 * "why not just hold a Blob, they are nicer to draw with" has an answer that is a measurement
 * rather than a memory. If WebKit ever starts accepting one, it goes red — and that is worth
 * knowing, but it is no longer a reason to change anything: the bytes work everywhere.
 *
 * ## What this does not say about a device
 *
 * Safari on a phone has a profile, so the session it fails in is not one a reader is ever in.
 * That is an argument rather than a measurement — nothing here runs on iOS.
 */

test("what a book is stored as goes into IndexedDB, in every engine", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();

  expect(await probe(page, "arrayBuffer")).toBe("ok");
});

test("a Blob would not, in WebKit", async ({ page, browserName }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();

  const verdict = await probe(page, "blob");

  if (browserName === "webkit") {
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
