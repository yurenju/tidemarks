// Selecting by address rather than by drag: `selectRange`, `rangeFactsFor` and `findText`
// (Tidemarks #128). The consumer's reason for wanting them is that a selection is otherwise
// only reachable by simulating a real drag, and a drag lands on a different number of
// characters every run.
//
// The three of them are one route with three doors: `findText` turns a phrase into a CFI,
// `selectRange` hands that CFI to the browser's own selection, and `rangeFactsFor` answers
// with the geometry instead — for the consumer that has taken selection over and draws it
// itself, where nothing native is involved at all (ADR-0036).
import { type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { parseCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

interface SelectionPayload {
  readonly cfi: string | null;
  readonly text: string;
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("selectRange", () => {
  test("selects the passage a CFI names, and the selection event follows as from a drag", async ({
    page,
  }) => {
    // The whole value of going through the browser's selection rather than drawing something:
    // every consumer of `selection` downstream cannot tell this apart from a reader's drag,
    // so nothing has to be kept in step with a second route.
    await mountFixture(page, "vertical-japanese");
    const dragged = await selectByHand(page, "p");
    await page.evaluate(() => window.frond.clearSelection());
    await expect.poll(() => selectedText(page)).toBe("");

    const applied = await page.evaluate(
      (cfi) => window.frond.selectRange(cfi as string),
      dragged.cfi!,
    );

    expect(applied).toBe(true);
    await expect.poll(() => selectedText(page)).toBe(dragged.text);
    const event = await waitForSelection(page);
    expect(event.text).toBe(dragged.text);
    expect(parseCfi(event.cfi!).kind).toBe("range");
  });

  test("refuses a CFI naming another section, and leaves the selection where it was", async ({
    page,
  }) => {
    // A consumer acting on an address from elsewhere — a note, a hand-typed URL — must not
    // have the reader's own selection destroyed by an address that turns out to point at
    // another chapter. Answering `false` and touching nothing is what lets the consumer say
    // so instead.
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      twoSections(),
    ] as const);
    const first = await selectByHand(page, "p");
    await page.evaluate(() => window.frond.goToSection(1));
    const here = await selectByHand(page, "p");

    const applied = await page.evaluate(
      (cfi) => window.frond.selectRange(cfi as string),
      first.cfi!,
    );

    expect(applied).toBe(false);
    expect(await selectedText(page)).toBe(here.text);
  });

  test("refuses a CFI that does not parse", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const applied = await page.evaluate(() => window.frond.selectRange("not a cfi"));

    expect(applied).toBe(false);
  });
});

test.describe("rangeFactsFor", () => {
  test("answers a CFI with the same three facts a drag produces", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    const dragged = await selectByHand(page, "p");
    await page.evaluate(() => window.frond.clearSelection());

    const facts = await rangeFactsFor(page, dragged.cfi!);

    expect(facts).not.toBeNull();
    expect(facts!.text).toBe(dragged.text);
    expect(parseCfi(facts!.cfi).kind).toBe("range");
    expect(facts!.rects.length).toBeGreaterThan(0);
  });

  test("still answers with native selection off, which is the case it exists for", async ({
    page,
  }) => {
    // The take-over-selection route runs with `user-select: none` on the document, so nothing
    // native can be put there and `selectRange` has nowhere to land. This one asks for the
    // geometry instead and draws it itself, so it has to keep working exactly here.
    await mountFixture(page, "vertical-japanese");
    const dragged = await selectByHand(page, "p");
    await page.evaluate(() => window.frond.clearSelection());
    await page.evaluate(() => window.frond.setNativeSelection(false));

    const facts = await rangeFactsFor(page, dragged.cfi!);

    expect(facts).not.toBeNull();
    expect(facts!.text).toBe(dragged.text);
    expect(facts!.rects.length).toBeGreaterThan(0);
    // And nothing native was involved on the way: the document still has no selection.
    expect(await selectedText(page)).toBe("");
  });

  test("gives nothing for a CFI naming another section", async ({ page }) => {
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      twoSections(),
    ] as const);
    const first = await selectByHand(page, "p");
    await page.evaluate(() => window.frond.goToSection(1));

    expect(await rangeFactsFor(page, first.cfi!)).toBeNull();
  });
});

test.describe("findText", () => {
  test("finds a phrase broken up by inline elements", async ({ page }) => {
    // The reason the search runs over the flattened character stream rather than node by node:
    // a book marks up emphasis mid-sentence, and a caller quoting the sentence has no idea
    // where the `<em>` falls.
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      oneSection("<p>山路を<em>登り</em>ながら、こう考えた。</p>"),
    ] as const);

    const cfi = await page.evaluate(() => window.frond.findText("山路を登りながら"));

    expect(cfi).not.toBeNull();
    const facts = await rangeFactsFor(page, cfi!);
    expect(facts!.text).toBe("山路を登りながら");
  });

  test("what it finds can be selected, which is the pair's whole purpose", async ({ page }) => {
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      oneSection("<p>山路を登りながら、こう考えた。</p>"),
    ] as const);

    const cfi = await page.evaluate(() => window.frond.findText("こう考えた"));
    await page.evaluate((value) => window.frond.selectRange(value as string), cfi!);

    await expect.poll(() => selectedText(page)).toBe("こう考えた");
  });

  test("stops at the end of the paragraph a phrase ends, not inside the next one", async ({
    page,
  }) => {
    // A whole sentence is the most ordinary thing to ask for, and a sentence usually ends where
    // its paragraph does. The character index of that boundary belongs to two positions — the
    // end of this node and the start of the next — and the wrong one reaches across the break.
    //
    // **The indentation between the two blocks is what makes this visible**, and it is why the
    // fixture is written with a line break in it rather than as two adjacent tags. That
    // whitespace is not in the character stream the search runs over, so it cannot be matched;
    // but it *is* in the document, so a range ending at the next paragraph's first character
    // sweeps it up. Written without it the two answers read the same and this proves nothing.
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      oneSection("<p>山路を登りながら</p>\n      <p>こう考えた。</p>"),
    ] as const);

    const cfi = await page.evaluate(() => window.frond.findText("山路を登りながら"));

    const facts = await rangeFactsFor(page, cfi!);
    expect(facts!.text).toBe("山路を登りながら");
  });

  test("gives nothing for a phrase that is not in this section", async ({ page }) => {
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      oneSection("<p>山路を登りながら</p>"),
    ] as const);

    expect(await page.evaluate(() => window.frond.findText("吾輩は猫である"))).toBeNull();
  });

  test("gives nothing for the empty string, rather than the start of the section", async ({
    page,
  }) => {
    // An empty query matches everywhere in a plain `indexOf`, and the collapsed range that
    // comes back would read downstream as a real answer pointing at the first character.
    await page.evaluate(([sections]) => window.frond.mountInline(sections as string[], {}), [
      oneSection("<p>山路を登りながら</p>"),
    ] as const);

    expect(await page.evaluate(() => window.frond.findText(""))).toBeNull();
  });
});

function section(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title></head>
  <body>${body}</body>
</html>`;
}

function oneSection(body: string): string[] {
  return [section(body)];
}

function twoSections(): string[] {
  return [section("<p>第0節の本文</p>"), section("<p>第1節の本文</p>")];
}

/**
 * Selects an element's contents by reaching into the iframe — a stand-in for the reader's
 * drag, and the only way these tests can obtain a CFI they did not already have.
 */
async function selectByHand(page: Page, selector: string): Promise<SelectionPayload> {
  await page.evaluate((value) => window.frond.selectText(value as string), selector);
  return await waitForSelection(page);
}

function rangeFactsFor(
  page: Page,
  cfi: string,
): Promise<{
  readonly cfi: string;
  readonly text: string;
  readonly rects: readonly unknown[];
} | null> {
  return page.evaluate((value) => window.frond.rangeFactsFor(value as string), cfi);
}

/** Waits for a selection event carrying a CFI. `selectionchange` is asynchronous. */
async function waitForSelection(page: Page): Promise<SelectionPayload> {
  await expect.poll(async () => ((await lastSelection(page))?.cfi ?? null) !== null).toBe(true);

  const payload = await lastSelection(page);
  if (payload === undefined) throw new Error("no selection event arrived");
  return payload;
}

async function lastSelection(page: Page): Promise<SelectionPayload | undefined> {
  const events: readonly EventRecord[] = await page.evaluate(() => window.frond.events());
  const selections = events.filter((event) => event.name === "selection");
  return selections[selections.length - 1]?.payload as SelectionPayload | undefined;
}

/** What the iframe's own document has selected, read past frond rather than through it. */
async function selectedText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const frame = document.querySelector("#viewport iframe[data-frond-page]");
    return (frame as HTMLIFrameElement).contentDocument?.getSelection()?.toString() ?? "";
  });
}
