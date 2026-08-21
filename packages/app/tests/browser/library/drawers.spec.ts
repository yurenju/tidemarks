import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, segment } from "../support/library.js";

/**
 * 〈設定〉 the floor and 〈書的詳情〉 the drawer, and the things that only hold because both live
 * in the hash.
 *
 * Back leaves the settings screen rather than the app, a refresh comes back to the same tab,
 * and the shelf is still under the drawer. None of those is true of a screen held in a piece of
 * React state, and none can be checked without a real browser history.
 */

test("opens 〈設定〉 from the shelf and comes back to the same tab after a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();

  await expect(page.getByTestId("settings-screen")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/settings/typography");

  await page.reload();
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  await expect(page.getByTestId("setting-theme")).toBeVisible();
});

test("each tab has an address of its own", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-tab-account").click();

  expect(new URL(page.url()).hash).toBe("#/settings/account");
  await page.reload();
  // 帳號's own first line, so this is the pane and not merely the screen.
  await expect(page.getByText("No account needed to read", { exact: false })).toBeVisible();
});

test("back leaves the settings screen and lands on the shelf, not outside the app", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings-screen")).toBeVisible();

  // What Android's back button does. This pins only that 〈設定〉 is a real history entry, which
  // is a property of it being a route at all; how the panels and the tabs themselves should
  // stack in history is still open, in #157.
  await page.goBack();
  await expect(page.getByTestId("settings-screen")).toHaveCount(0);
  await expect(page.getByTestId("open-settings")).toBeVisible();
});

test("leaves the shelf visible behind the details drawer", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  await page.getByTestId("book-more").first().click();
  await expect(page.getByTestId("drawer-about")).toBeVisible();
  await expect(bookCards(page).first()).toBeVisible();
});

test("a theme set in 〈設定〉 is still set after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();

  await segment(page, "setting-theme", "dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
