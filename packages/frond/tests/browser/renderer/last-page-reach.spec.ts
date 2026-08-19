import { expect, test } from "../support/fixtures.js";
import { openHarness, type MountOptions, type Snapshot } from "../support/harness.js";

/**
 * The last page of a section the document cannot scroll far enough to reach.
 *
 * Two columns, and a section whose text ends in the first of them: the content reaches into
 * that last page, so it is counted, but the document only extends half a page past the one
 * before it. Asked to bring the last page to the head of the screen, the browser stops at
 * `scrollWidth - clientWidth` and lands **half a stride short** — and half a stride is
 * exactly the distance at which "which page is this" stops having a safe answer.
 *
 * ## Why the shortfall is always half a stride, and why that is the whole problem
 *
 * The document's length runs to the end of the last *column box*, not to the end of the
 * text in it. So a last page holding one column of two overshoots the page before it by
 * `columnWidth`, which is `(inlineSize - gap) / 2`, and the scroll ceiling therefore falls
 * short of the last page's position by `stride / 2` to the pixel.
 *
 * `pageAt` rounds to nearest, so that lands precisely on the tie. Which side it falls is
 * decided by the last bits of the scroll position: at integer DPI the browser clamps to a
 * whole pixel, the tie rounds up, and everything works. At 1.5 the clamp lands two thirds
 * of a pixel lower, the tie rounds *down*, and the page number comes back one short of the
 * last page forever. The consumer turns forward, nothing moves, and the section can never
 * be left (#96, found on 笑傲江湖's 【八】面壁 in a 1909×1167 window at 150% scale).
 *
 * That is why the second test below puts the scroll position there by hand rather than
 * waiting for an engine to do it: **the browsers in this suite never land on the losing
 * side of the tie by themselves**, at either scale factor Playwright can emulate, so a test
 * that only turned pages would stay green through the whole defect. The offset it uses is
 * the one measured on the reader's machine.
 */

/** Wide enough for `"auto"` to give two columns, which is the shape the defect needs. */
const VIEWPORT = { width: 800, height: 600 };

// A paragraph of the same shape as the book this was found in: CJK text, no spaces, so the
// engines break it at almost any character and the fill of the last column is decided by
// the paragraph count rather than by where a word happens to end.
const PARAGRAPH =
  "令狐冲在崖上等待小師妹的倩影可是每次見到的若非空山寂寂便是陸大有快步上崖的形相。".repeat(3);

const SECOND_SECTION = section("<p>次の節。</p>");

function section(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-TW">
  <head><title>t</title></head>
  <body>${body}</body>
</html>`;
}

function sectionOf(paragraphs: number): string {
  return section(Array.from({ length: paragraphs }, () => `<p>${PARAGRAPH}</p>`).join(""));
}

type TestPage = Parameters<typeof openHarness>[0];

async function mount(page: TestPage, paragraphs: number): Promise<Snapshot> {
  return page.evaluate(
    ([sections, options]) =>
      window.frond.mountInline(sections as readonly string[], options as MountOptions),
    [
      [sectionOf(paragraphs), SECOND_SECTION],
      { settings: { columns: 2 }, viewport: VIEWPORT },
    ] as const,
  );
}

/** What the document can scroll, and where the last page would begin. */
async function scrollGeometry(
  page: TestPage,
  pageCount: number,
): Promise<{ readonly maxOffset: number; readonly lastPageOffset: number }> {
  return page.evaluate((count) => {
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-frond-page]");
    const root = frame?.contentDocument?.documentElement ?? undefined;
    if (root === undefined) throw new Error("no section is mounted");

    const stride = root.clientWidth + 40;
    return {
      maxOffset: root.scrollWidth - root.clientWidth,
      lastPageOffset: (count - 1) * stride,
    };
  }, pageCount);
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test("a section whose last page holds one column still turns into the next section", async ({
  page,
}) => {
  // A range rather than one length: which paragraph count leaves the last page half full
  // depends on the engine's line breaking, and no single number is that shape in all three.
  const lengths = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const unreachable: number[] = [];

  for (const paragraphs of lengths) {
    const start = await mount(page, paragraphs);
    const { maxOffset, lastPageOffset } = await scrollGeometry(page, start.pageCount);
    if (lastPageOffset > maxOffset) unreachable.push(paragraphs);

    let at = start;
    for (let turn = 0; turn <= start.pageCount + 1 && at.sectionIndex === 0; turn += 1) {
      at = await page.evaluate(() => window.frond.next());
    }
    expect(at.sectionIndex, `${paragraphs} paragraphs never left the first section`).toBe(1);
  }

  // Without at least one length in that shape this test asserts nothing about the defect —
  // it would go green on the day the arithmetic breaks again, having never built the case.
  expect(
    unreachable.length,
    "no length produced a last page past the scroll ceiling",
  ).toBeGreaterThan(0);
});

test("scrolled to the end but a fraction of a pixel short of it is still the last page", async ({
  page,
}) => {
  // The measured shortfall on the reader's machine: 31795.334 against a ceiling of 31796,
  // which is one device pixel at 150% scale. Anything under a whole pixel is the same
  // ailment; the value is named here so the number has a source.
  const DEVICE_PIXEL_AT_150_PERCENT = 2 / 3;

  const lengths = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  let tested = 0;

  for (const paragraphs of lengths) {
    const start = await mount(page, paragraphs);
    const { maxOffset, lastPageOffset } = await scrollGeometry(page, start.pageCount);
    if (lastPageOffset <= maxOffset) continue;
    tested += 1;

    // To the end of the section, then down to where a fractional device pixel would clamp.
    for (let turn = 0; turn < start.pageCount - 1; turn += 1) {
      await page.evaluate(() => window.frond.next());
    }
    await page.evaluate((shortfall) => {
      const root =
        document.querySelector<HTMLIFrameElement>("iframe[data-frond-page]")?.contentDocument
          ?.documentElement;
      if (root === undefined || root === null) throw new Error("no section is mounted");
      root.scrollLeft = root.scrollWidth - root.clientWidth - shortfall;
    }, DEVICE_PIXEL_AT_150_PERCENT);

    const after = await page.evaluate(() => window.frond.next());
    expect(
      after.sectionIndex,
      `${paragraphs} paragraphs: a page turn from the clamped position went nowhere`,
    ).toBe(1);
  }

  expect(tested, "no length produced a last page past the scroll ceiling").toBeGreaterThan(0);
});
