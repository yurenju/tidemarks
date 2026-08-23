// Two facts a consumer cannot recover from a rectangle's coordinates: what the stretch under it
// is, and where the glyphs sit inside it. Both come from inside the iframe — one from the tree,
// one from the font's own metrics. Given metrics, the arithmetic is pure, and that half is in
// tests/node/renderer/ink.test.ts.
import { expect, test } from "../support/fixtures.js";
import { openHarness } from "../support/harness.js";
import type { MarkedRectSnapshot } from "../support/harness.js";

/**
 * What `rectsFor` says about each rectangle beyond where it is: what it covers, and where the
 * glyphs sit inside it.
 *
 * A consumer drawing beside the text cannot work either out. The role is a fact about the tree
 * — this stretch is a ruby annotation, that one is the two ideographic spaces a Chinese
 * paragraph opens with — and the tree is inside an iframe. The ink needs the font's own
 * metrics, which are in the same place. Both were guessed at before, from the only thing on
 * offer, which was the width of a box (frond's ADR-0002 / Tidemarks' ADR-0032).
 *
 * The content is hand-written through `mountInline` rather than made a committed fixture:
 * ADR-0007's discipline is one file per **layout ailment**, and "this book writes ruby" or
 * "this book indents with U+3000" is ordinary content, not an ailment.
 */

function section(body: string, style = "", lang = "ja"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}">
  <head><title>t</title><style>${style}</style></head>
  <body>${body}</body>
</html>`;
}

async function mount(page: import("@playwright/test").Page, source: string): Promise<void> {
  await page.evaluate(([one]) => window.frond.mountInline([one as string], {}), [source] as const);
}

/**
 * Every rectangle of the first paragraph, with its role and ink.
 *
 * The CFI comes from the `selection` event rather than from `snapshot()`: the snapshot answers
 * where the reader **is**, which is a caret, and a caret has exactly one rectangle whatever the
 * paragraph under it contains.
 */
async function marked(
  page: import("@playwright/test").Page,
): Promise<readonly MarkedRectSnapshot[]> {
  await page.evaluate(() => window.frond.selectText("p"));
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.frond.events())).filter((one) => one.name === "selection")
          .length,
    )
    .toBeGreaterThan(0);

  const cfi = await page.evaluate(() => {
    const events = window.frond.events();
    const last = events.filter((one) => one.name === "selection").at(-1);
    return (last?.payload as { cfi?: string } | undefined)?.cfi;
  });
  if (cfi === undefined) throw new Error("the selection event carried no CFI");

  return page.evaluate((value) => window.frond.markedRectsFor(value as string), cfi);
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("what each rectangle covers", () => {
  test("a ruby annotation is named, and it is a rectangle of its own", async ({ page }) => {
    await mount(page, section("<p><ruby>山路<rt>やまみち</rt></ruby>を登りながら</p>"));
    const rects = await marked(page);

    // Three stretches: the base characters, the annotation, and the rest of the line. The
    // annotation being separable is the whole point — a consumer that marks it draws a second
    // line beside the first.
    expect(rects.map((one) => one.role)).toEqual(["text", "ruby", "text"]);
  });

  test("the ideographic spaces a paragraph opens with are named apart from the prose", async ({
    page,
  }) => {
    await mount(page, section("<p>　　王文華說過，「要削皮」這三個字。</p>", "", "zh-TW"));
    const rects = await marked(page);

    expect(rects.map((one) => one.role)).toEqual(["blank", "text"]);
    // The indent and the prose share a line, so the blank one comes first and is narrower —
    // which is exactly why it cannot be told apart by geometry.
    expect(rects[0]!.rect.width).toBeLessThan(rects[1]!.rect.width);
  });

  test("a paragraph that is nothing but a space is blank all through", async ({ page }) => {
    await mount(page, section("<p>　</p>", "", "zh-TW"));
    expect((await marked(page)).map((one) => one.role)).toEqual(["blank"]);
  });

  test("an ordinary space is prose, because it collapses and paints nothing", async ({ page }) => {
    await mount(page, section("<p>happy typography and the jury</p>", "", "en"));
    expect((await marked(page)).every((one) => one.role === "text")).toBe(true);
  });
});

test.describe("where the ink sits inside the rectangle", () => {
  test("horizontally, the ink starts below the rectangle's top", async ({ page }) => {
    // The rectangle is the font's content area, and its ascent reaches above the tallest
    // glyph. Drawing against the box rather than the ink is what put the mark on the baseline.
    await mount(
      page,
      section("<p>happy typography</p>", "p { font: 16px serif; line-height: normal; }", "en"),
    );
    const [first] = await marked(page);

    expect(first!.ink.y).toBeGreaterThan(first!.rect.y);
    expect(first!.ink.height).toBeLessThan(first!.rect.height);
    expect(first!.ink.y + first!.ink.height).toBeLessThanOrEqual(
      first!.rect.y + first!.rect.height + 0.01,
    );
  });

  test("the ink is the same for two runs of different letters in one font", async ({ page }) => {
    // Measured from a fixed probe rather than from the text covered. Otherwise marking `mono`
    // and marking `happy` would put the line at two different distances from one baseline.
    await mount(
      page,
      section(
        '<p><span id="a">mono</span> <span id="b">happy</span></p>',
        "p { font: 16px serif; }",
        "en",
      ),
    );
    const rects = await marked(page);
    const heights = new Set(rects.map((one) => Math.round(one.ink.height * 100)));
    expect(heights.size).toBe(1);
  });

  test("vertically, the ink is the rectangle — there is no internal leading to recover", async ({
    page,
  }) => {
    await mount(
      page,
      section(
        "<p>山路を登りながら</p>",
        "html { writing-mode: vertical-rl; } p { font: 18px serif; }",
      ),
    );
    for (const one of await marked(page)) {
      expect(one.ink).toEqual(one.rect);
    }
  });
});

test.describe("the minimum ink gap", () => {
  const GAP = 6;
  /** Long enough to wrap, so there are two lines to measure between. */
  const PROSE = "<p>happy typography and the jury said so she began again at once</p>";

  async function mountWith(
    page: import("@playwright/test").Page,
    style: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    await page.evaluate(
      ([one, patch]) =>
        window.frond.mountInline([one as string], {
          settings: patch as Parameters<typeof window.frond.mountInline>[1]["settings"],
        }),
      [section(PROSE, style, "en"), settings] as const,
    );
  }

  /** The smallest distance between the ink of one line and the ink of the next. */
  async function inkGap(page: import("@playwright/test").Page): Promise<number> {
    const rects = [...(await marked(page))].sort((a, b) => a.ink.y - b.ink.y);
    expect(rects.length, "the prose has to wrap for there to be a gap to measure").toBeGreaterThan(
      1,
    );

    let smallest = Infinity;
    for (let index = 1; index < rects.length; index += 1) {
      const above = rects[index - 1]!.ink;
      smallest = Math.min(smallest, rects[index]!.ink.y - (above.y + above.height));
    }
    return smallest;
  }

  /** A book that names a face and a size and says nothing about leading — the case measured. */
  const SAYS_NOTHING = "p { font-family: serif; font-size: 16px; }";

  test("raises a book that named no line height, until the gap is there", async ({ page }) => {
    await mountWith(page, SAYS_NOTHING, { minimumInkGap: GAP });
    expect(await inkGap(page)).toBeGreaterThanOrEqual(GAP - 0.01);
  });

  test("without the requirement, the same book keeps its own solid setting", async ({ page }) => {
    await mountWith(page, SAYS_NOTHING, {});
    expect(await inkGap(page)).toBeLessThan(GAP);
  });

  test("the `font` shorthand counts as declaring a line height, and wins", async ({ page }) => {
    // `font: 16px serif` resets `line-height` to `normal` **as a declaration on the element**,
    // so it beats a rule inherited from the root however the root got it. Whether that is the
    // book's intent is beside the point — the cascade cannot tell the two apart, and the
    // alternative is a rule specific enough to override books that really did choose. Recorded
    // rather than worked around; ADR-0032 lists it with the other cases the floor leaves.
    await mountWith(page, "p { font: 16px serif; }", { minimumInkGap: GAP });
    expect(await inkGap(page)).toBeLessThan(GAP);
  });

  test("leaves a book that is already loose enough alone", async ({ page }) => {
    await mountWith(page, "p { font: 16px serif; line-height: 2.4; }", { minimumInkGap: GAP });
    expect(
      Number(parseFloat(await page.evaluate(() => window.frond.computed("p", "line-height")))),
    ).toBeCloseTo(16 * 2.4, 1);
  });

  test("stands aside for a line height the reader chose", async ({ page }) => {
    // The reader asked for 1.1 and gets 1.1, tight or not. Their say beats the consumer's.
    await mountWith(page, "p { font: 16px serif; }", { minimumInkGap: GAP, lineHeight: 1.1 });
    expect(
      Number(parseFloat(await page.evaluate(() => window.frond.computed("p", "line-height")))),
    ).toBeCloseTo(16 * 1.1, 1);
  });

  test("survives a relayout, rather than raising and dropping on alternate passes", async ({
    page,
  }) => {
    // The floor is applied by rewriting the layout stylesheet, and that runs again on every
    // resize. Deciding each time by reading the *current* line height is self-cancelling: the
    // second pass sees the height frond itself raised, concludes there is room, and drops the
    // rule. What the reader sees is a mark back across the glyphs after turning the phone.
    await mountWith(page, SAYS_NOTHING, { minimumInkGap: GAP });
    const first = await inkGap(page);

    await page.evaluate(() => window.frond.relayout());

    expect(await inkGap(page)).toBeCloseTo(first, 0);
    expect(await inkGap(page)).toBeGreaterThanOrEqual(GAP - 0.01);
  });

  test("stands aside for a line height the book itself declared, which is a known limit", async ({
    page,
  }) => {
    // The rule carries no !important and sits on the root, so a book that states a line height
    // keeps it — and a consumer drawing between the lines does not get its room. ADR-0032
    // records this as the case the floor deliberately does not cover.
    await mountWith(page, "p { font: 16px serif; line-height: 1; }", { minimumInkGap: GAP });
    expect(await inkGap(page)).toBeLessThan(GAP);
  });
});
