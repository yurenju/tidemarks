// A tap on the book: it raises the interface, turns no page, and gives up the browser's own tap
// so that Chrome for Android cannot take a word out of it. Whose tap it is, and when, is policy
// and is exhausted in src/lib/navigator.test.ts; what only a browser has is a selection appearing
// during the press and a `defaultPrevented` to read off the touch afterwards.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, readerFrame, visibleText } from "../support/library.js";

/**
 * What a tap does now that it does not turn pages (ADR-0024).
 *
 * **Every tap raises the chrome, wherever it lands**, and the three-tenths band this file used
 * to be about is gone. What has not changed is the press underneath it: Chrome for Android
 * still selects a word out of a plain tap — Touch to Search, no long press involved — and still
 * raises a search bar over the book that nothing on the page can take down. So
 * `preventTapDefault()` is still called on every press, and the second half of this file still
 * pins it. Only what it protects has changed: a tap that asks for the interface rather than a
 * tap that asks for a page.
 *
 * That browser behaviour cannot be provoked in a desktop engine — Playwright's touch emulation
 * dispatches the events without Chrome's Android gesture layer, and a headless run has no Touch
 * to Search at all. So the tests below **inject the same DOM situation**: a listener that
 * selects a word during the press, registered after frond's own so the ordering matches the
 * real thing (`pointerdown` sees no selection, `pointerup` sees one).
 */

test.use({ hasTouch: true });

/**
 * Makes the next press select a word, the way a phone browser does on a tap.
 *
 * Registered on the iframe document after frond's own listeners, so it runs after them: at
 * `pointerdown` frond still reports no selection, and by `pointerup` there is one.
 */
async function selectAWordOnNextPress(page: Page): Promise<void> {
  await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return;

      document.addEventListener(
        "pointerdown",
        () => {
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode() !== null) {
            const node = walker.currentNode as Text;
            if ((node.nodeValue ?? "").trim().length < 8) continue;

            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            const onScreen =
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right > 0 &&
              rect.bottom > 0 &&
              rect.left < view.innerWidth &&
              rect.top < view.innerHeight;
            if (!onScreen) continue;

            const word = document.createRange();
            word.setStart(node, 0);
            word.setEnd(node, Math.min(4, node.length));
            const selection = document.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(word);
            return;
          }
        },
        { once: true },
      );
    });
}

/** What the book's own document has selected. */
async function selectedText(page: Page): Promise<string> {
  return await readerFrame(page)
    .locator("body")
    .evaluate((body) => body.ownerDocument.getSelection()?.toString() ?? "");
}

/**
 * A point inside the viewer: `fraction` of the way across it, `down` of the way down it.
 *
 * Both are still parameters even though no boundary depends on them any more. That is the
 * claim being made: the same tap does the same thing at every one of these points.
 */
async function pointInViewer(page: Page, fraction: number, down = 0.85) {
  const box = (await page.locator(".viewer").boundingBox())!;
  return { x: box.x + box.width * fraction, y: box.y + box.height * down };
}

/**
 * Watches what becomes of the touch that ends the next press, in the book's own document.
 *
 * Registered after frond's own `touchend` listener, so it runs second and reads
 * `defaultPrevented` as frond left it.
 *
 * **The answer is parked outside the iframe, on the app's own document**, so that it survives
 * whatever the press does to the section on screen.
 */
async function watchTouchEnd(page: Page): Promise<void> {
  await page.evaluate(() => delete document.body.dataset.tapDefault);
  await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      body.ownerDocument.addEventListener("touchend", (event) => {
        const outer = body.ownerDocument.defaultView?.parent?.document;
        if (outer === undefined) return;
        outer.body.dataset.tapDefault = event.defaultPrevented ? "cancelled" : "kept";
      });
    });
}

/** What the last press did to its touch: `cancelled`, `kept`, or nothing yet. */
async function tapDefault(page: Page): Promise<string | undefined> {
  return await page.evaluate(() => document.body.dataset.tapDefault);
}

test.describe("tapping the page", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
  });

  test("a tap turns no page, wherever it lands", async ({ page }) => {
    // **The gatekeeper of ADR-0024.** Tapping the right edge of a horizontal book used to go
    // forward; a reader who learnt that will try it, and what they must get is the interface,
    // not a page they did not ask for and cannot find their way back from.
    for (const at of [
      { x: 0.9, down: 0.85 },
      { x: 0.1, down: 0.85 },
      { x: 0.5, down: 0.4 },
    ]) {
      const before = await visibleText(page);
      const point = await pointInViewer(page, at.x, at.down);

      await page.touchscreen.tap(point.x, point.y);
      await expect(page.getByTestId("chrome-bottom")).toBeVisible();
      expect(await visibleText(page)).toBe(before);

      // Put it away again for the next point: the same tap is the toggle, and it is the only way
      // out apart from turning a page. A chrome that withdrew on a timer of its own would take
      // the table of contents away from a reader who was still reading it, and the misfire it
      // would be saving them costs one extra tap (ADR-0020) — so nothing waits here either.
      await page.touchscreen.tap(point.x, point.y);
      await expect(page.getByTestId("chrome-bottom")).toBeHidden();
    }
  });

  test("the word the browser selected under a tap is dropped, toolbar and all", async ({
    page,
  }) => {
    // #36. Otherwise the reader gets the highlight toolbar over a page they were only trying to
    // put the interface on top of.
    await selectAWordOnNextPress(page);

    const at = await pointInViewer(page, 0.9);
    await page.touchscreen.tap(at.x, at.y);

    await expect.poll(async () => await selectedText(page)).toBe("");
    await expect(page.locator(".highlight-toolbar")).toBeHidden();
  });

  test("a mouse click raises the chrome too, and turns nothing", async ({ page }) => {
    const before = await visibleText(page);

    for (const down of [0.85, 0.4]) {
      const at = await pointInViewer(page, 0.5, down);
      await page.mouse.click(at.x, at.y);
      await expect(page.getByTestId("chrome-bottom")).toBeVisible();

      await page.mouse.click(at.x, at.y);
      await expect(page.getByTestId("chrome-bottom")).toBeHidden();
    }

    expect(await visibleText(page)).toBe(before);
    // And the desktop's own way forward still works — the buttons are the whole of it now.
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });
});

/**
 * The other half of #36: the search bar Chrome raises alongside the word it took.
 *
 * The selection is ours to undo, but that bar is not part of the document and nothing on the
 * page takes it down again — so it has to be stopped before it happens, by telling frond in
 * `pointerdown` that the browser may not act on this press as a tap of its own
 * (`preventTapDefault()`).
 *
 * **Which mechanism that is was settled by measurement, not by documentation** (#40, frond
 * #80). Making the text unselectable is the condition Chrome's own blog post names, and on a
 * real phone it only made the bar rarer — 21% of taps against 72% with nothing at all.
 * Cancelling the tap's default stopped it, 0 in 15.
 *
 * A desktop engine has no search bar to raise, so what is pinned here is the wiring: does a
 * press reach frond's mechanism, and is a link still left out of it. Whether the bar is
 * really gone is confirmed by hand, on a phone.
 */
test.describe("a press on the page takes the browser's own tap away", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
  });

  test("wherever it lands, since every tap now has the interface to protect", async ({ page }) => {
    // The three points this test was written with are left where they were. The answer used to
    // depend on which one — 0.9 was suppressed, 0.6 was not, 0.3 was suppressed again — and
    // the exemption in the middle is what let Chrome for Android take a word out of a plain tap
    // in the one place the reader got nothing in exchange. It has been the same everywhere
    // since ADR-0020, and it stays that way with the page turn gone.
    for (const at of [
      { x: 0.9, down: 0.85 },
      { x: 0.6, down: 0.85 },
      { x: 0.3, down: 0.85 },
      { x: 0.6, down: 0.4 },
    ]) {
      await watchTouchEnd(page);
      const point = await pointInViewer(page, at.x, at.down);
      await page.touchscreen.tap(point.x, point.y);
      await expect.poll(async () => await tapDefault(page)).toBe("cancelled");
    }
  });

  /**
   * The condition carrying the weight: a link is left to the browser.
   *
   * A cancelled tap loses its `click`, and the click is how frond recognises a link — so
   * suppressing a press that landed on a footnote marker would leave the note unreachable
   * anywhere in the book. `navigator.test.ts` pins the policy on its own; what this adds is
   * the wiring, that `isLink` really arrives from the book's own markup.
   *
   * The anchor is `position: fixed` so that adding it does not reflow the text under it: it
   * lands on the iframe's viewport, where the tap can be aimed at it.
   */
  test("a link keeps its tap — otherwise footnotes stop opening", async ({ page }) => {
    await readerFrame(page)
      .locator("body")
      .evaluate((body) => {
        const link = body.ownerDocument.createElement("a");
        link.href = "#footnote";
        link.textContent = "註";
        link.setAttribute(
          "style",
          "position: fixed; right: 0; top: 40%; width: 20%; height: 12%; z-index: 9",
        );
        body.append(link);
      });

    await watchTouchEnd(page);
    const onLink = await pointInViewer(page, 0.95, 0.5);
    await page.touchscreen.tap(onLink.x, onLink.y);

    await expect.poll(async () => await tapDefault(page)).toBe("kept");
  });
});
