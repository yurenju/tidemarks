// The drag as a gesture, in three engines and on a real book. The thresholds, the damping and
// the slop are arithmetic, exhausted in src/lib/touch.test.ts; which page a direction asks for is
// src/lib/navigator.test.ts; and what a run of pointer events adds up to — when a drag begins,
// what it does to a selection, what letting go means either side of the threshold — is
// src/lib/gesture.test.ts. **None of those can say that anything moved**, which is the one angle
// left here and the reason each of these four is the only one of its kind.
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
 * This is the only way to turn a page by hand, which is what makes the floor here so low: if a
 * drag stops turning pages, the book cannot be read on a phone at all.
 *
 * The finger itself is synthetic (`dragPage`), and the one thing it cannot exercise is the
 * engine's implicit pointer capture. See that helper.
 */

test.use({ hasTouch: true });

test.describe("horizontal book", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
  });

  test("a flick turns the page even though it barely moved", async ({ page }) => {
    // Kept as its own spec because it rides on a different piece of code from every other drag:
    // the speed samples and the window they are measured over. Distance alone refuses 40px, and
    // refusing it is what "I swiped and nothing happened" is made of — with no tap to fall back
    // on (#61).
    //
    // What keeps it honest is how `dragPage` paces a flick: see the spin in that helper, and #15
    // for what a frame-paced one did.
    const before = await visibleText(page);

    await dragPage(page, { dx: -40, ms: 0, steps: 3 });

    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });

  test("the first page cannot be dragged back past the beginning", async ({ page }) => {
    // The ends of the book, which no unit test can show: it moves, and it resists. Something
    // moved, so the book is not stuck; it fought back, so this is the end.
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
    // up — and a page turn ends 〈找〉, whichever route asked for it. The rule itself is decided in
    // the machine and pinned for all three routes in src/lib/gesture.test.ts; this is the one
    // wiring test that says the bars really came down over a real book.
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

  test("carries the whole drag onto the screen of a book that declares it opens right-to-left", async ({
    page,
  }) => {
    // **The wiring test for the drag**, and the vertical book is the one to run it on because it
    // is the only place three separate answers have to arrive together: the threshold computed in
    // `touch.ts`, the inversion applied in `navigator.ts`, and the direction read out of a real
    // EPUB's package document. The same drag on the horizontal book would prove only the first.
    //
    // The pages still move sideways — a 直排 book paginates downwards inside its own document,
    // and the reader must never be shown that (frond ADR-0013).
    const before = await visibleText(page);
    const finger = await farEnoughToTurn(page);

    await dragPage(page, { dx: finger, hold: true });

    // The page has moved with the finger, and by about as much as the finger did — the first ten
    // pixels are the slop that decided this was a drag at all.
    const offset = await pageOffset(page);
    expect(offset).toBeGreaterThan(finger * 0.8);
    expect(offset).toBeLessThan(finger);
    // And the page coming in is on screen behind it. This is the whole of what the reader asked
    // for: they can see where they are going before they commit to it.
    expect(await visibleFrames(page)).toBe(2);

    await releaseDrag(page);
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    // Once it has landed, nothing is left displaced.
    await expect.poll(async () => await pageOffset(page)).toBe(0);
    await expect.poll(async () => await visibleFrames(page)).toBe(1);
  });
});
