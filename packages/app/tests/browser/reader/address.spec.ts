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
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  progressPercent,
  readerFrame,
  settled,
  visibleText,
} from "../support/library.js";

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

/**
 * `?select=`, the address that arrives with a passage already chosen (#128).
 *
 * **Wiring tests again.** Which spelling parses into what is `src/lib/route.test.ts`'s, and
 * whether a CFI really finds its range in a laid-out document is
 * `packages/frond/tests/browser/renderer/select-range.spec.ts`'s. What is left over — and it can
 * only be asked here — is that the state on the other side of it is the one a reader's own
 * selection reaches: the colour row up, and a press on it drawing a mark.
 *
 * The CFI spelling has no test of its own for that reason. It differs from the phrase only in how
 * the CFI is arrived at, and both meet again one line later inside `applySelect`.
 */
/**
 * Halfway through, because **both fixtures open on a title page** — a line or two of display
 * type and an illustration, with no run of prose long enough to point at. A phrase to select has
 * to come from somewhere the book is actually being read, and the same address takes both the
 * reading of it and the selecting of it to the same page.
 */
const PROSE = "frac:0.5";

/**
 * A chapter head, and the reason there are two of these.
 *
 * **The two spellings report their position at opposite ends of the opening**, and a selection
 * put on screen is dropped by a book that says it has moved. `frac:` resolves against the
 * whole-book index and reports before the address has finished being carried out; `chars:` is
 * already where it is going and reports after. So a passage selected from a `chars:` address
 * used to arrive and be swept away a moment later, on the same code path that works for `frac:`
 * — which is why any test of "does it stay" has to name this one.
 */
const CHAPTER = "chars:2";

test.describe("an address that names a passage to select", () => {
  test("arrives with the colour row up, and a press on it draws a mark", async ({ page }) => {
    // The whole story the ticket is about: everything downstream of a selection, reached without
    // a drag landing on a different number of characters each run.
    await openBook(page, BOOKS.horizontal, { at: PROSE });
    const phrase = await prosePhrase(page);

    await reopenSelecting(page, { at: PROSE, select: phrase });

    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();
  });

  test("keeps the selection when the address named a chapter", async ({ page }) => {
    // Not a second copy of the test above: it is the same feature reached by the other spelling
    // of `?at=`, and that spelling is the one whose timing loses the selection. `handles=1` too,
    // because the drawn selection is the half a relocate discards — the browser's own survives
    // it either way, so testing this on the default route would prove nothing.
    await openBook(page, BOOKS.horizontal, { at: CHAPTER });
    const phrase = await prosePhrase(page);

    await reopenSelecting(page, { at: CHAPTER, select: phrase, handles: true });

    await expect(page.locator(".selection-handle")).toHaveCount(2);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
  });

  test("leaves the book open when the phrase is not in the section", async ({ page }) => {
    // A hand-typed address is what this parameter is for, so a phrase that is not there costs the
    // selection and nothing else. The console carries the reason; the reader gets their book.
    await openBook(page, BOOKS.horizontal, {
      at: PROSE,
      select: "no such sentence lives in this book",
    });

    await expect(page.locator(".reader")).toBeVisible();
    await expect(page.locator(".highlight-toolbar")).toBeHidden();
    expect((await visibleText(page)).trim().length).toBeGreaterThan(0);
  });
});

test.describe("an address that names a passage, on a phone", () => {
  // The same emulation `touch-selection.spec.ts` uses, and for the same reason: the route the app
  // draws for itself is chosen by `(pointer: coarse)` and nothing else reaches it.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.skip(
    ({ browserName }) => browserName === "firefox",
    "Playwright has no mobile emulation for Firefox, and the drawn route is chosen by (pointer: coarse)",
  );

  test("selects with the browser's own selection unless asked otherwise", async ({ page }) => {
    // **The default that was chosen deliberately** (`lib/route.ts`, `handles`). A window this
    // size would give a reader's finger the drawn route, where a range put there programmatically
    // is a no-op — so the default overrides it, and what would otherwise be "nothing happened,
    // and nothing said why" becomes a selection with no handles on it.
    await openBook(page, BOOKS.horizontal, { at: PROSE });
    const phrase = await prosePhrase(page);

    await reopenSelecting(page, { at: PROSE, select: phrase });

    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    await expect(page.locator(".selection-handle")).toHaveCount(0);
  });

  test("draws its own selection, handles and all, when asked", async ({ page }) => {
    // What the other route is for: a picture of the selection a finger produces, which is the one
    // thing the default cannot be photographed doing.
    await openBook(page, BOOKS.horizontal, { at: PROSE });
    const phrase = await prosePhrase(page);

    await reopenSelecting(page, { at: PROSE, select: phrase, handles: true });

    await expect(page.locator(".selection-handle")).toHaveCount(2);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
  });
});

/**
 * A run of text that is really on the page in front of the reader, for `?select=` to find.
 *
 * Read off the book rather than written into the test, because which words land on which page
 * moves with the window and the type size.
 *
 * **Out of one text node, and one that is long enough to be prose.** The search matches against
 * the text nodes' own characters, so the whitespace a book indents its blocks with is not there
 * to be matched, and a phrase reaching across a paragraph break would never be found.
 *
 * Which is also why these tests read Alice rather than the vertical fixture the selection specs
 * use: 草枕's opening page is ruby all the way down, and every ruby base is a text node one or
 * two characters long. Nothing here turns on the writing mode — the handles' axis is
 * `touch-selection.spec.ts`'s subject, not this file's.
 *
 * ⚠️ **And it has to appear in the section exactly once.** `?select=` takes the first occurrence
 * in the whole section, not the first on this page, so a run that also appears earlier — `"said
 * the "` is entirely ordinary in Carroll — selects a passage several pages back and nothing
 * arrives on screen. The test would fail on the assertion after it, saying nothing about why, and
 * only for some window sizes. Rejecting a repeated run here is what keeps that out.
 */
async function prosePhrase(page: Page): Promise<string> {
  const phrase = await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return null;

      // The same character stream `?select=` searches: this section's text nodes, joined.
      const all: string[] = [];
      const collect = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (collect.nextNode() !== null) all.push(collect.currentNode.nodeValue ?? "");
      const section = all.join("");

      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() !== null) {
        const value = (walker.currentNode.nodeValue ?? "").trim();
        if (value.length < 8) continue;

        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const rect = range.getBoundingClientRect();
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < view.innerWidth &&
          rect.top < view.innerHeight;
        if (!onScreen) continue;

        const candidate = value.slice(0, 8);
        if (section.indexOf(candidate) === section.lastIndexOf(candidate)) return candidate;
      }
      return null;
    });

  expect(phrase, "no run of prose on this page long enough to select").not.toBeNull();
  return phrase!;
}

/**
 * The same book, reopened at an address naming a passage — without importing it a second time.
 *
 * **The reload is not a formality.** Changing only the hash of the page already open never
 * reloads it, and the address is read when a book *opens* — so without this the app would sit
 * there holding the section it already had, and every assertion below would be about the
 * previous page.
 */
async function reopenSelecting(
  page: Page,
  options: { at: string; select: string; handles?: boolean },
): Promise<void> {
  const bookId = new URL(page.url()).hash.slice("#/book/".length).split("?")[0];
  const query = [
    `at=${encodeURIComponent(options.at)}`,
    `select=${encodeURIComponent(options.select)}`,
  ];
  if (options.handles === true) query.push("handles=1");

  await page.goto(`/#/book/${bookId}?${query.join("&")}`);
  await page.reload();
  await expect(page.locator('.reader[data-at="arrived"]')).toBeVisible({ timeout: 30_000 });
  await settled(page);
}
