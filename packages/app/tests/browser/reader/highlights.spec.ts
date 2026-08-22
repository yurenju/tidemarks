import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  readerFrame,
  selectVisibleText,
  settled,
  visibleText,
} from "../support/library.js";

/**
 * Highlights, end to end.
 *
 * This is the part of the migration with the most new code: frond draws no highlights, so the
 * overlay is spine's — `rectsFor()` for the geometry, the `layout` event for when it goes
 * stale, and a hit test against `pointerup` for tapping one open. The clipping arithmetic is
 * unit-tested in Node; what only a browser can answer is whether the boxes land **on the text
 * they were drawn from**, and whether they survive the things that move the text.
 */

/** Selects a run of visible prose and waits for the toolbar that selection raises. */
async function selectPassage(page: import("@playwright/test").Page): Promise<string> {
  const text = await selectVisibleText(page);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();
  return text;
}

/** The element the selected text lives in, for comparing against where the boxes landed. */
function selectedElement(page: import("@playwright/test").Page, text: string) {
  return readerFrame(page).getByText(text.slice(0, 12), { exact: false }).first();
}

/** A rectangle, short enough to put several of them in one failure message. */
function rect(box: { x: number; y: number; width: number; height: number }): string {
  return `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`;
}

test.describe("drawing a highlight", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
  });

  test("the toolbar appears next to the selection, inside the viewport", async ({ page }) => {
    await selectPassage(page);

    const toolbar = (await page.locator(".highlight-toolbar").boundingBox())!;
    const viewport = page.viewportSize()!;

    // The whole point of anchoring to the selection instead of pinning to the bottom of the
    // screen: Android Chrome's native contextual-search bar occupies that strip and cannot be
    // measured from JS (`lib/toolbar-position.ts`).
    expect(toolbar.x).toBeGreaterThanOrEqual(0);
    expect(toolbar.y).toBeGreaterThanOrEqual(0);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(viewport.width);
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(viewport.height);
  });

  test("choosing a colour paints a mark beside the selected text, never across it", async ({
    page,
  }) => {
    const text = await selectPassage(page);
    const paragraph = (await selectedElement(page, text).boundingBox())!;

    await page.locator(".highlight-toolbar .swatch").first().click();

    const boxes = page.locator(".highlight-box");
    await expect(boxes.first()).toBeVisible();

    // **Beside, and close.** A mark is drawn outside the outermost ink on its line (ADR-0032),
    // so a box that overlapped the paragraph would be the old bug — the wave crossing the
    // glyphs. Being near it is the other half, and it is the half that catches a
    // coordinate-system mistake: frond reports rectangles relative to its container with the
    // margin added back, and getting that wrong shifts the whole layer by the margin.
    //
    // The book here is vertical, so the mark runs down the right of the column and the two
    // still share a span of y. `NEARBY` is generous on purpose: how far out the mark sits
    // depends on the ruby on each line, and this is not the test that pins that number.
    const NEARBY = 60;
    for (const box of await boxes.all()) {
      const rect = (await box.boundingBox())!;
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x, "the mark is outside the text it marks").toBeGreaterThanOrEqual(
        paragraph.x + paragraph.width - 1,
      );
      expect(rect.x, "and not adrift from it").toBeLessThan(paragraph.x + paragraph.width + NEARBY);
      expect(rect.y + rect.height).toBeGreaterThan(paragraph.y);
      expect(rect.y).toBeLessThan(paragraph.y + paragraph.height);
    }
  });

  test("the highlight is counted on the notes button", async ({ page }) => {
    await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();

    // Behind the chrome, which is where every control in the reader lives now.
    await openChrome(page);
    await expect(page.getByRole("button", { name: /Notes \(1\)/ })).toBeVisible();
  });

  test("it disappears when the page turns away, and comes back", async ({ page }) => {
    // frond returns real geometry for a position on another page — a large or negative
    // coordinate — and leaves the clipping to us. Painting it unconditionally would leave a
    // highlight floating over the wrong page.
    await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    const before = await visibleText(page);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    await expect(page.locator(".highlight-box")).toHaveCount(0);

    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();
  });

  test("it survives a reload", async ({ page }) => {
    await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    await page.reload();
    await expect(page.locator(".reader")).toBeVisible();
    await settled(page);
    // Stored as a CFI and resolved again against a freshly laid out document — the round trip
    // the whole annotation model rests on.
    await expect(page.locator(".highlight-box").first()).toBeVisible({ timeout: 30_000 });
  });

  test("it follows the text when the font size changes", async ({ page }) => {
    // The `layout` event's reason for existing: a settings change moves every rectangle without
    // moving the reader, so a layer that only recomputed on a page turn would be left behind.
    const text = await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    const first = (await page.locator(".highlight-box").first().boundingBox())!;

    await openPanel(page, "Type");
    await page.getByTestId("setting-font-size").fill("160");
    await page.keyboard.press("Escape");

    // **Both rectangles are measured inside the poll, every round.** The reflow at 160% moves
    // the paragraph through a sequence of intermediate positions, and any reading taken from
    // outside the poll freezes one of them: the comparison then runs forever against a place
    // the text was passing through, which no later round can satisfy. That is not slowness and
    // no timeout is long enough for it.
    //
    // This test has been red twice for that one mistake, in two disguises. #146 caught the
    // paragraph mid-reflow with no layout box at all and read `.x` off null. #171 caught it
    // with a box, at an intermediate position, and spent the whole poll comparing against it —
    // on a runner with one worker, so nothing was busy. Measured against today's code the
    // difference is stark: hoisting the paragraph back out of the poll fails 25 runs in 100 in
    // Firefox (15 in 40 with a single worker), while the shape below is green in 500, and the
    // predicate becomes true in under 700ms — 1.6s with the container held to one core.
    //
    // So a red here is a claim about the product, not about the clock. The poll answers with a
    // sentence saying which half is wrong, because `false` was what made the last one take a
    // download of the CI artifact to read.
    const FOLLOWED = "the box moved and is over the paragraph";
    await expect
      .poll(async () => {
        const paragraph = await selectedElement(page, text).boundingBox();
        const box = await page.locator(".highlight-box").first().boundingBox();
        if (paragraph === null || box === null) return "mid-reflow: one of the two has no box";
        // Still beside the paragraph, and no longer where it was — the text reflowed, and the
        // layer moved with it rather than staying put. Beside rather than over: the mark is
        // drawn outside the line's ink now (ADR-0032).
        const overlaps =
          box.x + box.width > paragraph.x &&
          box.x < paragraph.x + paragraph.width + 60 &&
          box.y + box.height > paragraph.y &&
          box.y < paragraph.y + paragraph.height;
        const moved = box.y !== first.y || box.x !== first.x || box.height !== first.height;
        const where = `box=${rect(box)} paragraph=${rect(paragraph)} before=${rect(first)}`;
        if (!overlaps) return `the box is not over the paragraph — ${where}`;
        if (!moved) return `the box is where it was before the change — ${where}`;
        return FOLLOWED;
      })
      .toBe(FOLLOWED);
  });

  test("tapping the marked text opens its note instead of turning the page", async ({ page }) => {
    // The overlay takes no pointer events (it would swallow the taps that turn the page), so
    // this goes through frond's `pointerup` and spine's own hit test.
    //
    // **The tap goes on the text, not on the mark.** Those are two different sets of boxes
    // now: what is painted is the strip of wave beside the line, and what answers a tap is the
    // text itself — including the ruby annotation and any indent, which carry no mark and are
    // still part of the passage the reader marked (ADR-0032).
    const text = await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();
    const box = (await selectedElement(page, text).boundingBox())!;

    const before = await visibleText(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByTestId("panel-notes")).toBeVisible();
    await expect(page.locator(".note-editor textarea")).toBeVisible();
    expect(await visibleText(page)).toBe(before);
  });
});
