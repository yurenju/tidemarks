// Where the bars are while the chrome is down, and where they land once it is raised. Both are one CSS
// distance compared against a height a stack of bars ended up with, and nothing below a real
// layout knows either number. What the bars look like once they are home is
// chrome-placement.spec.ts.
import { type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome } from "../support/library.js";

/**
 * [[Find]] arrives and leaves by sliding, and this file watches the one number that slide depends
 * on: `--chrome-slide`, the distance every bar travels.
 *
 * It is one distance for a stack of two bars — the entries stand against the title bar, not
 * against the edge of the screen — so it has to be **longer than either stack is tall**. Too
 * long costs nothing, because the extra is spent past the edge where nothing is drawn. Too
 * short leaves a bar standing over the book in [[Read]], and nothing else in this suite would say
 * so: the tests that measure the chrome all raise it first.
 *
 * Measured with the chrome down, so there is no animation to race. The hand-held arrangement,
 * where the entries park against the other edge, is watched by `hand-held.spec.ts`.
 */
test.beforeEach(async ({ page }) => {
  await openBook(page, BOOKS.vertical);
});

/**
 * How far each bar has been pushed past the nearer edge of the reader. Negative means part of
 * it is still over the book.
 */
async function clearances(page: Page): Promise<{ bar: string; clearance: number }[]> {
  return page.evaluate(() => {
    const reader = document.querySelector(".reader")!.getBoundingClientRect();
    return [".chrome-top", ".chrome-nav", ".chrome-bottom"].map((selector) => {
      const bar = document.querySelector(selector)!.getBoundingClientRect();
      return {
        bar: selector,
        clearance: Math.max(reader.top - bar.bottom, bar.top - reader.bottom),
      };
    });
  });
}

test("parks every bar past the edge it came from", async ({ page }) => {
  for (const { bar, clearance } of await clearances(page)) {
    expect(clearance, `${bar} is still over the book in [[Read]]`).toBeGreaterThan(0);
  }
});

test("keeps the bars in the tree while they are down, so they have a way to leave", async ({
  page,
}) => {
  // Attached and hidden are both the point. Unmounted, a bar cannot slide away — it blinks out
  // half-way — and hidden is what keeps a parked bar out of the pointer's, the keyboard's and a
  // screen reader's way while it waits.
  await expect(page.getByTestId("chrome-bottom")).toBeAttached();
  await expect(page.getByTestId("chrome-bottom")).toBeHidden();
});

test("brings them home when Find stands, and takes them back when it ends", async ({ page }) => {
  await openChrome(page);

  const home = await page.evaluate(() => {
    const reader = document.querySelector(".reader")!.getBoundingClientRect();
    const top = document.querySelector(".chrome-top")!.getBoundingClientRect();
    const bottom = document.querySelector(".chrome-bottom")!.getBoundingClientRect();
    return { top: top.top - reader.top, bottom: reader.bottom - bottom.bottom };
  });

  // Flush with both edges, which is where the slide has to end for the bars to look like part
  // of the page rather than something laid near it.
  expect(Math.abs(home.top)).toBeLessThan(1);
  expect(Math.abs(home.bottom)).toBeLessThan(1);

  // And the same click puts them away again — the exit is the entrance in reverse, not a
  // separate path (`Reader.tsx`).
  const book = (await page.locator(".viewer").boundingBox())!;
  await page.mouse.click(book.x + book.width / 2, book.y + book.height * 0.4);
  await expect(page.getByTestId("chrome-bottom")).toBeHidden();

  for (const { bar, clearance } of await clearances(page)) {
    expect(clearance, `${bar} did not go all the way back`).toBeGreaterThan(0);
  }
});
