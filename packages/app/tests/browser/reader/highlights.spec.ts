// Highlights against a real layout: whether the boxes land beside the text they were drawn from,
// whether they travel with that text while a turn is carrying it, and whether they survive the
// three things that move it — a page turn, a reload, a reflow. The clipping and the strip
// geometry are exhausted in src/lib/highlights.test.ts; what no pure function has is rectangles
// frond measured and a CFI resolved against a fresh document.

// frond's own number, imported rather than copied: the gap is what decides how much of the next
// page fits inside this page's margin, and a copy would not break the day it changes.
import { COLUMN_GAP } from "@yurenju/frond/renderer";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  PAGE_FRAME,
  dragPage,
  farEnoughToTurn,
  openBook,
  openChrome,
  openPanel,
  pageOffset,
  readerFrame,
  releaseDrag,
  segment,
  selectVisibleText,
  settled,
  visibleText,
} from "../support/library.js";

/**
 * Highlights, end to end.
 *
 * This is the part of the migration with the most new code: frond draws no highlights, so the
 * overlay is spine's — `rectsFor()` for the geometry, the `layout` event for when it goes
 * stale, and a hit test against `pointerup` for tapping one open.
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

    // On-screen whichever stage placed it: beside the passage, or on the resting line near the
    // bottom edge when no side of the passage is clear (`lib/toolbar-position.ts`). A row that
    // is off the screen is a row with no colours the reader can press.
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

  // Narrow enough that the panel covers the book, which is the arrangement this pair of facts
  // only holds in: the panel has to leave for the passage to be seen, and the wash is then the
  // only thing left saying which passage it was. The suite's 1000px is over 820 now, where the
  // panel stands beside the book and stays — that case is its own describe further down.
  test.describe("in a window where the panel covers the book", () => {
    test.use({ viewport: { width: 700, height: 900 } });

    test("the quote in the notes panel takes the reader back to the passage", async ({ page }) => {
      // **The click has to survive the panel it is made in.** Base UI's drawer captures the
      // pointer for any press that does not land on something interactive, and a captured
      // pointer retargets the `click` to the panel itself — so a quote that was not a control
      // heard nothing, on a desk. Under a finger the same swipe takes no capture, which is why
      // this only ever failed with a mouse and why the spec drives one here.
      const text = await selectPassage(page);
      await page.locator(".highlight-toolbar .swatch").first().click();
      await expect(page.locator(".highlight-box").first()).toBeVisible();
      const marked = await visibleText(page);

      // Away from the marked page first, or landing on it would prove nothing.
      const before = await visibleText(page);
      await page.getByRole("button", { name: "Next page" }).click();
      await expect.poll(async () => await visibleText(page)).not.toBe(before);
      await expect(page.locator(".highlight-box")).toHaveCount(0);

      await openPanel(page, /Notes/);
      await page
        .getByTestId("panel-notes")
        .getByRole("button", { name: text.slice(0, 12), exact: false })
        .click();

      await expect.poll(async () => await visibleText(page)).toBe(marked);

      // **And the panel is gone**, because at this width it is drawn over the book — keeping it
      // would hide the passage the press was for, and leave the reader unable to turn away from
      // it, the page buttons being underneath (`lib/media.ts`).
      await expect(page.getByTestId("panel-notes")).toBeHidden();

      // **And the passage stays lit with nothing left holding it.** This is the half a pure
      // function cannot reach: `chrome.test.ts` says `selected` survives a panel that closed,
      // and what it cannot say is that the box is still painted on a page the browser laid out.
      // Without it the reader is put back on the right page with no answer to "which one".
      await expect(page.locator(".highlight-wash").first()).toBeVisible();
    });
  });

  test("the mark travels with its text while the page is being dragged", async ({ page }) => {
    // frond reports rectangles against the frame's *resting* place, and the layer is repainted
    // on `relocate`/`layout` — both of which arrive after the turn has landed. A mark left
    // sitting still over a page that is sliding away is the reader's whole complaint.
    const text = await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    const paragraphBefore = (await selectedElement(page, text).boundingBox())!;
    const markBefore = (await page.locator(".highlight-box").first().boundingBox())!;

    // Rightwards, because this book opens right-to-left: that is the direction that goes
    // forward, and the direction with a page on the other side to come in.
    await dragPage(page, { dx: await farEnoughToTurn(page), hold: true });

    const travelled = await pageOffset(page);
    expect(Math.abs(travelled), "the page is mid-turn").toBeGreaterThan(50);

    const paragraph = (await selectedElement(page, text).boundingBox())!;
    const mark = (await page.locator(".highlight-box").first().boundingBox())!;
    expect(paragraph.x - paragraphBefore.x, "the text moved with the finger").toBeCloseTo(
      travelled,
      0,
    );
    // Within a pixel of the text it belongs to: the mark is a fact about that passage, not a
    // decoration pinned to the viewer.
    expect(mark.x - markBefore.x, `mark=${rect(mark)} was=${rect(markBefore)}`).toBeCloseTo(
      travelled,
      0,
    );

    await releaseDrag(page);
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

// Wide enough that the panel stands beside the book instead of over it — the one arrangement
// where a note can be pressed and the passage still be looked at. The rest of this file runs at
// the config's 1000px, where the panel covers the page and pressing a quote closes it.
test.describe("a desk, where the book keeps a column beside the panel", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
  });

  // The one wire up to `lib/chrome.test.ts`'s lifecycle: that file walks every way out of the panel,
  // and what no pure function can say is that the pointed-at passage becomes ink on a page the
  // browser laid out. So this asks once, and only for the facts the reducer cannot reach — the
  // panel is still there to be read, something is drawn over the passage, and that ink outlives
  // the panel and dies on a page turn.
  test("pressing a quote keeps the list and fills in the passage it led to", async ({ page }) => {
    const text = await selectPassage(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    // Away from the marked page first, or landing on it would prove nothing.
    const before = await visibleText(page);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(async () => await visibleText(page)).not.toBe(before);

    await openPanel(page, /Notes/);
    await page
      .getByTestId("panel-notes")
      .getByRole("button", { name: text.slice(0, 12), exact: false })
      .click();

    // Still a list to work down, and one passage in it answered for. The wash comes from the
    // text's own rectangles rather than the strips beside them, so it is a different count from
    // `.highlight-box` — every mark on the page has one of those, marked or pressed.
    await expect(page.getByTestId("panel-notes")).toBeVisible();
    await expect(page.locator(".highlight-wash").first()).toBeVisible();

    // Said in the tree as well as in ink. The wash sits on an `aria-hidden` layer, so without
    // this a reader who cannot see the colour is told nothing at all about which quote they
    // pressed — the kind of gap nobody files a report about (ADR-0021).
    await expect(
      page.getByTestId("panel-notes").getByRole("button", { name: text.slice(0, 12) }),
    ).toHaveAttribute("aria-current", "true");

    // **Putting the list away does not take it with it**, and that is the half a screenshot
    // cannot show. The wash belongs to the passage the reader pressed, not to the panel they
    // pressed it in — on a narrow window closing the panel is the only way to look at the
    // passage at all, and one rule serves both widths (ADR-0044).
    await page.getByTestId("chrome-nav").getByRole("button", { name: /Notes/ }).click();
    await expect(page.getByTestId("panel-notes")).toBeHidden();
    await expect(page.locator(".highlight-wash").first()).toBeVisible();

    // Turning the page is what ends it: the reader has left the page the passage is on, so the
    // question it was answering has gone with them.
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator(".highlight-wash")).toHaveCount(0);
  });
});

/**
 * What the notes panel does with a mark that is longer than the panel.
 *
 * A prose Chinese book rather than the vertical one the rest of this file uses: the vertical
 * fixture is ruby-annotated, which chops its paragraphs into runs of a few characters, and this
 * needs one continuous passage long enough to overflow three lines in a column that is at most
 * 420px wide.
 */
test.describe("a mark longer than the panel", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.emphasis);
  });

  test("its quote in the notes panel stops at three lines", async ({ page }) => {
    // **The panel must not grow with the passage.** A mark is however much text the reader
    // dragged over, so one paragraph-long mark used to fill the whole column and a book with
    // six of them read as one wall of prose. The cut is in `styles/book.css`, and it is
    // geometry — how many lines a real font puts a real paragraph on, in a column whose width
    // comes from `--panel-width`. Nothing without a layout can answer that.
    //
    // The passage is taken from the page rather than from `selectVisibleText`, which returns
    // the first run of prose it finds and would leave the length of the thing under test to
    // chance.
    const phrase = await readerFrame(page)
      .locator("p")
      .evaluateAll(
        (ps) =>
          ps.map((p) => (p.textContent ?? "").trim()).sort((a, b) => b.length - a.length)[0] ?? "",
      );
    expect(
      phrase.length,
      "no paragraph here is long enough to overflow three lines",
    ).toBeGreaterThan(70);

    // Reopened with it selected, because `?select=` is read when a book opens (`lib/route.ts`).
    const bookId = new URL(page.url()).hash.slice("#/book/".length).split("?")[0];
    await page.goto(`/#/book/${bookId}?select=${encodeURIComponent(phrase)}`);
    await page.reload();
    await expect(page.locator('.reader[data-at="arrived"]')).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    await openPanel(page, /Notes/);
    // The span inside the button, which is where the clamp is: WebKit counts a button's own
    // content as one line item and clips nothing, so a clamp on the control does nothing there.
    const quote = page.getByTestId("panel-notes").locator(".annotation-quote-text").first();
    const measured = await quote.evaluate((el) => ({
      shown: el.getBoundingClientRect().height,
      whole: el.scrollHeight,
      line: parseFloat(getComputedStyle(el).lineHeight),
    }));

    expect(
      measured.whole,
      "the passage fits in three lines here, so the cut would prove nothing",
    ).toBeGreaterThan(measured.shown + 1);
    expect(Math.round(measured.shown / measured.line)).toBe(3);
    // Clipped for the eye only. Asserted on the accessible name rather than on the text in the
    // DOM, because that is the half that has to survive: a screen reader and `getByRole` alike
    // find this mark by the passage, and clipping must not take it out of the name.
    await expect(
      page.getByTestId("panel-notes").getByRole("button", { name: phrase, exact: false }),
    ).toBeVisible();
  });
});

test.describe("a wide margin, where the page and the container part company", () => {
  // The margin is what separates the two boxes, and one column at this viewport is what makes
  // it wide: the line-length ceiling (ADR-0012) hands the leftover to the margin, and the
  // leftover is large once a 1000px-wide screen carries a single 30-em line.
  //
  // Below that margin, the whole defect: pages are `COLUMN_GAP` apart, so everything in
  // the first `margin - gap` px of the next page sits **inside the container** while the reader
  // is still on this one. Clipping the highlight layer to the container therefore paints the
  // next page's marks in this page's margin, cut in half at the container's edge (#41).
  //
  // Only a real layout produces those two boxes at once, which is why this is here and not in
  // src/lib/highlights.test.ts — that one has the arithmetic, on the numbers measured here.
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    await openPanel(page, "Type");
    await segment(page, "setting-columns", 1).click();
    await page.keyboard.press("Escape");
    await settled(page);

    // **Into a chapter first, because the two pages have to be in one section.** The book
    // opens on its front matter, which is a single page — turning off it crosses into the next
    // section, and a highlight in a section that is not mounted comes back with no rectangles
    // at all. The clipping would then never be asked the question this test is about, and the
    // test would pass while proving nothing (it did, once).
    await openPanel(page, "Contents");
    await page
      .locator(".toc-item")
      .filter({ hasText: /Rabbit-Hole/ })
      .first()
      .click();
    // **Put [[Contents]] away before measuring anything.** A chapter pressed at this width leaves the
    // panel standing, and a standing panel is a column taken off the book — so the margin below
    // would be measured against a page laid out for a narrower reader than the one the test is
    // about. Pressing the entry again is what a reader would do to get their book back, and it
    // is clicked directly rather than through `openPanel`, which waits for a panel to arrive.
    await page.getByTestId("chrome-nav").getByRole("button", { name: "Contents" }).click();
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    await settled(page);
  });

  test("a mark on the next page is not painted in this page's margin", async ({ page }) => {
    const mount = (await page.locator(".viewer-mount").boundingBox())!;
    const frame = (await page.locator(PAGE_FRAME).last().boundingBox())!;
    const margin = mount.x + mount.width - (frame.x + frame.width);

    // The premise, asserted rather than assumed: with a margin no wider than the gap there is
    // nowhere for the next page to leak into, and this test would pass while saying nothing.
    expect(
      margin,
      "the margin has to be wider than frond's column gap for this to mean anything",
    ).toBeGreaterThan(COLUMN_GAP);

    // Forward to the first page of this chapter carrying prose, which is not always the second:
    // Alice's chapters open with a plate, and a page of picture has nothing to select. `before`
    // is the page immediately in front of it — the one the mark must not appear on.
    let before: string | undefined;
    for (let step = 0; step < 4 && before === undefined; step++) {
      const previous = await visibleText(page);
      await page.getByRole("button", { name: "Next page" }).click();
      await expect.poll(async () => await visibleText(page)).not.toBe(previous);
      await settled(page);
      if ((await visibleText(page)).trim().length > 8) before = previous;
    }

    // Asserted rather than left to fall through, for the same reason as the margin above: with
    // `before` never set, everything below would run against the wrong page and pass.
    expect(before, "no page of prose within four turns of the chapter's start").toBeDefined();

    await selectVisibleText(page);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    await page.locator(".highlight-toolbar .swatch").first().click();
    await expect(page.locator(".highlight-box").first()).toBeVisible();

    await page.getByRole("button", { name: "Previous page" }).click();
    await expect.poll(async () => await visibleText(page)).toBe(before);

    // **Every mark inside the page, and not "no marks at all".** A selection is a whole text
    // node, and a paragraph that has prose on the next page usually began on this one — so some
    // of it is legitimately still marked here, and how much differs per engine. What is never
    // legitimate is a mark outside the page: that stretch of container is margin, and the only
    // thing over there is the next page showing through the gap.
    const page1 = (await page.locator(PAGE_FRAME).last().boundingBox())!;
    for (const box of await page.locator(".highlight-box").all()) {
      const at = (await box.boundingBox())!;
      expect(at.x, `a mark at ${Math.round(at.x)} is past the page's right edge`).toBeLessThan(
        page1.x + page1.width,
      );
      expect(at.x + at.width, "and none starts before its left edge").toBeGreaterThan(page1.x);
    }
  });
});
