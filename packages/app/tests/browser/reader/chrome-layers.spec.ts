// The chrome's colours as an engine finally resolved them: three bars on one surface, a step off
// the book, a focus halo cut out of the bar it stands on, and that same colour handed to the
// platform. Only a browser substitutes a `var()` chain and paints it; that the tokens the chain
// names exist at all is checked statically in src/lib/tokens.test.ts.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome, PAGE_FRAME } from "../support/library.js";

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

  const entry = page.getByTestId("chrome-nav").getByRole("button", { name: "Contents" });

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
 * The platform's own bar takes the colour of whatever is directly under it, which is a different
 * surface in each of the reader's two resting states.
 *
 * The token resolving is not free: `--surface-raised` is defined as another custom property, so
 * anything reading it back gets a colour only because custom properties substitute at
 * computed-value time. `App.tsx` depends on exactly that to keep these colours out of TypeScript
 * — if it ever stopped being true, the meta tag would quietly carry the literal string
 * "var(--paper-100)" and nobody would see it from inside the app.
 */
test("hands the platform whatever surface reaches the top edge", async ({ page }) => {
  const down = await surfaces(page);

  // 〈讀〉: no bar up there, so the top edge is the page itself. This is the half that used to be
  // wrong — a lit strip of the chrome's surface hanging over a book with no chrome in it.
  expect(down.page).toMatch(/^#[0-9a-f]{6}$/i);
  expect(down.themeColor.toLowerCase()).toBe(down.page.toLowerCase());

  await openChrome(page);
  const up = await surfaces(page);

  expect(up.raised).toMatch(/^#[0-9a-f]{6}$/i);
  expect(up.themeColor.toLowerCase()).toBe(up.raised.toLowerCase());
  expect(up.themeColor.toLowerCase()).not.toBe(up.page.toLowerCase());
});

/**
 * The book's paper and the frame around it are one surface.
 *
 * Only a browser can say this. `src/lib/tokens.test.ts` holds the value `settings.ts` hands frond
 * against the one `tokens.css` declares, which proves the two *numbers* agree; it cannot prove
 * frond then paints with it. The paper is drawn inside frond's iframe from a value that travelled
 * as a value, and every step between that value and the pixel is out here.
 *
 * The failure it catches is the one this test was written for: the dark theme sent a near-black
 * of its own, so the book sat on a mat a shade off itself, all the way round.
 */
for (const scheme of ["light", "dark"] as const) {
  test(`paints the book's paper in the same colour as the frame around it (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });

    const seen = await page.evaluate((selector) => {
      const frame = document.querySelector<HTMLIFrameElement>(selector);
      const inside = frame?.contentDocument?.documentElement;
      return {
        frame: getComputedStyle(document.querySelector(".viewer-wrap")!).backgroundColor,
        paper: inside === undefined ? null : getComputedStyle(inside).backgroundColor,
      };
    }, PAGE_FRAME);

    expect(seen.paper, "frond's page frame was not reachable").not.toBeNull();
    expect(seen.paper).toBe(seen.frame);
  });
}

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
