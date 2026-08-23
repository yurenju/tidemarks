// The one gesture in this suite made of real touch input rather than of events the page
// dispatches to itself, and so the only one that can be wrong the way a phone was wrong: the
// browser's own recognizer decides whether a sideways finger belongs to the page before any
// script hears about it. What a drag does once the events do arrive is drag.spec.ts.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, pageOffset, visibleText } from "../support/library.js";

/**
 * A drag made of **real touch input**, not of dispatched events.
 *
 * `dragPage` builds its gesture out of `PointerEvent`s the page dispatches to itself, which
 * exercises this app's own handling and nothing underneath it. What it cannot exercise is the
 * browser's gesture recognizer — the thing that decides, before any script hears about it,
 * whether a finger travelling sideways belongs to the page or to the browser's own scrolling.
 *
 * **That gap shipped a reader that could not turn a page on a phone.** Every test was green:
 * with real touch, the sequence measured here was `pointerdown`, **one** `pointermove`, then
 * `pointercancel`, with the `touchmove`s carrying on without a pointer stream to go with them.
 * The page moved by nothing at all. The fix is `touch-action: none` on both surfaces (frond's
 * `layout.ts` inside the frame, `styles/book.css` on the container), and this is what holds it.
 *
 * CDP's `Input.dispatchTouchEvent` goes in ahead of the browser's decision, so this is the only
 * test here that can be wrong in the way a phone is wrong. **Chromium only**: the other two
 * engines have no equivalent, and a synthetic touch through their own APIs would land after the
 * same decision this exists to test.
 */

// A phone, because the two surfaces below are only tens of pixels apart at this size.
test.use({ hasTouch: true, viewport: { width: 412, height: 915 } });

test.skip(({ browserName }) => browserName !== "chromium", "CDP touch input is Chromium-only");

/** One finger, dragged leftwards across `fraction` of the container from `startX`. */
async function fingerDrag(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  { startX, fraction }: { startX: (box: { x: number; width: number }) => number; fraction: number },
): Promise<{ box: { x: number; y: number; width: number; height: number }; midDrag: number }> {
  const box = (await page.locator(".viewer-mount").boundingBox())!;
  const y = box.y + box.height / 2;
  const from = startX(box);

  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });

  await touch("touchStart", from);
  for (let step = 1; step <= 6; step += 1) {
    await touch("touchMove", from - (step * box.width * fraction) / 6);
    await page.waitForTimeout(30);
  }

  const midDrag = await pageOffset(page);
  await touch("touchEnd", 0);
  return { box, midDrag };
}

test("a finger dragged across the book turns the page", async ({ page, context }) => {
  await openBook(page, BOOKS.horizontal);
  const before = await visibleText(page);

  const { box, midDrag } = await fingerDrag(page, context, {
    startX: (b) => b.x + b.width * 0.75,
    fraction: 0.6,
  });

  // It followed the finger the whole way rather than stopping after one frame.
  expect(midDrag).toBeLessThan(-box.width * 0.4);
  await expect.poll(async () => await visibleText(page)).not.toBe(before);
});

test("and so does one that lands in the margin beside it", async ({ page, context }) => {
  // The band around the book's own frame belongs to the app, not to frond — 32px down each
  // side on this viewport, which is exactly where a thumb reaches. A finger landing there gets
  // no event from frond at all, so the container listens for itself (Reader.tsx).
  await openBook(page, BOOKS.horizontal);
  const before = await visibleText(page);

  await fingerDrag(page, context, { startX: (b) => b.x + b.width - 8, fraction: 0.6 });

  await expect.poll(async () => await visibleText(page)).not.toBe(before);
});
