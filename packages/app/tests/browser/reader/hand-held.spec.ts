// The coarse-pointer half of the interface, which the suite's 1000×700 desk never enters: thumb
// targets, the rail clear of the platform's own gesture strip, and a panel that sends the bars
// away rather than stacking on them. The branch is a media query, so only an engine that matched
// it can be asked. The desk's half of the same rules is chrome-placement.spec.ts.
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  segment,
  longPressSelect,
} from "../support/library.js";

/**
 * The reader as a hand holds it: entries at the bottom edge, targets sized for a thumb, and an
 * axis thick enough to grab without a hover to ask first (ADR-0023).
 *
 * The rest of this suite runs at 1000×700 with a fine pointer, which is the desktop side of
 * every one of those branches — so without this file the hand-held half of the interface would
 * have nothing watching it at all.
 *
 * **Two engines, not three.** Playwright has no `isMobile` for Firefox, so the branch cannot be
 * emulated there. What is being pinned is CSS the three engines resolve the same way; what
 * Firefox would add is coverage of the emulation, not of the rule.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.skip(
  ({ browserName }) => browserName === "firefox",
  "Playwright has no mobile emulation for Firefox",
);

test.beforeEach(async ({ page }) => {
  await openBook(page, BOOKS.vertical);
});

test("emulation reaches CSS, so the assertions below mean what they say", async ({ page }) => {
  // Checked first and on its own: if this ever stops being true, every other assertion in this
  // file starts passing or failing for a reason that has nothing to do with the interface.
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(coarse).toBe(true);
});

test("puts the entries at the bottom edge, where the thumb is", async ({ page }) => {
  await openChrome(page);

  const nav = (await page.getByTestId("chrome-nav").boundingBox())!;
  const scrubber = (await page.getByTestId("scrubber-track").boundingBox())!;

  // Below the middle of the screen, and above the Scrubber rather than over it. The axis is no
  // longer the last thing on the screen — the chapter is, and deliberately
  // (docs/specs/reader-chrome-layers/spec.md) — but the entries still sit above both.
  expect(nav.y).toBeGreaterThan(844 / 2);
  expect(nav.y + nav.height).toBeLessThanOrEqual(scrubber.y + 1);
});

/**
 * **The rail clears the platform's own gesture strip.** This is the one assertion the whole
 * arrangement of `.chrome-bottom` exists to satisfy, and nothing else in the suite would notice
 * it going away.
 *
 * Both hand-held platforms own the bottom edge of the screen for switching apps and going home,
 * and **Android will not give it back**: `setSystemGestureExclusionRects` takes the left and
 * right edges only. So a draggable control down there is not a control the reader can drag — the
 * first few pixels of the gesture belong to the system, and what the reader gets is their home
 * screen. In a browser tab the toolbar below hides this; installed as a PWA (`display:
 * standalone`) there is nothing in the way, which is the case this guards.
 *
 * Two things bought the clearance and each is worth about half: the rail moved above the chapter
 * rather than below it, and `--chrome-bottom-safe` keeps 12px under the bar on a coarse pointer.
 *
 * **44, not the 52 this measures.** 52 is what today's numbers add up to; 44 is the rule — under
 * Android's 48px strip, on `--tap-min`, and far enough from 52 that tuning the bar's padding is
 * not a red build while putting the rail back on the bottom edge is.
 */
test("keeps the rail out of the system's gesture strip", async ({ page }) => {
  await openChrome(page);

  const rail = (await page.getByTestId("scrubber-track").boundingBox())!;
  const clearance = 844 - (rail.y + rail.height / 2);
  console.log(`rail centre sits ${Math.round(clearance)}px above the bottom edge`);

  expect(clearance).toBeGreaterThanOrEqual(44);

  // The chapter is what took the bottom, and it still has the bar's own padding under it rather
  // than sitting flush on the screen's edge.
  const chapter = (await page.getByTestId("reader-chapter").boundingBox())!;
  expect(chapter.y).toBeGreaterThan(rail.y);
  expect(844 - (chapter.y + chapter.height)).toBeGreaterThanOrEqual(12);
});

test("pays for that clearance out of the bar rather than only on a phone's CSS", async ({
  page,
}) => {
  // The safe strip is a fact about the device, so it is the coarse-pointer branch that sets it —
  // not a width query. A mouse on a narrow window never pays for a gesture it cannot make
  // (ADR-0023).
  const safe = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--chrome-bottom-safe").trim(),
  );
  expect(safe).toBe("12px");
});

test("sends the entries back to the bottom edge, not the top one", async ({ page }) => {
  // The other half of the same rule, and the half no other test would notice: 〈找〉 leaves the
  // way it arrived, so here the entries have to park below the screen with the Scrubber rather
  // than above it with the title bar. Measured with the chrome down, so nothing is in flight.
  const parked = await page.evaluate(() => {
    const reader = document.querySelector(".reader")!.getBoundingClientRect();
    const nav = document.querySelector(".chrome-nav")!.getBoundingClientRect();
    return { below: nav.top - reader.bottom, height: nav.height };
  });

  expect(parked.height).toBeGreaterThan(0);
  expect(parked.below).toBeGreaterThan(0);
});

test("gives every entry a thumb-sized target", async ({ page }) => {
  await openChrome(page);

  const entry = (await page
    .getByTestId("chrome-nav")
    .getByRole("button", { name: "Contents" })
    .boundingBox())!;
  expect(entry.height).toBeGreaterThanOrEqual(44);
});

test("wears the thick axis all the time, and insets it to match", async ({ page }) => {
  await openChrome(page);

  const inset = await page
    .locator(".scrubber")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--scrubber-inset").trim());
  expect(inset).toBe("14px");

  // No hover to grow it under, so the thumb is on screen before anything is touched.
  await expect(page.locator(".scrubber-thumb")).toBeVisible();
});

/**
 * What a panel costs the book here, and what it costs the bars.
 *
 * The entries and the Scrubber step aside for it. They used to stand under it and the panel had
 * to stop above them, which is how three layers came to share a 390px screen: the book was left
 * a quarter of the height and the form still ran off the bottom (#160). Two of those layers were
 * answering questions nobody had asked while a panel was open, so they are the ones that go.
 */
test("a panel sends the entries and the Scrubber away rather than stacking on them", async ({
  page,
}) => {
  await openPanel(page, "Type");

  await expect(page.getByTestId("chrome-nav")).toBeHidden();
  await expect(page.getByTestId("chrome-bottom")).toBeHidden();

  // And they come back, so this is a state and not a one-way door.
  await page.getByTestId("panel-layout").getByLabel("Close").click();
  await expect(page.getByTestId("chrome-nav")).toBeVisible();
  await expect(page.getByTestId("chrome-bottom")).toBeVisible();
});

/**
 * How much of the book 〈排版〉 leaves, measured rather than claimed.
 *
 * Six rows have to fit without scrolling, because the page above the panel is the preview: the
 * panel covers the book rather than pushing it here, so what shows up there is the real type
 * resetting as the reader drags (ADR-0026).
 *
 * **Measured against the reader, not against `.chrome-gap`.** The gap is the room between the
 * bars, and while a panel is open on a hand-held there are no bars — the sheet runs to the
 * bottom edge of the screen. Asking the gap would compare the sheet against a box it is no
 * longer inside of, which is how a rule keeps passing after it has stopped meaning anything.
 */
test("〈排版〉 leaves the book showing above it", async ({ page }) => {
  await openPanel(page, "Type");

  const popup = (await page.getByTestId("panel-layout").boundingBox())!;
  const reader = (await page.locator(".reader").boundingBox())!;
  const body = page.locator("[data-testid='panel-layout'] .panel-body");
  const { scrollHeight, clientHeight } = await body.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  console.log(
    `〈排版〉: ${Math.round(reader.height - popup.height)}px of book above it, ` +
      `${scrollHeight - clientHeight}px of the form below the fold`,
  );

  // A third of the box or better left to the book. A panel that fits its own contents but leaves
  // a two-line sliver has met the letter of the rule and lost what the rule was for.
  expect(reader.height - popup.height).toBeGreaterThan(reader.height * 0.3);

  // And the last row, the one a short panel would hide, really does work.
  await segment(page, "setting-margin", 48).click();
  await expect(segment(page, "setting-margin", 48)).toHaveAttribute("aria-checked", "true");
});

/**
 * #160, paid off — and by the bars rather than by the book.
 *
 * The rows were given the vertical padding that keeps a hairline off the control it belongs to,
 * and on a hand-held there was no room for it: six hit areas at a finger's 44px are already
 * 264px, and the panel could only have 29rem because the entries and the Scrubber were standing
 * under it. With those two out of the way the same third of the screen buys the panel 36rem,
 * which fits the form.
 *
 * **It is 390×844 this holds at**, which is what the viewport above says. On a shorter phone the
 * `70vh` half of the cap bites first and the form goes back to scrolling; that is the right way
 * round, because a form that scrolls has lost a scroll and a panel with no book above it has
 * lost the thing it covers the page for.
 */
/**
 * **In Chinese, and so far only in Chinese.**
 *
 * The suite runs in English — the source language, so a failure reads as a difference in
 * behaviour rather than one in translation (`playwright.config.ts`). English is wider:
 * 「無 小 中 大」 is four characters where "None Small Medium Large" is nineteen, so 〈留白〉's
 * four cells no longer fit beside their label and that row takes a second line. Measured in the
 * test image at 390×844: the form is 543px against a 506px box, and the whole of that 37px is
 * that one row.
 *
 * The property below was designed and measured for Chinese, so Chinese is where it is still
 * asserted. Making it true in English is #27 — a question about wording and about the panel's
 * cap, not about this file.
 */
test.describe("in Chinese, where the form was measured", () => {
  test.use({ locale: "zh-TW" });

  test("〈排版〉 fits without scrolling", async ({ page }) => {
    await openPanel(page, "排版");

    const body = page.locator("[data-testid='panel-layout'] .panel-body");
    const { scrollHeight, clientHeight } = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  });
});

/**
 * The highlight toolbar's seam, on the pointer that makes it wrap.
 *
 * Six controls do not fit across a phone, and the bar used to let flexbox find its own way onto
 * two lines. The rule between the four inks and the two words went with it: it was the
 * `border-left` of whichever button landed first on the second row, so it stood at the start of
 * a line with nothing to its left, pushing 重點＋筆記 off centre. Two groups and one declared
 * breakpoint replaced that.
 *
 * Asserted rather than screenshotted because a screenshot of it cannot be produced honestly from
 * the host: the selection has to be made inside frond's iframe, and playwright-cli cannot reach
 * in there. The suite can, so the claim lives where it can fail.
 */
test("the highlight toolbar stacks, and its rule turns with it", async ({ page }) => {
  // A long press, not `selectVisibleText`: on the pointer this whole file is about, the
  // browser's own selection inside the book is off and Tidemarks makes its own (ADR-0036).
  // Adding a range by hand there raises nothing — and in WebKit `user-select: none` refuses
  // the range outright.
  await longPressSelect(page);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();

  const seam = await page.evaluate(() => {
    const inks = document.querySelector(".mark-inks")!.getBoundingClientRect();
    const actions = document.querySelector(".mark-actions")!;
    const box = actions.getBoundingClientRect();
    const style = getComputedStyle(actions);
    return {
      stacked: box.top >= inks.bottom,
      alignedLeft: Math.abs(box.left - inks.left) < 1,
      borderTop: style.borderTopWidth,
      borderLeft: style.borderLeftWidth,
    };
  });

  // The actions sit below the inks and start at the same edge — one bar of two rows, not six
  // children finding their own way.
  expect(seam.stacked).toBe(true);
  expect(seam.alignedLeft).toBe(true);

  // And the rule divides the two rows rather than standing at the start of one of them.
  expect(seam.borderTop).toBe("1px");
  expect(seam.borderLeft).toBe("0px");
});
