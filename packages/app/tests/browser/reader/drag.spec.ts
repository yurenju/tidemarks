// The drag as a gesture: the page travelling under the finger, the next one waiting behind it,
// and what letting go means either side of the threshold. The thresholds, the damping and the
// slop are arithmetic, exhausted in src/lib/touch.test.ts, and which page a direction asks for is
// src/lib/navigator.test.ts. Neither of them can say that anything moved.
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  dragPage,
  farEnoughToTurn,
  openBook,
  pageOffset,
  releaseDrag,
  settled,
  visibleFrames,
  visibleText,
} from "../support/library.js";

/**
 * Turning a page by dragging it (ADR-0024, docs/specs/swipe-to-turn/spec.md).
 *
 * This is the only way to turn a page by hand now, which is what makes the floor here so low:
 * if a drag stops turning pages, the book cannot be read on a phone at all. So what is pinned
 * is the whole gesture — the page moving under the finger, the page coming in behind it, the
 * threshold either side of which letting go means two different things, and the two ends of
 * the book where there is nothing to come in.
 *
 * The finger itself is synthetic (`dragPage`), and the one thing it cannot exercise is the
 * engine's implicit pointer capture. See that helper.
 */

test.use({ hasTouch: true });

test.describe("horizontal book", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
  });

  test("dragging left turns forward, and the page follows the finger while it does", async ({
    page,
  }) => {
    const before = await visibleText(page);
    const finger = -(await farEnoughToTurn(page));

    await dragPage(page, { dx: finger, hold: true });

    // The page has moved with the finger, and it has moved by about as much as the finger did
    // — the first ten pixels are the slop that decided this was a drag at all.
    const offset = await pageOffset(page);
    expect(offset).toBeLessThan(finger * 0.8);
    expect(offset).toBeGreaterThan(finger);
    // And the page coming in is on screen behind it. This is the whole of what the reader
    // asked for: they can see where they are going before they commit to it.
    expect(await visibleFrames(page)).toBe(2);

    await releaseDrag(page);
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    // Once it has landed, nothing is left displaced.
    await expect.poll(async () => await pageOffset(page)).toBe(0);
    await expect.poll(async () => await visibleFrames(page)).toBe(1);
  });

  test("dragging back the other way returns to the page just left", async ({ page }) => {
    const first = await visibleText(page);
    const finger = await farEnoughToTurn(page);

    await dragPage(page, { dx: -finger });
    await expect.poll(async () => await visibleText(page)).not.toBe(first);

    await dragPage(page, { dx: finger });
    await expect.poll(async () => await visibleText(page)).toBe(first);
  });

  test("a drag that did not get far enough goes back where it was", async ({ page }) => {
    // The other half of what a preview buys: having seen the next page, the reader can decide
    // against it. Slowly, so that it is the distance being judged and not the speed.
    const before = await visibleText(page);

    await dragPage(page, { dx: -60, ms: 600, steps: 6 });

    await expect.poll(async () => await pageOffset(page)).toBe(0);
    expect(await visibleText(page)).toBe(before);
  });

  test("a flick turns the page even though it barely moved", async ({ page }) => {
    // A thumb on a phone: 40px and gone. Distance alone refuses it, and refusing it is what
    // "I swiped and nothing happened" is made of — with no tap to fall back on (#61).
    //
    // This is the one spec here that is meant to ride on speed, so it is the one that cannot
    // take its distance from `farEnoughToTurn`. What keeps it honest instead is how `dragPage`
    // paces a flick: see the spin in that helper, and #15 for what a frame-paced one did.
    const before = await visibleText(page);

    await dragPage(page, { dx: -40, ms: 0, steps: 3 });

    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });

  test("the first page cannot be dragged back past the beginning", async ({ page }) => {
    // It moves, and it resists: something moved, so the book is not stuck; it fought back, so
    // this is the end. Nothing follows it, and the reader stays where they were.
    const before = await visibleText(page);

    await dragPage(page, { dx: 300, hold: true });

    // It moved, and it moved a good deal less than the finger did. The ceiling is a quarter of
    // the page, so the number itself belongs to whatever width the container happens to have —
    // what is pinned is that the page pushed back.
    const offset = await pageOffset(page);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(300 * 0.7);

    await releaseDrag(page);
    await expect.poll(async () => await pageOffset(page)).toBe(0);
    expect(await visibleText(page)).toBe(before);
  });

  test("a drag turns the page with the chrome up, and puts the chrome away", async ({ page }) => {
    // Dragging cannot be mistaken for "put this away", so it is not blocked while the bars are
    // up — and a page turn ends 〈找〉, whichever gesture asked for it.
    const before = await visibleText(page);
    const finger = -(await farEnoughToTurn(page));
    const box = (await page.locator(".viewer").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    await expect(page.getByTestId("chrome-bottom")).toBeVisible();

    await dragPage(page, { dx: finger });

    await expect(page.getByTestId("chrome-bottom")).toBeHidden();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });
});

test.describe("vertical book (直排)", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    await settled(page);
  });

  test("dragging right turns forward, because the book opens right-to-left", async ({ page }) => {
    // The inversion, seen from the gesture. The pages still move sideways — a 直排 book
    // paginates downwards inside its own document, and the reader must never be shown that
    // (frond ADR-0013).
    const before = await visibleText(page);

    await dragPage(page, { dx: await farEnoughToTurn(page) });

    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });

  test("and dragging left at the start of the book runs into the beginning", async ({ page }) => {
    const before = await visibleText(page);

    await dragPage(page, { dx: -300 });

    await expect.poll(async () => await pageOffset(page)).toBe(0);
    expect(await visibleText(page)).toBe(before);
  });
});
