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

  // Under zh-Hant, Han characters collate ahead of Latin.
  expect(await titles(page)).toEqual([
    expect.stringMatching(/草枕/),
    expect.stringMatching(/Alice/),
  ]);

  await page.reload();
  await expect(page.getByTestId("shelf-order").locator("select")).toHaveValue("title");
  expect(await titles(page)).toEqual([
    expect.stringMatching(/草枕/),
    expect.stringMatching(/Alice/),
  ]);
});

test("offers no order control while the shelf is empty", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("shelf-empty")).toBeVisible();
  await expect(page.getByTestId("shelf-order")).toHaveCount(0);
});
