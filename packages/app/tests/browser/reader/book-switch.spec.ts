// Changing books without leaving the reader: the last book's pointer listeners have to come off.
// Nothing else in the suite would notice if one stayed on — the leak shows up as a press being
// acted on twice, which cancels itself out and looks like a control that does nothing.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, PAGE_FRAME, settled } from "../support/library.js";

/**
 * What a book session has to take with it when it ends (#173).
 *
 * The reader registers seven pointer listeners across three surfaces when a book opens — four on
 * the band of margin around the book's own frame, two on the document for a finger that let go
 * elsewhere, and a `keyup`. Going straight from one book to another **does not remount the
 * reader**: the address changes, the effect keyed on the book runs again, and the container those
 * four listeners are on is the same DOM element it was before. So a listener the old session
 * failed to remove is still there, still feeding a gesture machine that belongs to a book nobody
 * is reading.
 *
 * **The symptom is a press being counted twice, not an error.** Two machines both call a tap a
 * tap, the chrome is told twice, and it goes up and straight back down — so the reader presses
 * the page and nothing happens, with nothing red anywhere to say why.
 *
 * ⚠️ **What this pins is the behaviour, not either mechanism.** Two things currently stop the
 * double press — the listeners come off, and the ended session drops its gesture machine, which
 * leaves `send` with nothing to answer — and removing *either* on its own leaves this test green
 * (measured, both ways). That is the right assertion to make: this is the claim the reader can
 * feel, and a leak is only harmless for as long as both belts hold. Do not rewrite it as a count
 * of registered listeners — that would pin an implementation and stop meaning anything the day
 * a surface is added.
 */
test("switching books takes the last book's listeners with it", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  await importBook(page, BOOKS.emphasis, /字重與強調/);

  const idOf = async (title: RegExp) =>
    await bookCards(page).filter({ hasText: title }).getAttribute("data-book-id");
  const second = await idOf(/字重與強調/);

  await bookCards(page).filter({ hasText: /Alice/ }).getByTestId("book-open").click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);

  // A witness on frond's container, so the assertion below can only pass for the reason it is
  // about. If the reader were remounted — or the app reloaded — this element would be a new one
  // and its listeners would be new with it, and the test would be proving nothing.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".viewer-mount")!.dataset.witness = "first";
  });

  // Straight from one book to the other, the way an address does it. Not back to the shelf: that
  // unmounts the reader, which takes every listener with it whether or not anything meant to.
  await page.evaluate((id) => {
    window.location.hash = `#/book/${id}`;
  }, second);
  await expect(page.locator(".reader-title")).toHaveText(/字重與強調/);
  await settled(page);

  expect(
    await page.evaluate(
      () => document.querySelector<HTMLElement>(".viewer-mount")?.dataset.witness,
    ),
    "the reader was rebuilt, so this says nothing about what the last session left behind",
  ).toBe("first");

  // The band of margin: inside the reader's own container, outside the book's frame. It is where
  // a thumb goes on a phone, and it is the surface those four listeners are on.
  const mount = (await page.locator(".viewer-mount").boundingBox())!;
  const frame = (await page.locator(PAGE_FRAME).last().boundingBox())!;
  const band = frame.x - mount.x;
  expect(band, "no margin band to press, so there is nothing to press twice").toBeGreaterThan(4);

  const chrome = page.getByTestId("chrome-bottom");
  await expect(chrome).toBeHidden();

  // **One press, one answer.** With the first book's listeners still on, this same click reaches
  // two gesture machines, the chrome is raised and lowered in the one commit, and what this
  // waits for never arrives.
  await page.mouse.click(mount.x + band / 2, mount.y + mount.height / 2);
  await expect(chrome).toBeVisible();
});
