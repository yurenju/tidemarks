import { type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * **A section is never painted before it has been paginated and positioned.**
 *
 * ## What is on screen without this
 *
 * The document is inside the iframe long before frond has laid it out. The layout
 * stylesheet is empty until the writing mode has been read, and reading it comes after
 * `document.fonts.ready` — so between the iframe's `load` and `applyLayout()` there is a
 * gap in which the section is an **ordinary scrolling document**: lines the full width of
 * the frame, images at their natural size, a native scrollbar down the side in the
 * platform's colours rather than the reader's theme, and scrolled to the top of the
 * section rather than to the position that is about to be restored.
 *
 * The gap lasts as long as the fonts do. Measured in spine on a book with a 16.7 MB CJK
 * face already on the device: **680 ms, on every open**, because applying the face
 * rebuilds the section — and a rebuild goes through the same mount.
 *
 * ## Why the assertions hang off the events rather than off a sampler
 *
 * `load` is emitted from inside the mount, after the section is paginated and **before**
 * the anchor has landed. Reading the frame there asks the exact question — "would the
 * reader have seen this?" — at the exact moment, with no `requestAnimationFrame` racing a
 * mount that on a small fixture finishes well inside one frame. A sampler would go green
 * here by missing the window rather than by there not being one.
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test("the first section is hidden while it lays out and shown once it is on the right page", async ({
  page,
}) => {
  await mountFixture(page, "vertical-japanese");

  // Paginated by now (`load` follows `applyLayout`), but the anchor has not landed, so
  // painting here would show page 0 of a book being opened elsewhere.
  expect(await visibilityWhen(page, "load")).toBe("hidden");
  expect(await visibilityWhen(page, "relocate")).toBe("visible");
  expect(await visibility(page)).toBe("visible");
});

/** The image-only section, which is where an unpaginated paint is at its most visible: without
 *  `applyLayout`'s cap the plate is drawn at its natural size. */
test("a section reached by a jump is hidden until it has laid out", async ({ page }) => {
  await mountFixture(page, "empty-and-image-only-sections");
  await page.evaluate(() => window.frond.goToSection(2));

  expect(await visibilityWhen(page, "load")).toBe("hidden");
  expect(await visibility(page)).toBe("visible");
});

/**
 * The route the 680 ms was measured on: a face arriving after the book is already open is
 * an `applySettings`, and that rebuilds the section from scratch.
 */
test("a rebuild from applySettings is hidden until it has laid out", async ({ page }) => {
  await mountFixture(page, "vertical-japanese");
  await page.evaluate(() => window.frond.applySettings({ fontSize: 24 }));

  expect(await visibilityWhen(page, "load")).toBe("hidden");
  expect(await visibility(page)).toBe("visible");
});

const visibility = (page: Page): Promise<string> =>
  page.evaluate(() => window.frond.frameVisibility());

const visibilityWhen = (page: Page, event: string): Promise<string | null> =>
  page.evaluate((name) => window.frond.frameVisibilityWhen(name), event);
