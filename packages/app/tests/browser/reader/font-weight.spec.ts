// Whether the reader's two-weight rule actually reaches a book's own weights. Like
// `rendering.spec.ts`, this is a typographic claim in the app's suite on purpose: the chain it
// asserts is app declaring the faces, frond restating the book's declarations, and the engine
// clamping a variable font's wght axis — and no one package's suite can see all three at once.
//
// The face is variable and pinned by two single-value `font-weight` descriptors, which lands
// every weight on one of the reader's two except exactly 500 — the gap frond's
// `quantise-font-weight` closes, and whose mechanism is written down once, on that rewrite.
// This is the spec that says the whole chain holds on a real book on a real engine.
//
// **The propositions about which weight maps to which are not here.** Those are exhaustive in
// frond's `css.test.ts`, in Node, where they cost nothing; repeating them across three engines
// is the duplication `docs/agents/testing.md` warns about. What is left is the one wiring
// assertion (in `readInSerif`) and the one claim no lower layer can make: that the two weights
// are *drawn* as two, not merely asked for as two.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openPanel, readerFrame, segment } from "../support/library.js";

/** The bold weight the serif is pinned to, as `web-font.ts` declares it. */
const BOLD = "800";

/**
 * Puts the book under [[Serif]] and waits until the reader's weights are actually in force.
 *
 * **Waiting on the face being stored is not enough**, and firefox is where that showed: the
 * download landing is one event and frond rebuilding the document with the new settings is
 * another, so between them the old document is still on screen with the book's own weights in
 * it. `settled()` cannot see the difference — it waits for one frame with text, and there is
 * one either way.
 *
 * So this waits on the thing itself. The emphasis reporting the bold weight is the last step
 * of the chain, which makes it the only proxy that cannot be ahead of what the specs read.
 */
async function readInSerif(page: Page): Promise<void> {
  await openBook(page, BOOKS.emphasis);
  await openPanel(page, "Type");

  // Picking [[Serif]] is what puts the book under Tidemarks' two weights at all. Left on the
  // book's own fonts, its 300/500/600 are drawn as written and nothing here applies.
  await segment(page, "setting-font-family", "serif").click();

  // The face is 19 MB and arrives over the container's own loopback.
  await expect(page.getByTestId("font-line")).toContainText("Serif is on this device", {
    timeout: 60_000,
  });

  await expect
    .poll(
      () =>
        readerFrame(page)
          .locator("span.sans")
          .first()
          .evaluate((element) => getComputedStyle(element).fontWeight)
          // The frame is replaced as the document is rebuilt, so a read can land on one that
          // has just been detached. That is the state being waited out, not a failure.
          .catch(() => null),
      { timeout: 30_000, message: "the reader's bold weight never reached the book" },
    )
    .toBe(BOLD);
}

test("the two weights are drawn as two weights, not asked for as two", async ({ page }) => {
  await readInSerif(page);

  // Ink coverage over the two, read through the page's own canvas. What this catches that the
  // computed weights above cannot: a face declared `100 300` instead of `300 300` reports the
  // same computed weight and draws a different one, because a range containing the requested
  // weight passes it through unclamped.
  const { emphasis, body } = await readerFrame(page)
    .locator("body")
    .evaluate((element) => {
      const view = element.ownerDocument.defaultView;
      if (view === null) throw new Error("no view");

      const measure = (selector: string): number => {
        const target = element.ownerDocument.querySelector(selector);
        if (target === null) throw new Error(`no ${selector}`);
        const style = view.getComputedStyle(target);
        const canvas = element.ownerDocument.createElement("canvas");
        canvas.width = 600;
        canvas.height = 120;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2d context");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        // The same font shorthand the element resolved to, so the canvas goes through the
        // same font matching the book's text did — including the declared descriptors.
        context.font = `${style.fontWeight} 48px ${style.fontFamily}`;
        context.textBaseline = "top";
        context.fillText("鬱籲纖躊躇矚齷齪鑿懿", 4, 20);

        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) {
          ink += 1 - (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
        }
        return ink;
      };

      return { emphasis: measure("span.sans"), body: measure("p") };
    });

  // Measured in the container across the three engines, the serif's 800 carries 1.56× the ink
  // of its 300. A face left unclamped would draw both at what the book asked for — 300 and
  // 500 — which is 1.19×, comfortably under this floor.
  expect(emphasis / body).toBeGreaterThan(1.35);
});
