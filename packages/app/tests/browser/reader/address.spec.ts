// The address bar as a way into the middle of a book (`?at=`), and its one boundary: it is read
// when the book opens and never written back.
//
// **Wiring tests.** Which addresses parse, and into what, is exhausted in `src/lib/route.test.ts`
// where it costs nothing. What only a browser can answer is the half beyond the parse: that a
// whole-book fraction — a number nobody can resolve until frond has indexed the book — really
// lands the reader there, with no key pressed and nothing tapped.
//
// The second test is the rule the first one would otherwise erode. Writing the position back on
// every turn is the obvious next step and it is the wrong one: the hash the app writes is a hash
// the browser announces back to it, and each turn would leave a history entry, so the back button
// would walk pages instead of leaving the book.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome, progressPercent, visibleText } from "../support/library.js";

test.describe("an address that names a place in the book", () => {
  test("opens halfway through without a key being pressed", async ({ page }) => {
    await openBook(page, BOOKS.horizontal, { at: "frac:0.5" });

    await openChrome(page);
    const percent = await progressPercent(page);
    // Wide, because the exact landing is a layout's business: which page a fraction falls on
    // moves with the window and the type size. What is being asserted is that the book opened in
    // its middle rather than at its front, and the front is 0.
    expect(percent).toBeGreaterThan(35);
    expect(percent).toBeLessThan(65);
  });

  test("stays where it is when the reader turns a page", async ({ page }) => {
    await openBook(page, BOOKS.horizontal, { at: "frac:0.5" });
    const address = page.url();
    const before = await visibleText(page);

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => visibleText(page), { timeout: 30_000 }).not.toBe(before);

    expect(page.url()).toBe(address);
  });
});
