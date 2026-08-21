import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  settled,
  waitForIndex,
} from "../support/library.js";

/**
 * The reader at a desk: one bar across the top, a panel that takes a column down the right, and
 * an axis that stays thin until a pointer asks for it.
 *
 * The suite's 1000×700 with a fine pointer is exactly the case this describes — a window wide
 * enough that the bottom edge is a journey, and a hand on a mouse. Its opposite number is
 * `hand-held.spec.ts` (ADR-0023).
 */
test.beforeEach(async ({ page }) => {
  await openBook(page, BOOKS.vertical);
});

test("puts the entries on the title's own row, not on a row of their own", async ({ page }) => {
  await openChrome(page);

  const nav = (await page.getByTestId("chrome-nav").boundingBox())!;
  const top = (await page.getByTestId("chrome-top").boundingBox())!;

  // One bar, read as one bar: same top edge, same bottom edge, entries to the right of the
  // title. Stacked, the two of them spent 92px saying four words and offering four doors.
  expect(Math.abs(nav.y - top.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(nav.y + nav.height - (top.y + top.height))).toBeLessThanOrEqual(1);
  expect(nav.x).toBeGreaterThanOrEqual(top.x + top.width - 1);
});

test("keeps the Scrubber on the bottom edge", async ({ page }) => {
  await openChrome(page);

  const scrubber = (await page.getByTestId("scrubber-track").boundingBox())!;
  expect(scrubber.y).toBeGreaterThan(700 - 80);
});

/**
 * **A rewritten guard.** This used to assert the chapter sat *above* the rail, which was the
 * arrangement when the two first moved onto one bar. It is below it now, and the reason is at
 * the other end of the app: the rail is the one of the pair a thumb drags, so the rail is the
 * one that has to leave the strip a phone's own gestures own
 * (docs/specs/reader-chrome-layers/spec.md). The desk keeps the same order as the phone rather
 * than branching, so this file asserts it too.
 *
 * What is still being guarded is unchanged in substance: the chapter belongs to the axis, not to
 * the title bar. Only the side of the axis it belongs to has moved.
 */
test("puts the chapter under the Scrubber rather than in the title bar", async ({ page }) => {
  // Jumped to a real chapter first, because the book opens on its cover and the cover is not in
  // any chapter — the label is absent there on purpose ("沒話說就不說"), so asserting against a
  // freshly opened book would be asserting against the empty case.
  await waitForIndex(page);
  await openPanel(page, "Contents");
  await page.getByTestId("panel-toc").locator(".toc-item").last().click();
  // The jump puts the chrome away and relays the book out. Raising the chrome again before that
  // has finished spends the click on a page that is still moving — which is a timeout on the two
  // engines slow enough to still be in it, and a pass on the one that is not.
  await settled(page);
  await openChrome(page);

  const chapter = (await page.getByTestId("reader-chapter").boundingBox())!;
  const scrubber = (await page.getByTestId("scrubber-track").boundingBox())!;
  const top = (await page.getByTestId("chrome-top").boundingBox())!;

  // "Which chapter" and "how far in" are one question asked two ways, so they are one bar. They
  // used to be at opposite edges of the screen, and on a phone the title bar holding both the
  // book and the chapter cut each of them in half.
  //
  // Under the rail, and against it: a chapter that drifted to its own end of the bar would be
  // back to being a second answer at a distance from the first.
  expect(chapter.y).toBeGreaterThan(scrubber.y);
  expect(chapter.y).toBeLessThan(scrubber.y + scrubber.height + 40);
  expect(chapter.y).toBeGreaterThan(top.y + top.height);
});

test("centres the chapter, and holds its line even where there is no chapter", async ({ page }) => {
  await openChrome(page);

  // Opened on the cover, which is in no chapter — so this is the empty case, and the assertion
  // is that it still occupies a line. Losing it takes a row off the bar and slides the rail back
  // towards the bottom edge, which is what the hand-held clearance depends on not happening.
  const chapter = page.getByTestId("reader-chapter");
  await expect(chapter).toHaveText("");

  const row = await chapter.evaluate((el) => ({
    align: getComputedStyle(el).textAlign,
    height: el.getBoundingClientRect().height,
  }));

  // Centred, because the Scrubber mirrors its head and tail for a vertical or RTL book
  // (ADR-0001): text flush to one edge under a rail that turns around picks a side the rail does
  // not keep.
  expect(row.align).toBe("center");
  expect(row.height).toBeGreaterThan(0);
});

test("opens the panel down the right side and leaves the book where it was", async ({ page }) => {
  await openChrome(page);
  const before = (await page.locator(".viewer").boundingBox())!;
  // The reader's own right edge, not the window's. `html` keeps a permanent scrollbar gutter so
  // that opening a drawer cannot shift the shelf sideways, and that gutter is 15px of the 1000.
  const reader = (await page.locator(".reader").boundingBox())!;

  await openPanel(page, "Contents");

  // Polled, because it arrives by transition: measured the instant it opens, a panel that slides
  // in from the right is still off the edge it came from. Flush with the reader's right edge,
  // whatever `--panel-width` happens to be — the number is CSS's, and a test that restates it is
  // only checking that two copies of it agree.
  const toc = page.getByTestId("panel-toc");
  await expect
    .poll(async () => {
      const box = (await toc.boundingBox())!;
      return Math.round(box.x + box.width);
    })
    .toBe(Math.round(reader.x + reader.width));

  // Covering, not pushing — at *this* width. 1000px is a window narrow enough that handing the
  // panel a column of its own would leave the book in a gutter, so the page keeps every pixel it
  // had and nothing repaginates. The other half of that trade is the next test, which opens the
  // same panel in a window wide enough to pay for it.
  await expect
    .poll(async () => Math.round((await page.locator(".viewer").boundingBox())!.width))
    .toBe(Math.round(before.width));
});

/**
 * The wide window, where the panel stops covering the page and stands beside it.
 *
 * A viewport of its own rather than the suite's 1000×700, because the threshold is the whole
 * point: at 1440 there is a book left over after the column is handed across, and at 1000 there
 * is not. Two tests, two windows, one rule — which is cheaper than one test that quietly stopped
 * describing either.
 */
test.describe("in a window wide enough to give up a column", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("buys the panel's column from the book", async ({ page }) => {
    await openChrome(page);
    const before = (await page.locator(".viewer").boundingBox())!;

    await openPanel(page, "Contents");

    const reader = (await page.locator(".reader").boundingBox())!;
    const toc = page.getByTestId("panel-toc");
    await expect
      .poll(async () => {
        const box = (await toc.boundingBox())!;
        return Math.round(box.x + box.width);
      })
      .toBe(Math.round(reader.x + reader.width));

    const panel = (await toc.boundingBox())!;

    // The book gives up **exactly** the panel's column. That is the price ADR-0026 asks for a
    // preview the reader can actually see — 〈排版〉 applies as it is dragged, and a panel over
    // the page hides the one surface it was opened to change.
    await expect
      .poll(async () =>
        Math.round(before.width - (await page.locator(".viewer").boundingBox())!.width),
      )
      .toBe(Math.round(panel.width));
  });

  /**
   * The reflow the reader can see, counted rather than described.
   *
   * frond repaginates off a `ResizeObserver`, so an animated `padding-right` was a full
   * pagination per frame and the text squeezed inwards for the length of the slide. The room is
   * given up in one step now, and moving between the three panels does not move the column at
   * all — so the book's box takes exactly one new width per open, and none per switch.
   */
  test("resizes the book once when the panel opens, and not at all when it switches", async ({
    page,
  }) => {
    await openChrome(page);

    const widths = page.evaluate(() => {
      const seen: number[] = [];
      const viewer = document.querySelector(".viewer")!;
      const observer = new ResizeObserver(() => {
        const w = Math.round(viewer.getBoundingClientRect().width);
        if (seen[seen.length - 1] !== w) seen.push(w);
      });
      observer.observe(viewer);
      return new Promise<number[]>((resolve) => {
        (window as unknown as { __done: () => void }).__done = () => {
          observer.disconnect();
          resolve(seen);
        };
      });
    });

    await openPanel(page, "Contents");
    await openPanel(page, /Notes/);
    await openPanel(page, "Type");
    await settled(page);

    await page.evaluate(() => (window as unknown as { __done: () => void }).__done());

    // The observe() call delivers the starting width, then the open delivers the narrowed one.
    // Three panels, one narrowing: the two switches cost nothing.
    expect(await widths).toHaveLength(2);
  });
});

/**
 * One press per panel, from any panel.
 *
 * The three used to be three drawers, exclusive in the reader's state but not in the DOM: the
 * one going out ran an `onClose` that did not ask whether it was still the one showing, and it
 * wrote the bare bar over the panel that had just opened. The reader pressed 筆記 while 排版
 * stood, watched the column close, and pressed 筆記 again.
 *
 * Written as a walk through all three rather than as the one pair that was reported, because the
 * bug had nothing to do with which two: any switch went through the same stale handler.
 */
test("switches straight from one panel to another", async ({ page }) => {
  await openPanel(page, "Type");
  await expect(page.getByTestId("panel-layout")).toBeVisible();

  await page.getByTestId("chrome-nav").getByRole("button", { name: /Notes/ }).click();
  await expect(page.getByTestId("panel-notes")).toBeVisible();
  await expect(page.getByTestId("panel-layout")).toBeHidden();

  await page.getByTestId("chrome-nav").getByRole("button", { name: "Contents" }).click();
  await expect(page.getByTestId("panel-toc")).toBeVisible();

  // And pressing the entry that is already showing still puts it away — the toggle is the same
  // toggle, it just no longer fires for a panel nobody asked to close.
  await page.getByTestId("chrome-nav").getByRole("button", { name: "Contents" }).click();
  await expect(page.getByTestId("panel-toc")).toBeHidden();
  await expect(page.getByTestId("chrome-nav")).toBeVisible();
});

test("leaves the Scrubber reachable beside an open panel", async ({ page }) => {
  await openPanel(page, "Contents");

  const panel = (await page.getByTestId("panel-toc").boundingBox())!;
  const scrubber = (await page.getByTestId("scrubber-track").boundingBox())!;

  // The bars end where the panel begins rather than running under it. Trading one way of asking
  // "where do I want to be" for the other is the thing this arrangement exists to avoid, and on
  // a desk there is room to keep both — which is why that rule is the desk's now
  // (docs/specs/ux-replan/spec.md).
  await expect
    .poll(async () => {
      const rail = (await page.getByTestId("scrubber-track").boundingBox())!;
      return rail.x + rail.width;
    })
    .toBeLessThanOrEqual(panel.x + 1);
  expect(scrubber.y).toBeGreaterThan(700 - 80);
});
