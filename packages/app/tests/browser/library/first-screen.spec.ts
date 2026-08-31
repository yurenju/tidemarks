// What the shelf's first screen puts on the glass, one rule per test: the empty shelf's own
// sentence, that the status lines a book carries really arrive on screen through i18n and the
// cascade, that reading a book really does put it in the leading row, and the two doors into a
// book's details. Which book leads and how those lines are worded are pure functions, exhausted
// in src/lib/book-status.test.ts; which rows reach the screen at all is src/lib/shelf.test.ts.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, openChrome, settled } from "../support/library.js";

async function bookIdOf(page: Page): Promise<string> {
  const id = await bookCards(page).first().getAttribute("data-book-id");
  expect(id).toBeTruthy();
  return id!;
}

test("an empty shelf says so", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("shelf-empty")).toBeVisible();
});

// The wiring for the status lines: the words `statusLines` picks have to cross i18n and the
// `StatusLines` component to land under a cover, next to a cascade that `device.css` wins on
// import order alone. Which words, for which book, is book-status.test.ts.
test("what the shelf says about a book reaches the screen", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  await expect(bookCards(page)).toHaveCount(1);
  await expect(page.getByTestId("book-status").first()).toContainText("Not opened yet");
});

test("the book the reader was in the middle of leads the shelf", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  await page.getByTestId("book-open").first().click();
  await expect(page.locator(".reader")).toBeVisible();
  // Wait for the book to be on screen, not merely for the reader to exist: the position is
  // written by frond's first `relocate`, and leaving before that is a visit that left no trace.
  await settled(page);
  // Back to the shelf the way Android's back button gets there, which needs no chrome raised.
  await page.goBack();

  await expect(page.getByTestId("reading-now")).toBeVisible();
  await expect(page.getByTestId("reading-now-title")).toContainText("Alice");
  await expect(page.getByTestId("continue-reading")).toBeVisible();
  // And it is on the wall as well, in the first square. The row above is an action rather than a
  // second copy of the shelf, so filtering the book out would be an exception to the default
  // order — which puts the most recently touched book there anyway — with nothing to show for it.
  await expect(bookCards(page)).toHaveCount(1);
  await expect(bookCards(page).first()).toContainText("Alice");
});

test("the card's ⋯ opens About for that book", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const bookId = await bookIdOf(page);

  await page.getByTestId("book-more").first().click();

  await expect(page.getByTestId("panel-about")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#/?d=about/${bookId}`);
  // The three numbers that used to sit under every cover on the shelf.
  await expect(page.getByTestId("about-sessions")).toContainText(/sitting/);
  await expect(page.getByTestId("about-reading-time")).toBeVisible();
});

test("the reader's ⋯ opens the same panel over the book", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const bookId = await bookIdOf(page);

  await page.getByTestId("book-open").first().click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
  await openChrome(page);
  await page.getByTestId("reader-about").click();

  await expect(page.getByTestId("panel-about")).toBeVisible();
  // The book id is carried even though the screen underneath is that same book: reading the
  // hash never means looking at what is below it.
  expect(new URL(page.url()).hash).toBe(`#/book/${bookId}?d=about/${bookId}`);
  // And the reader is still underneath, not replaced.
  await expect(page.locator(".reader")).toBeVisible();
});
