// The selection Tidemarks draws for itself on touch (ADR-0036): a long press snaps a word, the
// handles move its ends, and a swipe elsewhere still turns the page. What no pure function can
// answer is what this file is for — the geometry comes back from a real layout through frond's
// `rangeFromPoints`, and the branch only exists at all on a device whose primary pointer is
// coarse. `selection-handles.test.ts` has the arithmetic; `toolbar-position.test.ts` has where
// the colour row lands.
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  PAGE_FRAME,
  dragPage,
  farEnoughToTurn,
  longPressSelect,
  openBook,
  settled,
} from "../support/library.js";

/**
 * A phone: the branch under test is chosen by `(pointer: coarse)`, and nothing else here reaches
 * it. `hasTouch` alone does not — it gives the page touch events without making the finger the
 * primary pointer — so this needs the same mobile emulation `hand-held.spec.ts` uses, and
 * inherits its one limitation: Playwright has no `isMobile` for Firefox.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.skip(
  ({ browserName }) => browserName === "firefox",
  "Playwright has no mobile emulation for Firefox, and this whole branch is chosen by (pointer: coarse)",
);

test.beforeEach(async ({ page }) => {
  await openBook(page, BOOKS.vertical);
});

test("emulation reaches the media query, so the assertions below mean what they say", async ({
  page,
}) => {
  // First and on its own, for `hand-held.spec.ts`'s reason: without it every assertion in this
  // file could pass or fail for a reason that has nothing to do with the selection.
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
});

test("the browser's own selection is off inside the book", async ({ page }) => {
  // The other half of taking selection over, and the half with no visible symptom of its own
  // until two selections are on screen at once. It is declared inside frond's iframe, which is
  // the only place it can be — a rule out here reaches none of the book.
  //
  // Both spellings are read because WebKit resolves only the prefixed one, and the app sets
  // both for exactly that reason — asking for `userSelect` alone would report `undefined` there
  // and read as a failure of the feature rather than of the question.
  const selectable = await page
    .frameLocator(PAGE_FRAME)
    .locator("html")
    .evaluate((root) => {
      const style = getComputedStyle(root) as CSSStyleDeclaration & { webkitUserSelect?: string };
      return style.userSelect ?? style.webkitUserSelect;
    });

  expect(selectable).toBe("none");
});

test("a long press snaps the word under the finger", async ({ page }) => {
  await longPressSelect(page);

  await expect(page.locator(".selection-wash").first()).toBeVisible();
  await expect(page.locator(".selection-handle")).toHaveCount(2);
});

test("the colour row waits for the finger to lift", async ({ page }) => {
  // 〈標〉 begins when the finger does not (CONTEXT.md 〈chrome〉). Raised any earlier the row
  // would sit under the finger that raised it, and chase the selection while it is extended.
  await page.evaluate(
    ({ selector }) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement;
      const view = frame.contentWindow!;
      const box = frame.getBoundingClientRect();
      const Pointer = (view as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
      frame.contentDocument!.body.dispatchEvent(
        new Pointer("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: box.width / 2,
          clientY: box.height / 2,
        }),
      );
    },
    { selector: PAGE_FRAME },
  );

  // Past the threshold, with the finger still down.
  await expect(page.locator(".selection-handle")).toHaveCount(2);
  await expect(page.locator(".highlight-toolbar")).toHaveCount(0);

  await page.evaluate(
    ({ selector }) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement;
      const view = frame.contentWindow!;
      const box = frame.getBoundingClientRect();
      const Pointer = (view as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
      frame.contentDocument!.body.dispatchEvent(
        new Pointer("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: box.width / 2,
          clientY: box.height / 2,
        }),
      );
    },
    { selector: PAGE_FRAME },
  );

  await expect(page.locator(".highlight-toolbar")).toBeVisible();
});

test("dragging a handle extends the selection", async ({ page }) => {
  await longPressSelect(page);
  const washed = await page.locator(".selection-wash").count();

  // Driven with the real pointer rather than dispatched events, because the handle takes a
  // pointer capture on the way down and a capture cannot be taken of a pointer the browser does
  // not have. This is the same code path a finger takes; what it does not exercise is the
  // engine's own decision about whether that finger belonged to the page, which
  // `real-touch.spec.ts` covers for the gesture it matters to.
  const handle = (await page.locator('.selection-handle[data-end="end"]').boundingBox())!;
  const book = (await page.locator(".viewer-mount").boundingBox())!;

  const hitX = handle.x + handle.width / 2;
  const hitY = handle.y + handle.height / 2;

  // The press has to reach the handle, and on a phone the colour row is nearly the width of the
  // screen and lands over the passage — so this is also what holds the handles above it
  // (`styles/book.css`'s `.selection-layer`). Asserted rather than assumed: when it stops being
  // true the drag below silently becomes a tap on the row behind, which dismisses the selection
  // and fails somewhere that says nothing about why.
  const under = await page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.className ?? "",
    { x: hitX, y: hitY },
  );
  expect(under).toContain("selection-handle");

  await page.mouse.move(hitX, hitY);
  await page.mouse.down();
  // Along the line in a vertical book — downwards is further into the passage.
  await page.mouse.move(hitX, book.y + book.height - 24, { steps: 8 });
  await page.mouse.up();

  // At least as much of the page is washed as the word the press snapped, and the row is back.
  await expect.poll(() => page.locator(".selection-wash").count()).toBeGreaterThanOrEqual(washed);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();
});

test("a swipe away from the handles turns the page and takes the selection with it", async ({
  page,
}) => {
  // The rule this replaces read "a selection standing at the press means the page must not
  // move" — a compensation for not knowing where the finger had landed. The handles are ours
  // now and claim their own presses, so everywhere else is a page turn again.
  await longPressSelect(page);
  await expect(page.locator(".selection-handle")).toHaveCount(2);

  await dragPage(page, { dx: -(await farEnoughToTurn(page)) });
  await settled(page);

  await expect(page.locator(".selection-wash")).toHaveCount(0);
  await expect(page.locator(".highlight-toolbar")).toHaveCount(0);
});
