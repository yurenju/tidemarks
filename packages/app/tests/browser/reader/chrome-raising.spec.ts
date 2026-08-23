// Raising the chrome off a page that is not idle, which is the one way into the raised state the rest of
// the suite never takes. "Is something selected" is the browser's answer rather than ours, so the
// branch has no pure-function form at all — it needs a real selection standing inside frond's own
// frame.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome, selectVisibleText } from "../support/library.js";

/**
 * Raising the chrome when the page is not idle.
 *
 * "One press, one thing" (`Reader.tsx`) means a press that finds a selection standing is spent
 * putting that selection down and raises nothing. Every other spec in this suite reaches the
 * chrome through `openChrome`, and most of them call it on a quiet page — so nothing else here
 * would notice if that helper went back to clicking once and hoping.
 *
 * It did notice, once, in CI: 〈the highlight is counted on the notes button〉 painted a
 * highlight, and the browser's own selection inside the iframe outlived the toolbar by a few
 * tens of milliseconds. The single click landed in that window, was spent on the selection, and
 * the helper waited five seconds for a chrome nobody had asked for (#170).
 *
 * That window is too narrow to aim at on purpose. **A selection left standing is the same
 * situation held still**, so that is what this asks for: the first click goes on the selection,
 * and a reader who still wants the interface clicks again. `openChrome` has to do the same.
 */
test("comes up even with a selection standing, which costs the first click", async ({ page }) => {
  await openBook(page, BOOKS.vertical);

  await selectVisibleText(page);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();

  await openChrome(page);
  await expect(page.getByTestId("chrome-bottom")).toBeVisible();
});
