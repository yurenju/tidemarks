// One wiring test for the line-length ceiling — the computed number reaching frond's own
// pagination — plus the angles no pure function has: the margin control, and an explicit
// two columns outliving the guess that would have said one. The rule's own arithmetic is
// exhausted in src/lib/line-length.test.ts and is not re-run here; which choices the panel
// takes away over a vertical book is reader/settings.spec.ts, alongside the other five.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openPanel, readerFrame, segment, settled } from "../support/library.js";

/**
 * The line-length ceiling, measured where it actually lands (ADR-0012).
 *
 * The arithmetic has unit tests; what those cannot reach is whether the number spine computes
 * survives the trip through `frondSettings` into frond's own pagination. The failure this
 * guards is silent — a margin on the wrong axis, or a column count frond quietly overrides,
 * still renders a readable page, just not the one that was asked for.
 *
 * **These resize the viewport**, which the rest of the suite deliberately does not: the
 * project's fixed 1000×700 is narrower than the ceiling, so nothing here would fire at it.
 * The sizes below are picked to sit either side of a threshold, and the assertions are
 * against the column box rather than against pixels of text, so they do not depend on the
 * font the container happens to have.
 *
 * The kept case is the vertical one because it carries the axis with it: the number and the
 * axis it lies along are the two things that can be lost on the way to the page, and a
 * horizontal case would only carry the first.
 */
/** The column geometry frond settled on, read from the document it laid out. */
async function columns(page: Page): Promise<{ count: number; emsPerColumn: number }> {
  return await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const root = body.ownerDocument.documentElement;
      const style = getComputedStyle(root);
      const em = Number.parseFloat(getComputedStyle(body).fontSize);
      return {
        count: Number.parseInt(style.columnCount, 10),
        emsPerColumn: Math.round(Number.parseFloat(style.columnWidth) / em),
      };
    });
}

test.describe("the line-length ceiling", () => {
  test("carries the computed ceiling onto the page, down the axis a vertical line runs", async ({
    page,
  }) => {
    // The wiring test for the whole rule. The axis is why this is the case worth keeping: a
    // vertical line runs down, so the ceiling is a height and the margin lands top and bottom.
    // Getting this backwards widens the gutter instead, with both layers still green.
    await openBook(page, BOOKS.vertical);

    await page.setViewportSize({ width: 1200, height: 1600 });
    await settled(page);
    expect(await columns(page)).toEqual({ count: 1, emsPerColumn: 40 });
  });

  test("honours two columns when the reader asks, even where the guess would not", async ({
    page,
  }) => {
    // The floor above is a guess for when nobody has said anything. This is someone saying
    // something, and spine does not overrule it.
    await openBook(page, BOOKS.horizontal);
    await page.setViewportSize({ width: 900, height: 800 });
    await settled(page);
    expect((await columns(page)).count).toBe(1);

    // 欄數 is one of the six, and all six are in the reader's own 〈排版〉 panel now (ADR-0026).
    await openPanel(page, "Type");
    await segment(page, "setting-columns", 2).click();
    await page.keyboard.press("Escape");
    await settled(page);

    expect((await columns(page)).count).toBe(2);
  });
});

/**
 * The margin and the column count take a different route out of the controls from every other
 * setting: frond asks for them at each layout (`resolveLayout`), reading spine's settings
 * through a ref. So **frond cannot see that they changed** — moving the control produces no
 * patch it can compare against, and what re-applies them is `relayout()`.
 *
 * That is a real trapdoor: forget the call and the control goes quiet, with every other setting
 * still working. Nothing else in the suite touches the margin control, so these two are it.
 */
test.describe("the typography sheet", () => {
  /** Where the iframe sits in its container, which is where the margin actually lands. */
  async function inset(page: Page): Promise<{ x: number; y: number }> {
    return await page
      .locator(".viewer-mount iframe[data-frond-page]")
      .last()
      .evaluate((frame) => ({
        x: (frame as HTMLIFrameElement).offsetLeft,
        y: (frame as HTMLIFrameElement).offsetTop,
      }));
  }

  async function chooseMargin(page: Page, value: string): Promise<void> {
    await openPanel(page, "Type");
    await segment(page, "setting-margin", value).click();
    await page.keyboard.press("Escape");
    await settled(page);
  }

  test("moving the margin control moves the layout", async ({ page }) => {
    // At this size the ceiling does not bite, so the reader's own number is the whole answer
    // and it should show up in the inset unchanged.
    await openBook(page, BOOKS.horizontal);
    await page.setViewportSize({ width: 1000, height: 700 });
    await settled(page);

    // That premise, asserted rather than left in the sentence above: two columns, each of them
    // shorter than the 30-em ceiling, is what "does not bite" means. It is worth stating because
    // a box narrow enough to reach the ceiling reads as a *wrong margin* below rather than as a
    // wrong box — #174 measured one panel-close transition's worth of narrower and reported the
    // 16px margin as an inset of 91.
    const under = await columns(page);
    expect(under.count).toBe(2);
    expect(under.emsPerColumn).toBeLessThan(30);

    await chooseMargin(page, "16");
    expect(await inset(page)).toMatchObject({ x: 16 });

    await chooseMargin(page, "48");
    expect(await inset(page)).toMatchObject({ x: 48 });
  });

  test("and lands it on the other pair of edges in a vertical book", async ({ page }) => {
    // The same one number, on the axis the line lies along. This is the claim `resolveLayout`
    // exists for — it is answered from the writing mode frond read, not from a guess.
    await openBook(page, BOOKS.vertical);
    await page.setViewportSize({ width: 1000, height: 700 });
    await settled(page);

    await chooseMargin(page, "48");

    // Vertical: the reader's margin is the top and bottom inset; the left and right keep the
    // fixed block inset instead.
    expect(await inset(page)).toMatchObject({ y: 48, x: 16 });
  });
});
