// Typography as one record shared by every book, and the keyboard contract of the controls that
// set it. The record's own shape, its migrations and what frond is handed are exhausted in
// src/lib/settings.test.ts; leaving one book and opening another, and a `radiogroup` really
// answering the arrow keys, are things a pure function has no form for.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openPanel, segment, settled, stepTo, stepValue } from "../support/library.js";

/**
 * Typography is **one layer**: six settings, one record, every book (ADR-0005).
 *
 * The claim worth a real browser is the one a unit test cannot make — that a change made inside
 * one book is still there inside the next one, across leaving the reader and coming back. That
 * round trip is the whole of what the storage layer is for, and it is exactly what the old
 * two-layer model got backwards: adjusting a book used to claim the value for that book alone.
 *
 * Two books have to be in the shelf at once, so these import both rather than using `openBook`.
 */
const TITLES = { vertical: "草枕", horizontal: "Alice" };

async function importBoth(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept=".epub"]')
    .setInputFiles([BOOKS.vertical, BOOKS.horizontal]);
  for (const title of Object.values(TITLES)) {
    await expect(page.locator(`.book-cover[title*="${title}"]`)).toBeVisible({ timeout: 30_000 });
  }
}

async function open(page: Page, title: string): Promise<void> {
  await page.locator(`.book-cover[title*="${title}"]`).click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
  await openPanel(page, "Type");
}

async function leave(page: Page): Promise<void> {
  // Escape rather than a press outside: the panel leaves the bar it rose from live underneath,
  // so there is no one backdrop that covers the whole screen to aim at any more.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "‹ Shelf" }).click();
  // The shelf's own control, not the wall of covers: the book just read is now the large one at
  // the top, and with two books on the shelf the wall behind it can be down to nothing.
  await expect(page.getByTestId("shelf-order")).toBeVisible();
}

// By `data-testid`, not by role or by shape. The Scrubber is a `slider` too, the three settings
// that show every option are each a `radiogroup` of identical-looking tiles — `segment()` reaches
// one of those by the value it sets — and the two scales are each a `spinbutton`.
const fontSize = (page: Page) => page.getByTestId("setting-font-size");
const lineHeight = (page: Page) => stepValue(page, "setting-line-height");
const reset = (page: Page) => page.getByTestId("setting-reset");

test.describe("typography, one layer", () => {
  test("a size set in one book is the size the next book opens at", async ({ page }) => {
    await importBoth(page);

    await open(page, TITLES.vertical);
    await fontSize(page).fill("170");
    await leave(page);

    // The inversion this change is for. Under the two-layer model Alice would have opened at
    // the untouched default here, and the reader would have had to set 170 again.
    await open(page, TITLES.horizontal);
    await expect(fontSize(page)).toHaveValue("170");
  });

  test("every item travels, not just the last one touched", async ({ page }) => {
    await importBoth(page);

    await open(page, TITLES.horizontal);
    // The third rung of `LINE_HEIGHTS`, which is 1.8. A stepper publishes where it is on the
    // ladder rather than the multiplier underneath, so that is what travels and what is read
    // back (ADR-0050).
    await stepTo(page, "setting-line-height", 3);
    await fontSize(page).fill("160");
    await leave(page);

    await open(page, TITLES.vertical);
    await expect(fontSize(page)).toHaveValue("160");
    await expect(lineHeight(page)).toHaveAttribute("aria-valuenow", "3");
  });

  test("Columns is taken away over a vertical book and offered over a horizontal one", async ({
    page,
  }) => {
    await importBoth(page);

    // CONTEXT.md [[Typography settings]]: a choice is disabled only when it cannot be honoured, never
    // when it would merely look bad. Two columns on a phone looks bad and stays the reader's
    // call; frond cannot paginate a vertical book in more than one column at all. This is the one
    // row in [[Layout]] that depends on the book underneath it, and it moved into this panel
    // with the other five.
    await open(page, TITLES.vertical);
    await expect(segment(page, "setting-columns", 2)).toBeDisabled();
    await leave(page);

    await open(page, TITLES.horizontal);
    await expect(segment(page, "setting-columns", 2)).toBeEnabled();
  });

  test("reset hands everything back, and is offered only when there is something to hand back", async ({
    page,
  }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // Nothing has moved yet, so there is nothing to reset — and the button says so rather than
    // sitting there ready to do nothing.
    await expect(reset(page)).toBeDisabled();

    await fontSize(page).fill("150");
    await stepTo(page, "setting-line-height", 3);
    await expect(reset(page)).toBeEnabled();

    await reset(page).click();
    await expect(fontSize(page)).toHaveValue("115");
    // Rung zero is "Book's" — not a height at all, but whatever the book asked for.
    await expect(lineHeight(page)).toHaveAttribute("aria-valuenow", "0");
    await expect(reset(page)).toBeDisabled();
  });

  test("a setting that shows every option answers the arrow keys it promised", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // Declaring `role="radiogroup"` is a promise to a screen reader that the arrow keys work.
    // Three of the six settings are hand-rolled groups rather than a native `<select>`, so the
    // keyboard half is ours to provide — and it is the half that would go missing silently,
    // since a mouse never notices.
    // Focus is waited for, not assumed. The panel is still settling its own focus as it opens,
    // and a key sent before the tile has it goes to the document — where the reader's own arrow
    // handler turns a page and puts the chrome away, so the failure arrives as "the whole group
    // is gone" rather than "the key did nothing". WebKit was the engine slow enough to show it.
    // The chosen tile, because that is the one holding the group's tab stop — and because an
    // arrow moves from the value the group is on, not from whichever tile happens to have the
    // focus. Theme opens on System.
    await segment(page, "setting-theme", "system").focus();
    await expect(segment(page, "setting-theme", "system")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "setting-theme", "light")).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "setting-theme", "dark")).toHaveAttribute("aria-checked", "true");

    // And it wraps, so the group has no dead end.
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "setting-theme", "system")).toHaveAttribute("aria-checked", "true");

    // The arrows stayed inside the control. They reach a document-level handler that turns pages
    // otherwise, and a page turn puts [[Find]] away — so the reader adjusting a setting from the
    // keyboard would watch the panel vanish. The panel still standing is that not happening.
    await expect(page.getByTestId("panel-layout")).toBeVisible();

    // One tab stop for the whole group: the chosen tile holds it, the rest are skipped.
    const stops = await page
      .getByTestId("setting-theme")
      .locator("button")
      .evaluateAll((cells) => cells.filter((cell) => cell.tabIndex === 0).length);
    expect(stops).toBe(1);
  });

  test("a scale answers the arrow keys, and spends them on itself", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // A stepper says `role="spinbutton"`, which promises the same arrows a radiogroup does — and
    // it is one tab stop holding one value, so there is no cell to land on first. The `−` and
    // `+` are how a finger presses what these keys press (ADR-0050).
    //
    // ⚠️ **One press, and no assertion about the panel afterwards.** Changing [[Margin]] relays the
    // book out, and frond then moves the focus onto the page it painted so that arrow keys keep
    // turning pages — which can take the panel with it. That is frond's rule rather than this
    // control's, it predates this shape, and asserting against it here made this test flaky.
    // What is asserted is the arrow's own effect: the scale moved one rung. The claim that an
    // arrow does not escape to the page-turn handler is held by the slider test below, where no
    // relayout is racing it.
    await stepValue(page, "setting-margin").focus();
    await expect(stepValue(page, "setting-margin")).toBeFocused();
    await page.keyboard.press("ArrowLeft");

    await expect(stepValue(page, "setting-margin")).toHaveAttribute("aria-valuenow", "1");
  });

  test("and so does the slider, which is neither a group nor a scale", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // The third shape in the form, and the one this change did not touch. Left and right are
    // spent here too rather than reaching the reader's page-turn handler — so the panel is still
    // standing afterwards, which is the whole claim.
    await fontSize(page).focus();
    await expect(fontSize(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(fontSize(page)).toHaveValue("120");
    await expect(page.getByTestId("panel-layout")).toBeVisible();
  });

  test("a scale has two ends and stops at them", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // No wrap, unlike the groups above: the options there are alternatives and walking off one
    // end onto the other loses nothing, but a scale that wraps hands a reader the widest margin
    // when they asked for one narrower still. The button says so rather than sitting there
    // ready to do nothing.
    await stepTo(page, "setting-margin", 0);
    await expect(page.getByTestId("setting-margin-less")).toBeDisabled();
    await expect(page.getByTestId("setting-margin-more")).toBeEnabled();

    // ⚠️ **And the press that disabled it did not drop the focus.** A disabled element cannot
    // hold the focus, so without the control handing it to the value first it lands on `<body>`
    // — where the reader's arrow handler turns a page and takes this panel with it. The bug is
    // silent to a mouse and immediate to a keyboard, which is why it is asserted rather than
    // left to the eye.
    await expect(stepValue(page, "setting-margin")).toBeFocused();
  });

  test("the theme is in the panel, so night falls without leaving the book", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // The reader's bar used to carry a fourth entry into [[Settings]] purely because the theme could
    // not be reached from in here. It is the panel's first row now, so that door is gone.
    await segment(page, "setting-theme", "dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
