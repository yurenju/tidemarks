import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, openChrome, settled } from "../support/library.js";

/**
 * The shelf's first screen: one large book, or none.
 *
 * Which book that is, and what the two lines under it say, are pure functions covered in Node
 * (`src/lib/book-status.test.ts`). What only a browser can answer is the shape of the screen —
 * that the large book is really absent in the three cases where there is nobody to lead with,
 * and that reading a book really does put it there.
 */

/**
 * Marks a book as read to the end, by writing the row the reader's own page turns would have.
 *
 * Straight into IndexedDB, which the support helpers otherwise avoid — every other spec goes
 * through the app's own path so that a broken import cannot sail past. There is no path to
 * "finished" here: it means turning every page of a real book, and the shelf's answer to a
 * finished book is exactly what this spec is about.
 */
async function markFinished(page: Page, bookId: string): Promise<void> {
  await page.evaluate(
    ([id]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("progress", "readwrite");
          tx.objectStore("progress").put({
            bookId: id,
            cfi: "epubcfi(/6/2!/4)",
            pageRange: null,
            percentage: 1,
            chapterLabel: null,
            lastReadAt: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [bookId],
  );
}

async function bookIdOf(page: Page): Promise<string> {
  const id = await bookCards(page).first().getAttribute("data-book-id");
  expect(id).toBeTruthy();
  return id!;
}

test("an empty shelf says so, and leads with nothing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("shelf-empty")).toBeVisible();
  await expect(page.getByTestId("reading-now")).toHaveCount(0);
});

test("a book nobody has opened stays on the wall", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  // Blowing an unopened book up to half the screen would read as the app telling the reader to
  // get on with it.
  await expect(page.getByTestId("reading-now")).toHaveCount(0);
  await expect(bookCards(page)).toHaveCount(1);
  await expect(page.getByTestId("book-status").first()).toContainText("還沒翻開");
});

test("a shelf where everything is finished leads with nothing", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  await markFinished(page, await bookIdOf(page));
  await page.reload();

  await expect(bookCards(page)).toHaveCount(1);
  await expect(page.getByTestId("reading-now")).toHaveCount(0);
  await expect(page.getByTestId("book-status").first()).toContainText("讀完了");
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
  // And it is not on the wall as well: the shelf shows a book once.
  await expect(bookCards(page)).toHaveCount(0);
});

test("the card's ⋯ opens 〈書的詳情〉 for that book", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const bookId = await bookIdOf(page);

  await page.getByTestId("book-more").first().click();

  await expect(page.getByTestId("drawer-about")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#/?d=about/${bookId}`);
  // The three numbers that used to sit under every cover on the shelf.
  await expect(page.getByTestId("about-sessions")).toContainText("場");
  await expect(page.getByTestId("about-reading-time")).toBeVisible();
});

test("the reader's ⋯ opens the same drawer over the book", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const bookId = await bookIdOf(page);

  await page.getByTestId("book-open").first().click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
  await openChrome(page);
  await page.getByTestId("reader-about").click();

  await expect(page.getByTestId("drawer-about")).toBeVisible();
  // The book id is carried even though the screen underneath is that same book: reading the
  // hash never means looking at what is below it.
  expect(new URL(page.url()).hash).toBe(`#/book/${bookId}?d=about/${bookId}`);
  // And the reader is still underneath, not replaced.
  await expect(page.locator(".reader")).toBeVisible();
});
