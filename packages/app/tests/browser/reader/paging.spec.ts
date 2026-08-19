import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  pageOffset,
  progressPercent,
  readerFrame,
  settled,
  traceTurn,
  visibleFrames,
  visibleText,
  waitForIndex,
} from "../support/library.js";

/**
 * Opening a book and turning pages, in all three engines.
 *
 * This is the migration's floor: every claim here was true on epub.js and has to still be true
 * on frond, and none of it is provable from a unit test — direction inversion is pure logic and
 * is tested in Node, but "the page actually moved" is not.
 */

test.describe("vertical book (直排)", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
  });

  test("lays out vertically, which is what every direction decision hangs off", async ({
    page,
  }) => {
    // Decided by the CSSOM inside the iframe rather than by reading the book's CSS as text:
    // this book declares the mode on <body>, and spine used to have to promote it onto <html>
    // itself for epub.js to notice.
    const writingMode = await readerFrame(page)
      .locator("body")
      .evaluate((body) => getComputedStyle(body.ownerDocument.documentElement).writingMode);

    expect(writingMode).toBe("vertical-rl");
  });

  test("the left page button turns forward, because the book opens right-to-left", async ({
    page,
  }) => {
    const before = await visibleText(page);
    expect(before).not.toBe("");

    await page.getByRole("button", { name: "下一頁" }).click();

    // The button is labelled by what it does, not by where it points — so asserting on the
    // accessible name and on the text moving together is what pins the inversion.
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });

  test("the right page button turns back to where it was", async ({ page }) => {
    const first = await visibleText(page);
    await page.getByRole("button", { name: "下一頁" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(first);

    await page.getByRole("button", { name: "上一頁" }).click();
    await expect.poll(async () => await visibleText(page)).toBe(first);
  });

  test("the arrow keys turn pages with focus outside the book", async ({ page }) => {
    // Two halves: frond forwards the keys pressed inside the iframe (where the outer document
    // receives nothing), and spine listens on the document for the rest. This exercises the
    // second half.
    await page.getByRole("button", { name: "上一頁" }).focus();
    const before = await visibleText(page);

    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });

  test("and go on turning once the reader has touched the book", async ({ page }) => {
    // The other half: a click on the page puts the focus inside the iframe, and from there the
    // outer document receives nothing — every press has to come back through frond.
    //
    // **The second press is what this is for.** Turning the page hands the reader's frame to the
    // one that was waiting beside it, so a focus left where it was ends up on the page behind
    // them, and the book sits still under every press after the first.
    const box = (await page.locator(".viewer").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    for (const turn of [1, 2, 3]) {
      const before = await visibleText(page);
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(async () => await visibleText(page), { message: `turn ${turn}` })
        .not.toBe(before);
    }
  });

  test("a swipe leftward turns back, mirroring the horizontal case", async ({ page }) => {
    const before = await visibleText(page);
    const box = (await page.locator(".viewer").boundingBox())!;

    // Started in the middle so the whole 120px stays on the page. Where it starts no longer
    // keeps it from being read as a tap — both halves turn now — but its length does: 120px
    // is a swipe, and `isTap` stops at 10.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // On a right-opening book, dragging the page leftward pulls the *previous* page in. At the
    // very start of the book there is nowhere to go back to, so the text must not move.
    expect(await visibleText(page)).toBe(before);
  });
});

test.describe("horizontal book", () => {
  test("turns forward with the right-hand button", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);

    const before = await visibleText(page);
    await page.getByRole("button", { name: "下一頁" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
  });
});

/**
 * A turn nobody dragged still slides (docs/specs/desktop-page-turn/spec.md).
 *
 * What this pins is the half a reader on a desktop had no way to see: which direction the book
 * just went. Two pages of one book look alike, so a turn that happens between two frames carries
 * no direction at all — forward and back were the same event. Asserting on the sign of the
 * movement is asserting on exactly the fact that was missing.
 */
test.describe("a turn asked for by a button", () => {
  test("slides the page away and brings the next one in behind it", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);

    // The first turn of a session is thrown away: until the neighbouring frames have laid out
    // there is nothing to slide in, and that turn deliberately falls back to switching outright
    // (`hasPreview`). `turn-pacing.spec.ts` discards its first turn for the same reason.
    const before = await visibleText(page);
    await page.getByRole("button", { name: "下一頁" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    await expect.poll(async () => await pageOffset(page)).toBe(0);

    const middle = await visibleText(page);
    const trace = await traceTurn(page, async () => {
      await page.getByRole("button", { name: "下一頁" }).click();
    });

    // It travelled, rather than being replaced in place — several frames of it, not one.
    expect(trace.offsets.filter((offset) => offset !== 0).length).toBeGreaterThan(2);
    // And it travelled *leftwards*: a left-opening book's next page comes in from the right, so
    // the page being left slides off towards the left. This is the assertion carrying the whole
    // point — the reverse sign is what turning back looks like.
    expect(Math.min(...trace.offsets)).toBeLessThan(-50);
    // The page arriving was on screen behind it the whole way, which is what makes it a turn
    // rather than a page sliding off into nothing.
    expect(Math.max(...trace.frames)).toBe(2);

    // And it landed: one frame again, nothing displaced, a different page.
    await expect.poll(async () => await visibleText(page)).not.toBe(middle);
    await expect.poll(async () => await pageOffset(page)).toBe(0);
    await expect.poll(async () => await visibleFrames(page)).toBe(1);
  });

  test("and slides the other way on a right-opening book", async ({ page }) => {
    // The inversion, seen from the animation. `edgeFor` takes the edge from the book here —
    // there is no finger to take it from, which is the one thing separating this path from a
    // drag (`navigator.ts`).
    await openBook(page, BOOKS.vertical);
    await settled(page);

    const before = await visibleText(page);
    await page.getByRole("button", { name: "下一頁" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    await expect.poll(async () => await pageOffset(page)).toBe(0);

    const trace = await traceTurn(page, async () => {
      await page.getByRole("button", { name: "下一頁" }).click();
    });

    expect(Math.max(...trace.offsets)).toBeGreaterThan(50);
    expect(Math.min(...trace.offsets)).toBeGreaterThanOrEqual(0);
  });

  test("the end of the book pushes back instead of doing nothing", async ({ page }) => {
    // A button that does nothing at all cannot be told from a book that has stopped working —
    // the same question the drag answers with a damped rubber band. Here it is a nudge out and
    // back, and the reader stays where they were.
    await openBook(page, BOOKS.horizontal);
    const before = await visibleText(page);

    const trace = await traceTurn(page, async () => {
      await page.getByRole("button", { name: "上一頁" }).click();
    });

    // It moved — towards the right, because the page it is pretending to fetch is behind it.
    expect(Math.max(...trace.offsets)).toBeGreaterThan(0);
    // A nudge, not a turn: nothing came in behind it, and it came straight back.
    expect(Math.max(...trace.frames)).toBe(1);
    expect(await pageOffset(page)).toBe(0);
    expect(await visibleText(page)).toBe(before);
  });
});

/**
 * Turns forward `count` times, waiting for each turn to land before asking for the next.
 *
 * **The waiting is the point.** A click starts a turn rather than completing one — the page
 * slides (`docs/specs/desktop-page-turn/spec.md`) — so a loop of bare clicks leaves the last one
 * still in flight, and the text read straight afterwards is a page behind what the app has
 * already committed and written down. A spec that then reloads and asks for that text back is
 * asking for a position the reader was never left at.
 *
 * Both conditions, the same pair the turn specs above use: the text changed, and the page is
 * back at rest. The first alone lands mid-slide.
 *
 * This raced from the day turns were animated. It only ever lost once two specs ran at the same
 * time — which is to say it was invisible for exactly as long as CI ran one worker.
 */
async function turnForward(page: Page, count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    const before = await visibleText(page);
    await page.getByRole("button", { name: "下一頁" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    await expect.poll(async () => await pageOffset(page)).toBe(0);
  }
}

test.describe("progress", () => {
  test("reports a position once the whole-book index is built", async ({ page }) => {
    // frond builds the index in the background after the first page is on screen, and reports
    // `fraction` as undefined until then. Drawing a 0% would be a lie about where the reader is,
    // which is what the Scrubber stays disabled for.
    await openBook(page, BOOKS.vertical);
    await waitForIndex(page);
    await openChrome(page);

    await expect(page.getByTestId("scrubber-track")).toHaveAttribute("aria-disabled", "false");
    expect(await progressPercent(page)).toBeGreaterThanOrEqual(0);
  });

  test("restores the reading position after a reload", async ({ page }) => {
    // The bug this replaces (#29): the position was restored
    // and then a settings effect reflowed the book, dropping the reader at the section start.
    // frond takes the settings and the start position in one call, so there is no second layout.
    await openBook(page, BOOKS.vertical);
    await waitForIndex(page);

    await turnForward(page, 4);
    const resting = await visibleText(page);
    expect(resting).not.toBe("");

    await page.reload();
    await expect(page.locator(".reader")).toBeVisible();
    await settled(page);
    await expect.poll(async () => await visibleText(page), { timeout: 30_000 }).toBe(resting);
  });

  test("restores it at a large font size too", async ({ page }) => {
    // The size mattered in the old failure: a bigger size means more pages per section, so a
    // reflow after the restore had further to drift.
    await openBook(page, BOOKS.vertical);
    await openPanel(page, "排版");
    await page.getByTestId("setting-font-size").fill("190");
    await page.keyboard.press("Escape");

    // The size change reflows the book, and a turn asked for before that has finished is a turn
    // across a layout about to be replaced.
    await settled(page);

    await turnForward(page, 3);
    const resting = await visibleText(page);

    await page.reload();
    await expect(page.locator(".reader")).toBeVisible();
    await settled(page);
    await expect.poll(async () => await visibleText(page), { timeout: 30_000 }).toBe(resting);
  });
});
