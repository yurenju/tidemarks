import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome } from "../support/library.js";

/**
 * chrome as a layer: one step off the book, in both themes, and the same step reported to the
 * platform so its own bar joins on (ADR-0028, docs/specs/reader-chrome-layers/spec.md).
 *
 * Asserted here rather than screenshotted because the claim is about two colours being
 * *different* by a specific amount, and a screenshot can only show that they look different to
 * whoever is reading it. The three bars taking the book's own token is exactly what this used to
 * be, and it type-checked perfectly.
 */
test.beforeEach(async ({ page }) => {
  await openBook(page, BOOKS.vertical);
});

/** Every colour this file compares, as the browser finally resolved it. */
async function surfaces(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const paint = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).backgroundColor;
    return {
      page: getComputedStyle(document.documentElement).getPropertyValue("--surface-page").trim(),
      raised: getComputedStyle(document.documentElement)
        .getPropertyValue("--surface-raised")
        .trim(),
      top: paint(".chrome-top"),
      nav: paint(".chrome-nav"),
      bottom: paint(".chrome-bottom"),
      viewer: paint(".viewer-wrap"),
      themeColor: document
        .querySelector('meta[name="theme-color"]')!
        .getAttribute("content")!
        .trim(),
    };
  });
}

test("stands the three bars one step off the book, as one layer", async ({ page }) => {
  await openChrome(page);
  const seen = await surfaces(page);

  // One layer, so one colour: three bars of the same state arriving together in three shades
  // would read as three unrelated things.
  expect(seen.nav).toBe(seen.top);
  expect(seen.bottom).toBe(seen.top);

  // And that colour is not the book's. This is the whole assertion — the bars used to take
  // `--surface-page` itself, which is the same token the page under them takes, not a value
  // near it.
  expect(seen.top).not.toBe(seen.viewer);
});

/**
 * The focus ring's halo is cut out of the bar, not out of the book.
 *
 * It is the same defect the Scrubber's thumb ring had and the same fix, on the four buttons a
 * keyboard actually reaches: a halo whose whole job is to be invisible, painted in the colour of
 * a surface that is no longer the one behind it, is a pale loop around every focused entry. The
 * ring is `box-shadow`, so nothing about it is in the accessibility tree and nothing but a
 * measurement would catch it.
 */
test("cuts the focus halo out of the bar the button is standing on", async ({ page }) => {
  await openChrome(page);

  const entry = page.getByTestId("chrome-nav").getByRole("button", { name: "目錄" });

  // Tabbed to rather than `focus()`ed. `:focus-visible` asks how the focus arrived, and a
  // programmatic call is not a keyboard — the ring this test is about would never be drawn, and
  // the test would be measuring the rule's absence in every engine at once.
  await expect
    .poll(async () => {
      await page.keyboard.press("Tab");
      return entry.evaluate((el) => el === document.activeElement);
    })
    .toBe(true);

  const seen = await entry.evaluate((el) => ({
    shadow: getComputedStyle(el).boxShadow,
    bar: getComputedStyle(el.closest(".chrome-nav")!).backgroundColor,
    book: getComputedStyle(document.querySelector(".viewer-wrap")!).backgroundColor,
  }));

  // `box-shadow` reports its colour first, so the halo's paper is readable straight out of it.
  expect(seen.shadow).toContain(seen.bar);
  expect(seen.shadow).not.toContain(seen.book);
});

/**
 * The token resolves, which is not free: `--surface-raised` is defined as `var(--paper-250)`, so
 * anything reading it back gets a resolved colour only because custom properties substitute at
 * computed-value time. `App.tsx` depends on exactly that to keep the platform's bar colour out of
 * TypeScript — if it ever stopped being true, the meta tag would quietly carry the literal string
 * "var(--paper-250)" and nobody would see it from inside the app.
 */
test("hands the platform the chrome's own colour rather than the book's", async ({ page }) => {
  const seen = await surfaces(page);

  expect(seen.raised).toMatch(/^#[0-9a-f]{6}$/i);
  expect(seen.themeColor.toLowerCase()).toBe(seen.raised.toLowerCase());
  expect(seen.themeColor.toLowerCase()).not.toBe(seen.page.toLowerCase());
});

test("carries the layer, and the platform's bar, into the dark theme", async ({ page }) => {
  // The default is `theme: "system"`, so the media emulation is what the app resolves against.
  await page.emulateMedia({ colorScheme: "dark" });
  await openChrome(page);

  const dark = await surfaces(page);
  expect(dark.nav).toBe(dark.top);
  expect(dark.top).not.toBe(dark.viewer);

  // The step survives the theme it is hardest in: in the dark it is 1.08:1, which is the number
  // ADR-0028 accepted and the reason the hairline stays.
  const hairline = await page
    .locator(".chrome-top")
    .evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(hairline).toBe("1px");

  await expect
    .poll(async () => (await surfaces(page)).themeColor.toLowerCase())
    .toBe(dark.raised.toLowerCase());
});
