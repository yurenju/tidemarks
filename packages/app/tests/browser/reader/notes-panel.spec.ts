// The notes panel as the reader meets it: marks filed under the chapter they were made in, and
// a card that shows a note cut until it is selected, then whole inside the card.
//
// **Wiring tests.** Which chapter a mark falls in, and where one run of them ends, is exhausted
// in `src/lib/annotation-groups.test.ts` where it costs nothing. What only a browser can answer
// is that the panel really reads the chapters the book was opened with — the boundaries are
// built at open and carried through three components — and how tall a note stands, which is a
// question about a stylesheet and a layout rather than about a function.
//
// The passage's own two-line cut is `highlights.spec.ts`'s, in the file that draws a real mark
// by dragging over real text.
//
// [[Delete]] asking first is here too. What it needs a browser for is the panel around it: the
// question has to hold the focus inside a drawer that claims presses and Escape for itself, and
// the deletion it ends in runs through the reader's store and back into the list.
//
// **The marks are seeded rather than drawn.** Two marks in two named chapters is what the
// grouping needs, and reading far enough into the book to make the second one by hand would cost
// a whole-book index and a dozen turns per engine to reach a state two `put`s describe exactly.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, openPanel, settled, visibleText } from "../support/library.js";

// Alice's sixth spine item is chapter one and her eighth is chapter three — the same two paths
// `visit.spec.ts` reads off the book, and inside them her prose begins at `/4/2/2/2/1`.
const IN_CHAPTER_ONE = "epubcfi(/6/12!/4/2,/2/2/1:0,/2/2/1:8)";
const IN_CHAPTER_THREE = "epubcfi(/6/16!/4/2,/2/2/1:0,/2/2/1:8)";

/** Two lines at most in a panel this wide, so nothing about it is hidden. */
const LATE_PASSAGE = "A passage from further in";

/**
 * Long enough to run past three lines in the panel at any of the type sizes the reader can
 * choose — which is what the fade and the press under it are for.
 */
const EARLY_PASSAGE = [
  "A passage from the first chapter, and a long one:",
  "the reader dragged over the whole paragraph rather than a phrase in it,",
  "which is the ordinary way to mark something worth coming back to",
  "and the shape that filled the panel on its own before it was cut.",
].join(" ");

/**
 * A note of twelve paragraphs: past three lines, so the unselected card has something to cut, and
 * past the 340px the selected card gives a note before it scrolls, at any type size the reader can
 * choose.
 */
const LONG_NOTE = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1}: what I thought about this passage, written down so as not to lose it.`,
).join("\n\n");

/** Writes marked passages straight into IndexedDB — the rows a highlight leaves behind. */
async function seedMarks(
  page: Page,
  bookId: string,
  marks: readonly { id: string; cfiRange: string; text: string; note: string }[],
): Promise<void> {
  await page.evaluate(
    ([id, rows]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("annotations", "readwrite");
          for (const row of rows) {
            tx.objectStore("annotations").put({
              ...row,
              bookId: id,
              color: "indigo",
              createdAt: 1_000,
              updatedAt: 1_000,
              deletedAt: null,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [bookId, marks] as const,
  );
}

type SeededMark = { id: string; cfiRange: string; text: string; note: string };

/** Imports Alice, writes the marks into her — the two above unless told otherwise — and opens her
 *  with the notes panel standing. */
async function openNotes(
  page: Page,
  marks: readonly SeededMark[] = [
    { id: "notes-early", cfiRange: IN_CHAPTER_ONE, text: EARLY_PASSAGE, note: LONG_NOTE },
    { id: "notes-late", cfiRange: IN_CHAPTER_THREE, text: LATE_PASSAGE, note: "" },
  ],
): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(BOOKS.horizontal);
  const card = bookCards(page).filter({ hasText: /Alice/ });
  await expect(card).toBeVisible({ timeout: 30_000 });

  const bookId = (await card.getAttribute("data-book-id"))!;
  await seedMarks(page, bookId, marks);
  await card.getByTestId("book-open").click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
  await openPanel(page, /Notes/);
}

test("the marks are filed under the chapters they were made in, in book order", async ({
  page,
}) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");

  // Two runs, because the two marks are in two chapters. The names are Alice's own words, so
  // what is asserted is that they are the book's headings and that they arrive in the order the
  // book puts them in — not what Lewis Carroll called his chapters.
  const headings = panel.locator(".annotation-chapter-label");
  await expect(headings).toHaveCount(2);
  // **Checked against the book's own contents**, rather than against "two different non-empty
  // strings": section indices, TOC rows and any other pair of distinct labels would pass that,
  // and filing a mark under the wrong name is exactly the failure worth catching.
  const named = await headings.allInnerTexts();
  await openPanel(page, /Contents/);
  const contents = await page.getByTestId("panel-toc").getByRole("button").allInnerTexts();
  await openPanel(page, /Notes/);
  const trimmed = contents.map((entry) => entry.trim());
  for (const name of named) expect(trimmed).toContain(name.trim());
  expect(named[0]).not.toBe(named[1]);

  // Each heading stands over its own mark, which is the half a count cannot show: a panel that
  // rendered both headings and then all the marks under the second would pass the check above.
  const runs = panel.getByTestId("annotation-chapter");
  await expect(runs.nth(0).getByRole("button", { name: EARLY_PASSAGE })).toBeVisible();
  await expect(runs.nth(1).getByRole("button", { name: LATE_PASSAGE })).toBeVisible();

  // And the run the page is in says so. Which chapter that is comes from where the book is,
  // through the same boundaries — so it moves when the book does.
  await runs.nth(0).getByRole("button", { name: EARLY_PASSAGE }).click();
  await expect(runs.nth(0).getByRole("heading")).toContainText("In this chapter");
  await expect(runs.nth(1).getByRole("heading")).not.toContainText("In this chapter");
});

test("a note is cut until its card is selected, then scrolls inside the card to its end", async ({
  page,
}) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");
  const note = panel.locator(".note-text").first();

  // Three lines while the reader is scanning the list, so one long note does not push every
  // other card off the panel.
  const cut = await note.evaluate((el) => ({
    shown: el.getBoundingClientRect().height,
    whole: el.scrollHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(Math.round(cut.shown / cut.line)).toBe(3);
  expect(cut.whole).toBeGreaterThan(cut.shown + 1);

  // Pressing the passage selects the card, and that is the way to the rest of the note.
  await panel.getByRole("button", { name: EARLY_PASSAGE }).click();
  const body = panel.locator(".note-body").first();
  await expect.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  // The blank line between two paragraphs is the reader's, and it survives to the screen.
  await expect(note).toHaveCSS("white-space", "pre-wrap");

  // The line under it counts the paragraphs, then says when there is nothing left below.
  await expect(panel.getByText("12 paragraphs · more below")).toBeVisible();
  await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(panel.getByText("At the end")).toBeVisible();
});

test("delete asks in the item first, and only the confirming press removes the mark", async ({
  page,
}) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");
  // The long passage is the first of the two in book order, and the only one with a note.
  const passage = panel.getByRole("button", { name: EARLY_PASSAGE });
  const question = panel.getByRole("group", { name: "Delete this mark and its note?" });
  const asking = panel.getByRole("button", { name: "Delete", exact: true });

  // Only the selected card carries [[Delete]], in its date row; a list of cards each with its own
  // row of buttons is what the panel stopped being.
  await expect(asking).toHaveCount(0);
  await passage.click();
  await expect(asking).toHaveCount(1);

  // The first press asks, and the answer one Enter away is the one that keeps the note.
  await asking.click();
  await expect(question).toBeVisible();
  await expect(question.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Escape is Cancel, and only Cancel: the panel is still standing behind the question.
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(asking).toBeFocused();

  await asking.click();
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(passage).toBeVisible();

  await asking.click();
  await question.getByRole("button", { name: "Delete" }).click();
  await expect(passage).toHaveCount(0);
  await expect(panel.getByRole("button", { name: LATE_PASSAGE })).toBeVisible();
});

// [[Reflect]] as a state rather than a panel of [[Find]]'s: what a turn does to it, and the key that
// opens it. Which event leads where is `chrome.test.ts`'s, row by row; what is asked here is only
// that the page buttons and the keyboard really send those events, and that a press beside the
// panel is not taken by the panel as a reason to close.
test("a page turned in Reflect leaves the list standing", async ({ page }) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");

  // The bars are not part of [[Reflect]]: it is the book and the reader's notes, nothing else.
  await expect(page.getByTestId("chrome-bottom")).toBeHidden();

  const before = await visibleText(page);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect.poll(async () => await visibleText(page)).not.toBe(before);

  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/d=notes/);
});

test("N opens Reflect from the book, and closes it again", async ({ page }) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();

  await page.keyboard.press("n");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("chrome-top")).toBeHidden();

  // The same key on the way out is Escape: back to [[Read]], not to the bars.
  await page.keyboard.press("n");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("chrome-bottom")).toBeHidden();
});

// Where the list points is `annotation-position.test.ts`'s, rung by rung. What is asked here is that
// the reader really hands it the page it is on — the marks the highlight layer painted, and where
// the page begins — and really scrolls the panel to the answer without pointing at it.

/**
 * Alice open on chapter three's first page, which holds the late mark, with eight long-noted marks
 * from chapter one ahead of it in the list — enough that a list left at its top has no room to
 * show the late one — and one more mark further on, so that the page's first mark is not also the
 * book's last, which is where the list falls back to when it is handed no page at all.
 */
async function openNotesInChapterThree(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(BOOKS.horizontal);
  const card = bookCards(page).filter({ hasText: /Alice/ });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const bookId = (await card.getAttribute("data-book-id"))!;

  await seedMarks(page, bookId, [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `notes-early-${i}`,
      cfiRange: IN_CHAPTER_ONE,
      text: `${EARLY_PASSAGE} (${i + 1})`,
      note: LONG_NOTE,
    })),
    { id: "notes-late", cfiRange: IN_CHAPTER_THREE, text: LATE_PASSAGE, note: "" },
    { id: "notes-later", cfiRange: FURTHER_ON, text: LATER_PASSAGE, note: "" },
  ]);
  // By address, to reach the scene: what is under test is the panel, not the way to chapter three.
  const at = encodeURIComponent("cfi:epubcfi(/6/16!/4/2/2/2/1:0)");
  await page.goto(`/#/book/${encodeURIComponent(bookId)}?at=${at}`);
  await expect(page.locator('.reader[data-at="arrived"]')).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await openPanel(page, /Notes/);
}

/** Two spine items past chapter three. */
const FURTHER_ON = "epubcfi(/6/20!/4/2,/2/2/1:0,/2/2/1:8)";
const LATER_PASSAGE = "A passage from later still";

test("the list opens on the page's first mark, with nothing pointed at", async ({ page }) => {
  await openNotesInChapterThree(page);
  const panel = page.getByTestId("panel-notes");

  await expect(panel.getByRole("button", { name: LATE_PASSAGE })).toBeInViewport();
  await expect(panel.getByRole("button", { name: `${EARLY_PASSAGE} (1)` })).not.toBeInViewport();
  // Scrolled to, not selected: no card is lit, so none of the others is dimmed around it.
  await expect(panel.locator(".annotation-item.selected")).toHaveCount(0);
});

test("a page turned in Reflect brings the list to that page's first mark", async ({ page }) => {
  await openNotesInChapterThree(page);
  const panel = page.getByTestId("panel-notes");
  const late = panel.getByRole("button", { name: LATE_PASSAGE });
  await expect(late).toBeInViewport();

  // The reader scrolls the list away, then turns off the page and back onto it. Turning onto the
  // page it opened on is what makes the answer knowable here without measuring where chapter
  // three's pages break.
  await panel.locator(".panel-body").evaluate((body) => (body.scrollTop = 0));
  await expect(late).not.toBeInViewport();
  const before = await visibleText(page);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect.poll(async () => await visibleText(page)).not.toBe(before);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect.poll(async () => await visibleText(page)).toBe(before);

  await expect(late).toBeInViewport();
  await expect(panel.locator(".annotation-item.selected")).toHaveCount(0);
});

/**
 * [[Notes]] on a phone: an index, and a page per note (#239).
 *
 * What the stepping lands on — which mark is before and after, how far through the book — is
 * `src/lib/annotation-position.test.ts`'s. What only a browser can say is that the page really
 * reads the book's own words rather than the stored quote, that its title follows the chapter, and
 * how tall the passage stands before it is cut, which is a question about a layout.
 */
test.describe("on a phone, one note to a page", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(
    ({ browserName }) => browserName === "firefox",
    "Playwright has no mobile emulation for Firefox",
  );

  test("a note's page steps across a chapter's end, and greys the step at the book's", async ({
    page,
  }) => {
    await openNotes(page);
    const panel = page.getByTestId("panel-notes");
    await panel.getByTestId("notes-index").getByRole("button", { name: EARLY_PASSAGE }).click();

    const note = panel.getByTestId("note-page");
    await expect(note).toBeVisible();
    await expect(note.getByRole("button", { name: /All/ })).toContainText("1 / 2");
    await expect(note.getByRole("button", { name: "‹ Previous" })).toBeDisabled();
    const firstChapter = await panel.getByRole("heading").innerText();

    await note.getByRole("button", { name: "Next ›" }).click();
    await expect(note.getByRole("button", { name: /All/ })).toContainText("2 / 2");
    await expect(note.getByRole("button", { name: "Next ›" })).toBeDisabled();
    await expect(panel.getByRole("heading")).not.toHaveText(firstChapter);
    // **The book's words, not the quote the mark stored.** The seeded mark says it is
    // `LATE_PASSAGE`, and its CFI says it is the chapter's numeral: the page reads the epub.
    await expect(note.locator("mark")).toHaveText("III");
  });

  test("a passage past half the screen is cut on a line, and opens and closes", async ({
    page,
  }) => {
    // Four of chapter one's paragraphs, which at this width run well past half of 844px.
    await openNotes(page, [
      {
        id: "notes-long",
        cfiRange: "epubcfi(/6/12!/4/2[chapter-1],/4/1:10,/12/1:20)",
        text: "A passage over four paragraphs",
        note: "",
      },
    ]);
    const panel = page.getByTestId("panel-notes");
    await panel.getByTestId("notes-index").getByRole("button").click();
    const note = panel.getByTestId("note-page");
    const source = note.locator(".note-page-source");

    const more = note.getByRole("button", { name: /Show the full text \(\d+ more lines\)/ });
    await expect(more).toBeVisible();
    const cut = await source.evaluate((box) => ({
      height: box.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(box).lineHeight),
    }));
    expect(cut.height).toBeLessThanOrEqual(844 / 2);
    // On a whole line: a cut through one leaves the tops of a row of characters standing.
    expect(cut.height / cut.line).toBeCloseTo(Math.round(cut.height / cut.line), 2);

    await more.click();
    const less = note.getByRole("button", { name: "Show less of the text" });
    await expect(less).toBeVisible();
    expect((await source.boundingBox())!.height).toBeGreaterThan(cut.height);

    await less.click();
    await expect(more).toBeVisible();
    expect((await source.boundingBox())!.height).toBeCloseTo(cut.height, 0);
  });
});
