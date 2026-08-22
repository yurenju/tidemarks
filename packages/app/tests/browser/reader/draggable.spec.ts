import type { Page } from "@playwright/test";
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
 * What tells the reader a bar can be dragged.
 *
 * The reader's 〈找〉 state can show two bars at once: the Scrubber, which seeks through the
 * whole book, and the read-only bar under the font download line. Taking the Scrubber for a
 * progress bar costs nothing. The other confusion is the one that hurts — dragging what looked
 * like a Scrubber and landing somewhere else in the book, with no "back to where I was".
 *
 * So the two carry opposite signatures, and these pin them: tide, a thumb, end caps, a
 * keyboard role and pointer events on one; grey, 3px and none of the rest on the other. Type
 * checking cannot see any of this, and the unit tests are on the wrong side of the DOM for it.
 */

test("the Scrubber says it can be dragged", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);
  await settled(page);
  await waitForIndex(page);
  await openChrome(page);

  const track = page.getByTestId("scrubber-track");
  await expect(track).toHaveAttribute("role", "slider");
  await expect(track).toHaveCSS("cursor", "pointer");

  // The two end caps say where the book starts and ends; a read-only bar has neither.
  await expect(page.locator(".scrubber-cap")).toHaveCount(2);

  // Filled in tide, the colour kept for what the reader can act on.
  expect(await colourOf(page, ".scrubber-fill")).toBe(await tokenColour(page, "--tide"));

  // The keyboard reaches it, which is the whole of what "draggable" means to a reader who has
  // no pointer at all.
  await track.focus();
  await expect(track).toBeFocused();
});

test("the read-only bar says it cannot, and is never tide", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);
  await settled(page);
  await openChrome(page);
  await openPanel(page, "Type");

  // **Neither committed book can summon this bar**, which is why the markup is built here
  // rather than provoked: it appears only while a carried face is on the wire, and
  // `needsWebFont` asks for one only from a book with Han and without kana — Alice has no Han,
  // 草枕 is Japanese and is refused on the kana. Holding the request open with `page.route`
  // was tried and reaches nothing, because the fetch is never started.
  //
  // So this pins the stylesheet's half of the signature, in the sheet the bar appears in and
  // against the same tokens the Scrubber above resolves. What it does **not** cover is
  // `Reader.tsx` still putting these classes and `role="progressbar"` on the element — renaming
  // them there would leave this passing. That half is held by the rule in docs/design-system.md
  // 〈能拖與不能拖〉 and by CONTEXT.md 〈唯讀進度條〉.
  await page.evaluate(() => {
    const bar = document.createElement("div");
    bar.className = "font-progress";
    bar.dataset.testid = "font-progress-probe";
    bar.setAttribute("role", "progressbar");
    const fill = document.createElement("div");
    fill.className = "font-progress-fill";
    bar.append(fill);
    document.querySelector(".panel-body")!.append(bar);
  });

  const bar = page.getByTestId("font-progress-probe");
  await expect(bar).toHaveCSS("height", "3px");
  await expect(bar).toHaveCSS("pointer-events", "none");

  // No thumb and no end caps: those belong to the thing that can be dragged.
  await expect(bar.locator(".scrubber-thumb, .scrubber-cap")).toHaveCount(0);

  const fill = await colourOf(page, ".font-progress-fill");
  expect(fill).not.toBe(await tokenColour(page, "--tide"));
  expect(fill).toBe(await tokenColour(page, "--text-muted"));
});

/** The background an element actually ended up with, as the browser reports it. */
function colourOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => getComputedStyle(document.querySelector(sel)!).backgroundColor,
    selector,
  );
}

/**
 * What a token resolves to, measured rather than read.
 *
 * Through a throwaway element painted with the token instead of `getPropertyValue`, so the
 * answer comes back in the same form as a real element's computed colour and the comparison is
 * between two things the browser produced.
 */
function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}
