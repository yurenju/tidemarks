// `rangeFromPoints` — the fact the take-over-selection path is built on (issue #50, ADR-0036):
// two points on screen turned into the passage between them, computed inside the iframe where
// the text lives. Native selection is never involved here; the consumer drives the points, so
// this is what lets `user-select` be turned off entirely on touch.
//
// Whether the resulting rectangles and CFI are right is already covered by selection.spec.ts —
// this file is about the point→range half those tests get from the browser for free.
import { type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { parseCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness, type EventRecord, type Rect } from "../support/harness.js";

type Point = { readonly x: number; readonly y: number };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("rangeFromPoints", () => {
  test("word granularity snaps to a word under the point, not the whole paragraph", async ({
    page,
  }) => {
    // A long press: the reader touches one place and expects the word there, the way the
    // platform's own selection would snap it — shorter than the paragraph it sits in.
    await mountFixture(page, "vertical-japanese");
    const paragraph = await rectAndTextOf(page, "p");
    const point = centreOf(paragraph.rect);

    const word = await page.evaluate((p) => window.frond.rangeFromPoints(p, p, "word"), point);

    expect(word).not.toBeNull();
    expect(word!.text.length).toBeGreaterThan(0);
    expect(word!.text.length).toBeLessThan(paragraph.text.length);
    expect(parseCfi(word!.cfi).kind).toBe("range");
    expect(word!.rects.length).toBeGreaterThan(0);
  });

  test("char granularity spans the two points, in either order", async ({ page }) => {
    // Dragging an endpoint: the two carets are taken as they are, and which one the reader
    // grabbed first must not change the passage.
    //
    // **The passage has to reach across what lies between the points**, not merely be non-empty.
    // A range that came back as the word it started from would satisfy "some text, and the same
    // both ways" — and that is precisely what a drag that extends nothing looks like from out
    // here, which is how issue #54 stayed open as long as it did with this file green. The
    // paragraph in the middle is a fact neither endpoint carries, so containing it can only be
    // true of a range that really spans them.
    await mountFixture(page, "vertical-japanese");
    const first = centreOf((await rectAndTextOf(page, "p:nth-of-type(1)")).rect);
    const between = (await rectAndTextOf(page, "p:nth-of-type(2)")).text;
    const third = centreOf((await rectAndTextOf(page, "p:nth-of-type(3)")).rect);
    await page.evaluate(() => window.frond.clearSelection());

    const forward = await page.evaluate(([a, b]) => window.frond.rangeFromPoints(a, b, "char"), [
      first,
      third,
    ] as const);
    const backward = await page.evaluate(([a, b]) => window.frond.rangeFromPoints(a, b, "char"), [
      third,
      first,
    ] as const);

    expect(forward).not.toBeNull();
    expect(forward!.text).toContain(between);
    expect(parseCfi(forward!.cfi).kind).toBe("range");
    // The drag reads the same span whichever end was the anchor.
    expect(backward!.text).toBe(forward!.text);
  });

  test("a point off the text gives nothing to select", async ({ page }) => {
    // A press in the margin, past the inset the iframe sits behind: there is no caret there,
    // and the consumer must get `null` rather than an empty-but-present selection.
    await mountFixture(page, "vertical-japanese");
    const off: Point = { x: -100, y: -100 };

    const range = await page.evaluate((p) => window.frond.rangeFromPoints(p, p, "char"), off);

    expect(range).toBeNull();
  });

  test("one point off the text and one on gives nothing to select either", async ({ page }) => {
    // The two ends of a drag are only meaningful together — an endpoint dragged off the page
    // (into another section, or into the margin the iframe sits behind) cannot pair with a live
    // anchor to make a range. `null` means "the consumer has no drag to draw right now."
    await mountFixture(page, "vertical-japanese");
    const paragraph = await rectAndTextOf(page, "p");
    const on = centreOf(paragraph.rect);
    const off: Point = { x: -100, y: -100 };

    const range = await page.evaluate(([a, b]) => window.frond.rangeFromPoints(a, b, "char"), [
      on,
      off,
    ] as const);

    expect(range).toBeNull();
  });
});

function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * A rectangle on screen to aim a point at, and the text it belongs to. Uses a native selection
 * only to read the geometry back — the thing under test never touches that selection, and it is
 * dropped before the query runs.
 */
async function rectAndTextOf(page: Page, selector: string): Promise<{ rect: Rect; text: string }> {
  const before = await selectionCount(page);
  await page.evaluate((value) => window.frond.selectText(value), selector);
  await expect.poll(() => selectionCount(page)).toBeGreaterThan(before);

  const payload = await lastSelection(page);
  const rect = payload?.rects[0];
  if (rect === undefined) throw new Error(`${selector} produced no rectangle to aim at`);
  return { rect, text: payload!.text };
}

interface SelectionPayload {
  readonly cfi: string | null;
  readonly text: string;
  readonly rects: readonly Rect[];
}

async function selectionCount(page: Page): Promise<number> {
  const events: readonly EventRecord[] = await page.evaluate(() => window.frond.events());
  return events.filter((event) => event.name === "selection").length;
}

async function lastSelection(page: Page): Promise<SelectionPayload | undefined> {
  const events: readonly EventRecord[] = await page.evaluate(() => window.frond.events());
  const selections = events.filter((event) => event.name === "selection");
  return selections[selections.length - 1]?.payload as SelectionPayload | undefined;
}
