// The selection Tidemarks draws for itself on touch (ADR-0036): a long press snaps a word, the
// handles move its ends, and a swipe elsewhere still turns the page. What no pure function can
// answer is what this file is for — the geometry comes back from a real layout through frond's
// `rangeFromPoints`, and the branch only exists at all on a device whose primary pointer is
// coarse. `selection-handles.test.ts` has the arithmetic; `toolbar-position.test.ts` has where
// the colour row lands.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  PAGE_FRAME,
  dragPage,
  farEnoughToTurn,
  longPressSelect,
  openBook,
  settled,
  textPoints,
  visibleText,
} from "../support/library.js";

/**
 * A phone: the branch under test is chosen by `(pointer: coarse)`, and nothing else here reaches
 * it. `hasTouch` alone does not — it gives the page touch events without making the finger the
 * primary pointer — so this needs the same mobile emulation `hand-held.spec.ts` uses, and
 * inherits its one limitation: Playwright has no `isMobile` for Firefox.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.skip(
  ({ browserName }) => browserName === "firefox",
  "Playwright has no mobile emulation for Firefox, and this whole branch is chosen by (pointer: coarse)",
);

/**
 * How much of the page is washed, in square pixels.
 *
 * Counting the boxes would not do: a selection extended along a line lengthens the strip the
 * reader already had rather than adding a second one, so the count is the same before and after
 * and an assertion on it could not fail for the thing it names.
 */
async function washedArea(page: Page): Promise<number> {
  return await page.evaluate(() =>
    [...document.querySelectorAll(".selection-wash")].reduce((total, box) => {
      const rect = box.getBoundingClientRect();
      return total + rect.width * rect.height;
    }, 0),
  );
}

// The vertical book, because that is the axis the handles turn on and the colour row moves for.
test.describe("a vertical book", () => {
  test.beforeEach(async ({ page }) => {
    await openBook(page, BOOKS.vertical);
  });

  test("emulation reaches the media query, so the assertions below mean what they say", async ({
    page,
  }) => {
    // First and on its own, for `hand-held.spec.ts`'s reason: without it every assertion in this
    // file could pass or fail for a reason that has nothing to do with the selection.
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  });

  test("the browser's own selection is off inside the book", async ({ page }) => {
    // The other half of taking selection over, and the half with no visible symptom of its own
    // until two selections are on screen at once. It is declared inside frond's iframe, which is
    // the only place it can be — a rule out here reaches none of the book.
    //
    // Both spellings are read because WebKit resolves only the prefixed one, and the app sets
    // both for exactly that reason — asking for `userSelect` alone would report `undefined`
    // there and read as a failure of the feature rather than of the question.
    const selectable = await page
      .frameLocator(PAGE_FRAME)
      .locator("html")
      .evaluate((root) => {
        const style = getComputedStyle(root) as CSSStyleDeclaration & { webkitUserSelect?: string };
        return style.userSelect ?? style.webkitUserSelect;
      });

    expect(selectable).toBe("none");
  });

  test("a long press snaps the word under the finger", async ({ page }) => {
    await longPressSelect(page);

    await expect(page.locator(".selection-wash").first()).toBeVisible();
    await expect(page.locator(".selection-handle")).toHaveCount(2);
  });

  test("the colour row waits for the finger to lift", async ({ page }) => {
    // 〈標〉 begins when the finger does not (CONTEXT.md 〈chrome〉). Raised any earlier the row
    // would sit under the finger that raised it, and chase the selection while it is extended.
    const finger = (type: "pointerdown" | "pointerup") =>
      page.evaluate(
        ({ selector, type }) => {
          const frame = document.querySelector(selector) as HTMLIFrameElement;
          const view = frame.contentWindow!;
          const box = frame.getBoundingClientRect();
          const Pointer = (view as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
          frame.contentDocument!.body.dispatchEvent(
            new Pointer(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              clientX: box.width / 2,
              clientY: box.height / 2,
            }),
          );
        },
        { selector: PAGE_FRAME, type },
      );

    await finger("pointerdown");

    // Past the threshold, with the finger still down.
    await expect(page.locator(".selection-handle")).toHaveCount(2);
    await expect(page.locator(".highlight-toolbar")).toHaveCount(0);

    await finger("pointerup");

    await expect(page.locator(".highlight-toolbar")).toBeVisible();
  });

  test("dragging a handle extends the selection", async ({ page }) => {
    // **Both ends of this gesture are aimed at text.** The cover is a title and an author with a
    // screenful of nothing between them, which is the ordinary shape of a page: press in the
    // empty part and the selection lands on whichever character is nearest, drag into it and
    // `rangeFromPoints` answers `null` and the selection correctly does not move. Either way the
    // test would be reading a page that cannot answer the question. Two runs of real text is the
    // smallest arrangement that can. **Where exactly those points land is `textPoints`' rule,
    // and it is what #54 turned out to be** — a point off the page, or in the empty part of a
    // column, is not a place a drag can extend to on any engine.
    const runs = await textPoints(page);
    expect(runs.length, "this page has only one run of text to drag between").toBeGreaterThan(1);

    await longPressSelect(page);
    const washed = await washedArea(page);

    // Driven with the real pointer rather than dispatched events, because the handle takes a
    // pointer capture on the way down and a capture cannot be taken of a pointer the browser
    // does not have. This is the same code path a finger takes; what it does not exercise is
    // the engine's own decision about whether that finger belonged to the page, which
    // `real-touch.spec.ts` covers for the gesture it matters to.
    const centreOf = async (end: "start" | "end") => {
      const box = (await page.locator(`.selection-handle[data-end="${end}"]`).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const anchored = await centreOf("start");
    const { x: hitX, y: hitY } = await centreOf("end");

    // **The colour row has to leave the handle this drag takes hold of.** The row is painted over
    // the selection layer, so a row that landed on this bead would turn the drag below into a tap
    // on the row — which dismisses the selection and fails somewhere that says nothing about why.
    //
    // It used to be asserted the other way round: that the handle was the element under the
    // point, which the layer's stacking order made true whether or not the row was on the
    // passage. That passed on a row landing squarely over the text — the reader could still drag,
    // but a bead was painted over one of the four colours they were being asked to press. The
    // rule worth holding is where the row goes, not which of the two is painted first, and the
    // arithmetic of it is `toolbar-position.test.ts`'s. What needs a real layout is this: that
    // the choice it makes leaves a real handle over a real passage reachable.
    //
    // **Both handles, not just this one.** A row nearly as wide as a phone does not fit beside a
    // vertical column, and it used to be clamped back across the middle of the passage — where
    // whichever bead it landed on stopped being pressable. Placing it at one end of the passage
    // instead is what makes "clears both" a rule this layout can actually keep.
    // The row's presence is the premise, so it is asserted rather than defaulted: a regression
    // where it never appears would otherwise satisfy "clears both handles" trivially.
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    const rowClearsHandles = await page.evaluate(() => {
      const row = document.querySelector(".highlight-toolbar")!.getBoundingClientRect();
      return [...document.querySelectorAll(".selection-handle")].every((handle) => {
        const box = handle.getBoundingClientRect();
        return (
          box.right <= row.left ||
          box.left >= row.right ||
          box.bottom <= row.top ||
          box.top >= row.bottom
        );
      });
    });
    expect(rowClearsHandles, "the colour row is sitting on a selection handle").toBe(true);

    // And nothing else is on it either. The check above knows about one element; this one asks
    // the engine what is actually under the point the drag is about to press, which is what the
    // drag depends on — a wash, a panel or a portalled overlay would fail here by name rather
    // than as a selection that mysteriously did not grow.
    const under = await page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.className ?? "",
      { x: hitX, y: hitY },
    );
    expect(under).toContain("selection-handle");

    // **The run furthest from the end that is staying put**, which is what makes this a
    // lengthening rather than a move: the passage runs from the start handle to wherever the end
    // handle is put, so putting it on the furthest text there is cannot span less than it does
    // now. Dragging to the nearest text instead would shorten the selection — a real thing for a
    // handle to do, and not the thing this test is named after.
    const onto = runs.reduce((furthest, run) =>
      Math.hypot(run.x - anchored.x, run.y - anchored.y) >
      Math.hypot(furthest.x - anchored.x, furthest.y - anchored.y)
        ? run
        : furthest,
    );

    await page.mouse.move(hitX, hitY);
    await page.mouse.down();
    await page.mouse.move(onto.x, onto.y, { steps: 8 });
    await page.mouse.up();

    // **Strictly more** of the page is washed than the one word the press snapped. Anything
    // weaker passes when the drag did nothing at all, which is the failure this exists to catch.
    await expect.poll(() => washedArea(page)).toBeGreaterThan(washed);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
  });

  test("a swipe away from the handles turns the page and takes the selection with it", async ({
    page,
  }) => {
    // The rule this replaces read "a selection standing at the press means the page must not
    // move" — a compensation for not knowing where the finger had landed. The handles are ours
    // now and claim their own presses, so everywhere else is a page turn again.
    await longPressSelect(page);
    await expect(page.locator(".selection-handle")).toHaveCount(2);

    // Rightward, because this book opens from the right: a leftward finger on the cover asks
    // for the page before it and gets the boundary.
    const before = await visibleText(page);
    await dragPage(page, { dx: await farEnoughToTurn(page) });
    await settled(page);

    // It really turned — otherwise this would pass on a drag that merely began, which drops the
    // selection too and says nothing about the page.
    await expect.poll(async () => await visibleText(page)).not.toBe(before);
    await expect(page.locator(".selection-wash")).toHaveCount(0);
    await expect(page.locator(".highlight-toolbar")).toHaveCount(0);
  });
});
