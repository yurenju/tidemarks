// What each engine owes on its own terms once a real fragmentation has decided where the pages
// fall: turn out and back, adjacent pages in order, CFI → page → CFI, a CFI outliving a
// relayout. None of it can be asked of arithmetic, and none of it asks the three to produce the
// same number — that half is cross-browser.spec.ts.
import { expect, test } from "../support/fixtures.js";
import { compareCfi, parseCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness, type Snapshot } from "../support/harness.js";

/**
 * The slot ADR-0004's #7 revision names:
 *
 * > When vertical, page counts, break positions and anything derived from them (page
 * > numbers, characters per page) are excluded from cross-browser comparison. That slot is
 * > instead guarded by **self-consistency invariants within one browser**: turning to the
 * > end and back leaves the position unchanged, adjacent pages' boundary characters are
 * > contiguous in document order, CFI → page → CFI is the identity, and a CFI returns to
 * > the same passage after a font-size change.
 *
 * Those four follow. **Each holds in each engine on its own terms, with no need for the
 * three to produce the same number** — the three engines' multicol fragmentation does not
 * agree by construction (Chromium lays out 4 pages while Firefox and WebKit lay out 3
 * each, on one fixture, one viewport and one set of settings).
 *
 * It is also why this spec contains not one hard-coded page count.
 */

const LARGE = { fontSize: 64 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test("turning to the book's end and back returns to the same position at every step", async ({
  page,
}) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const forward: Snapshot[] = [await page.evaluate(() => window.frond.snapshot())];
  while (!forward[forward.length - 1]!.atEnd && forward.length < 200) {
    forward.push(await page.evaluate(() => window.frond.next()));
  }

  expect(forward.length).toBeGreaterThan(3);
  expect(forward[forward.length - 1]!.atEnd).toBe(true);

  // The return trip. Every step has to land on the outbound trip's same position — right
  // down to an identical CFI.
  for (let step = forward.length - 2; step >= 0; step -= 1) {
    const back = await page.evaluate(() => window.frond.previous());

    expect(back.sectionIndex, `section at step ${step}`).toBe(forward[step]!.sectionIndex);
    expect(back.page, `page at step ${step}`).toBe(forward[step]!.page);
    expect(back.cfi, `CFI at step ${step}`).toBe(forward[step]!.cfi);
  }
});

test("adjacent pages' positions are strictly increasing in the book", async ({ page }) => {
  // The assertable form of "adjacent pages' boundary characters are contiguous in document
  // order": the next page's start has to come after this page's. Going backwards means
  // pagination reordered the content; being equal means a page did not advance, which means
  // content was skipped or duplicated.
  await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });

  let previous = await page.evaluate(() => window.frond.snapshot());

  for (let step = 0; step < 20; step += 1) {
    const current = await page.evaluate(() => window.frond.next());
    if (current.sectionIndex !== previous.sectionIndex) break;

    expect(
      compareCfi(parseCfi(previous.cfi), parseCfi(current.cfi)),
      `page ${previous.page} to page ${current.page}`,
    ).toBe("before");

    previous = current;
    if (current.atEnd) break;
  }

  expect(previous.page).toBeGreaterThan(3);
});

test("CFI → go there → CFI is the identity, on every page", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const marks: Snapshot[] = [];
  let current = await page.evaluate(() => window.frond.snapshot());
  while (!current.atEnd && marks.length < 30) {
    marks.push(current);
    current = await page.evaluate(() => window.frond.next());
  }
  marks.push(current);

  for (const mark of marks) {
    // Go somewhere else first, so this is not "it was already sitting there".
    await page.evaluate(() => window.frond.goToSection(0));
    const restored = await page.evaluate((cfi) => window.frond.goToCfi(cfi as string), mark.cfi);

    expect(restored.sectionIndex, mark.cfi).toBe(mark.sectionIndex);
    expect(restored.page, mark.cfi).toBe(mark.page);
    expect(restored.cfi, mark.cfi).toBe(mark.cfi);
  }
});

test("after a font-size change, a CFI returns to the same passage", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });
  await page.evaluate(() => window.frond.next());

  const mark = await page.evaluate(() => window.frond.snapshot());
  const before = await page.evaluate((cfi) => window.frond.textAt(cfi as string, 16), mark.cfi);

  await page.evaluate(() => window.frond.applySettings({ fontSize: 28 }));
  const after = await page.evaluate((cfi) => window.frond.textAt(cfi as string, 16), mark.cfi);

  // The same CFI still points at the same passage after relayout — **a CFI is not a
  // function of the layout**.
  expect(after).toBe(before);
  expect(after).not.toBeNull();
});

test("a section's page count matches the pages that can actually be turned to", async ({
  page,
}) => {
  // The page count is not for comparing across browsers, but within one it has to tell the
  // truth: reporting N pages means page N−1 is exactly reachable, and the section changes
  // after page N−1.
  //
  // **The only test here that says how long it is allowed to take**, because it is the only
  // one whose length is not a constant: it turns every page of the section, and how many
  // that is belongs to the engine. Against the default 30s it timed out on a busy runner
  // (#17). The turns moved into the page first — that took away the 80% of the budget going
  // on the process boundary rather than on turning pages, and what is left is what a turn
  // actually costs. Naming a budget without having done that would have been the amplifier
  // dressed up as a fix (docs/agents/flaky.md).
  test.slow();

  const start = await mountFixture(page, "huge-single-section", {
    settings: { columns: 1 },
  });

  expect(start.pageCount).toBeGreaterThan(5);

  // The turns are taken **inside the page**, which is the one loop in this file that has to
  // be: its length is the section's page count rather than a small constant, and the budget
  // it runs against is a fixed 30s. Driven a turn at a time from here, over 80% of that
  // budget goes on crossing the process boundary rather than on turning pages — enough to
  // time out on a machine busy with the rest of the suite (#17, and `walkNext`'s comment).
  const landings = await page.evaluate(
    (times) => window.frond.walkNext(times as number),
    start.pageCount - 1,
  );

  expect(landings).toHaveLength(start.pageCount - 1);
  landings.forEach((landing, step) => {
    expect(landing.sectionIndex, `section at step ${step}`).toBe(0);
  });

  const current = landings[landings.length - 1]!;
  expect(current.page).toBe(start.pageCount - 1);
  expect(current.atEnd).toBe(true);
});
