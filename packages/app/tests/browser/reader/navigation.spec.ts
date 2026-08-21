import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  progressPercent,
  settled,
  visibleText,
  waitForIndex,
} from "../support/library.js";

declare global {
  interface Window {
    __indexStates?: string[];
  }
}

/**
 * Starts logging every value of the reader's `data-indexed`, in order, before the page has any
 * script of its own. Must be called before the navigation.
 *
 * The un-indexed state is real but short-lived, and frond keeps getting faster at building the
 * whole-book index — 0.4.4's single-pass stylesheet transform closed the window far enough that
 * reading the attribute once the book is open loses the race on every engine. A racy assertion
 * here is worse than none: it goes red on a working reader, and the obvious way to quiet it is
 * to drop the pre-index half of the claim.
 *
 * A `MutationObserver` installed this early cannot lose the race. The reader enters the document
 * un-indexed — `indexed` starts false and frond can only report the index from a later task — so
 * "false" is the first value logged however soon it flips.
 *
 * **This used to watch the Scrubber's own `aria-disabled`**, and it cannot any more: the Scrubber
 * is on screen only in 〈找〉, so it mounts when the reader asks for it rather than when the book
 * opens, and by then the index is usually built. What is watched instead is the fact underneath.
 * The track reads `disabled={!indexed}` off it in one line, and the test below pins the two ends
 * of that line together.
 */
async function recordIndexStates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const states: string[] = [];
    window.__indexStates = states;
    const record = () => {
      const value = document.querySelector(".reader")?.getAttribute("data-indexed");
      // Consecutive duplicates are dropped, so React's StrictMode double mount reads as one
      // "false"; a moment with no reader at all is skipped rather than logged.
      if (value != null && value !== states[states.length - 1]) states.push(value);
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-indexed"],
    });
  });
}

async function indexStates(page: Page): Promise<string[]> {
  return (await page.evaluate(() => window.__indexStates)) ?? [];
}

/**
 * The table of contents and the Scrubber.
 *
 * Both used to reach through epub.js internals — `resolveSpineHref` repaired TOC hrefs whose
 * commas the nav document percent-encoded, and `scrubber-epub.ts` matched TOC hrefs against the
 * spine by path suffix and asked `locations.cfiFromPercentage` for a jump target. Both modules
 * are gone: frond resolves hrefs at the parsing layer and answers `locate()` / `goToFraction()`
 * directly. What is left to prove is that the jumps land.
 */

test.describe("table of contents", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
  });

  test("lists the book’s chapters", async ({ page }) => {
    await openPanel(page, "Contents");

    const items = page.locator(".toc-item");
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(1);
  });

  test("marks the chapter being read, and no other", async ({ page }) => {
    // One `aria-current` element is asserted at a time, so a second marked entry fails the
    // strictness check rather than being averaged away.
    const current = page.locator('.toc-item[aria-current="location"]');

    await openPanel(page, "Contents");
    await expect(page.locator(".toc-item").first()).toBeVisible();
    // The book opens at its cover, and this book's nav document lists the cover under
    // landmarks rather than as a chapter. Front matter is not a chapter, so nothing is marked
    // — naming the first one there would be a lie.
    await expect(current).toHaveCount(0);

    await page.locator(".toc-item", { hasText: /^一$/ }).click();
    await settled(page);

    // **Asked for again, not read off the closing sheet.** A jump puts the chrome away
    // (CONTEXT.md 〈chrome〉), so the list the reader clicked is on its way out — it lives about
    // 300 ms, the length of its exit transition, and then unmounts. Asserting into that window
    // is a race the test loses whenever the machine is busy: the mark was always correct, the
    // list holding it had simply gone. Re-opening is also the real question a reader asks —
    // "where am I now" is asked the next time they open the table of contents.
    await openPanel(page, "Contents");

    // Marked without waiting for the whole-book index: the section is known from the first
    // `relocate`, which is why this rides on `sectionIndex` rather than on the fraction.
    await expect(current).toHaveText("一");
  });

  test("clicking an entry moves the reader there", async ({ page }) => {
    const before = await visibleText(page);

    await openPanel(page, "Contents");
    // A later entry, so the jump has somewhere to go from the very first page.
    await page.locator(".toc-item").nth(2).click();

    await expect.poll(async () => await visibleText(page), { timeout: 30_000 }).not.toBe(before);
  });
});

test.describe("scrubber", () => {
  test.beforeEach(async ({ page }) => {
    await recordIndexStates(page);
    await openBook(page, BOOKS.vertical);
  });

  test("is disabled until the whole-book index exists", async ({ page }) => {
    // Before the index there is no fraction to draw and no way to resolve a jump, so offering
    // the control would be offering something that cannot work.
    //
    // The whole sequence is asserted, not just the end state: the track has to enter the
    // document disabled and flip once. Reading the attribute after `openBook` returns cannot
    // prove that — see `recordIndexStates`.
    await waitForIndex(page);
    await openChrome(page);
    await expect(page.getByTestId("scrubber-track")).toHaveAttribute("aria-disabled", "false");
    expect(await indexStates(page)).toEqual(["false", "true"]);
  });

  test("dragging to the far end moves the reader through the book", async ({ page }) => {
    await waitForIndex(page);
    await openChrome(page);
    const before = await visibleText(page);
    const box = (await page.getByTestId("scrubber-track").boundingBox())!;

    // 直排 books mirror the axis: the book's head is on the right, so **leftward** is forward.
    // Dragging to the left edge on this book therefore means "towards the end".
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => await visibleText(page), { timeout: 30_000 }).not.toBe(before);
    await expect.poll(async () => await progressPercent(page)).toBeGreaterThan(0);
  });

  test("shows a preview while dragging without moving the reader yet", async ({ page }) => {
    // Commit-on-release: the drag only moves a bubble, and the jump fires on pointer-up. A
    // reader dragging across a long book would otherwise trigger a layout per pixel.
    await waitForIndex(page);
    await openChrome(page);
    const before = await visibleText(page);
    const box = (await page.getByTestId("scrubber-track").boundingBox())!;

    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });

    await expect(page.locator(".scrubber-preview")).toBeVisible();
    expect(await visibleText(page)).toBe(before);

    await page.mouse.up();
  });
});
