import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, importBook } from "../support/library.js";

/**
 * The shelf's order, end to end.
 *
 * `sortShelf` itself is covered in Node (`src/lib/shelf-order.test.ts`), including the stroke
 * collation and the max that puts a fresh import at the front. What only a browser can answer
 * is the wiring: that the select reaches the grid at all, and that the choice is still there
 * after a reload — which is the one part living in localStorage rather than in a pure function.
 */

async function titles(page: Page): Promise<string[]> {
  return page.getByTestId("book-title").allInnerTexts();
}

test("orders by recency by default, and keeps a switch to title across a reload", async ({
  page,
}) => {
  await page.goto("/");

  // Sequentially, and waiting for each card, so the two imports land on distinct `addedAt`.
  await importBook(page, BOOKS.vertical, /草枕/);
  await importBook(page, BOOKS.horizontal, /Alice/);

  // Neither has been opened, so "last touched" is the import — most recent first.
  expect(await titles(page)).toEqual([
    expect.stringMatching(/Alice/),
    expect.stringMatching(/草枕/),
  ]);

  await page.getByTestId("shelf-order").locator("select").selectOption("title");

  // Collated for the interface language, which the suite pins to English — so Alice leads and
  // 草枕 follows. Under 繁體中文 the two swap, because Han characters collate ahead of Latin
  // there; that is the point of binding the shelf's collation to the interface language rather
  // than to `navigator.language`, and it is asserted below.
  expect(await titles(page)).toEqual([
    expect.stringMatching(/Alice/),
    expect.stringMatching(/草枕/),
  ]);

  await page.reload();
  await expect(page.getByTestId("shelf-order").locator("select")).toHaveValue("title");
  expect(await titles(page)).toEqual([
    expect.stringMatching(/Alice/),
    expect.stringMatching(/草枕/),
  ]);
});

/**
 * The half of the order that is not the order: which language decides what "by title" means.
 *
 * `Intl.Collator` is asked for the interface language, not the browser's, so the shelf and the
 * words around it are always sorted by the same rules. A reader who set Tidemarks to 繁體中文
 * on an English machine gets a stroke-ordered shelf, which is what a Traditional Chinese index
 * looks like — the English collation would put every Han title in code-point order behind the
 * Latin ones, which is neither language's answer.
 */
test.describe("collated for the language the interface is in", () => {
  test.use({ locale: "zh-TW" });

  test("orders Han titles ahead of Latin ones in Chinese", async ({ page }) => {
    await page.goto("/");
    await importBook(page, BOOKS.vertical, /草枕/);
    await importBook(page, BOOKS.horizontal, /Alice/);

    await page.getByTestId("shelf-order").locator("select").selectOption("title");

    expect(await titles(page)).toEqual([
      expect.stringMatching(/草枕/),
      expect.stringMatching(/Alice/),
    ]);
  });
});

test("offers no order control while the shelf is empty", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("shelf-empty")).toBeVisible();
  await expect(page.getByTestId("shelf-order")).toHaveCount(0);
});
