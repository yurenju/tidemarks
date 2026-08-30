// Typography as one record shared by every book, and the keyboard contract of the controls that
// set it. The record's own shape, its migrations and what frond is handed are exhausted in
// src/lib/settings.test.ts; leaving one book and opening another, and a `radiogroup` really
// answering the arrow keys, are things a pure function has no form for.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openPanel, segment, settled } from "../support/library.js";

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

// By `data-testid`, not by role or by shape. The Scrubber is a `slider` too, and the four
// segmented settings are each a `radiogroup` of identical-looking cells — `segment()` reaches
// one of those by the value it sets.
const fontSize = (page: Page) => page.getByTestId("setting-font-size");
const lineHeight = (page: Page) => page.getByTestId("setting-line-height");
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
    await lineHeight(page).selectOption("1.8");
    await fontSize(page).fill("160");
    await leave(page);

    await open(page, TITLES.vertical);
    await expect(fontSize(page)).toHaveValue("160");
    await expect(lineHeight(page)).toHaveValue("1.8");
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
    await lineHeight(page).selectOption("1.8");
    await expect(reset(page)).toBeEnabled();

    await reset(page).click();
    await expect(fontSize(page)).toHaveValue("115");
    await expect(lineHeight(page)).toHaveValue("0");
    await expect(reset(page)).toBeDisabled();
  });

  test("a segmented setting answers the arrow keys it promised", async ({ page }) => {
    await importBoth(page);
    await open(page, TITLES.horizontal);

    // Declaring `role="radiogroup"` is a promise to a screen reader that the arrow keys work.
    // Four of the six settings are hand-rolled groups rather than a native `<select>`, so the
    // keyboard half is ours to provide — and it is the half that would go missing silently,
    // since a mouse never notices.
    // Focus is waited for, not assumed. The panel is still settling its own focus as it opens,
    // and a key sent before the cell has it goes to the document — where the reader's own arrow
    // handler turns a page and puts the chrome away, so the failure arrives as "the whole group
    // is gone" rather than "the key did nothing". WebKit was the engine slow enough to show it.
    await segment(page, "setting-margin", 32).focus();
    await expect(segment(page, "setting-margin", 32)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "setting-margin", 48)).toHaveAttribute("aria-checked", "true");

    // And it wraps, so the group has no dead end.
    //
    // Focus is taken again rather than assumed to have stayed: changing [[Margin]] relaid the book out,
    // and frond moves the focus onto the page it just painted so that the arrow keys keep turning
    // pages. Which is a real thing to know — a second press without this line goes to the book and
    // turns a page, which puts the whole panel away — but it is frond's rule, not this control's,
    // and asserting it here would leave this test failing for someone else's reason.
    await segment(page, "setting-margin", 48).focus();
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "setting-margin", 0)).toHaveAttribute("aria-checked", "true");

    // The arrows stayed inside the control. They reach a document-level handler that turns pages
    // otherwise, and a page turn puts [[Find]] away — so the reader adjusting [[Margin]] from the keyboard
    // would watch the panel vanish. The panel still standing is that not happening.
    await expect(page.getByTestId("panel-layout")).toBeVisible();

    // Same rule for the two settings that are not segmented: a slider and a select both spend
    // left and right on themselves.
    await fontSize(page).focus();
    await expect(fontSize(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(fontSize(page)).toHaveValue("120");
    await expect(page.getByTestId("panel-layout")).toBeVisible();

    // One tab stop for the whole group: the chosen cell holds it, the rest are skipped.
    const stops = await page
      .getByTestId("setting-margin")
      .locator("button")
      .evaluateAll((cells) => cells.filter((cell) => cell.tabIndex === 0).length);
    expect(stops).toBe(1);
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
