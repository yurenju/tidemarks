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
import { BOOKS, bookCards, openPanel, settled } from "../support/library.js";

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

/** Imports Alice, writes the two marks into her, and opens her with the notes panel standing. */
async function openNotes(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(BOOKS.horizontal);
  const card = bookCards(page).filter({ hasText: /Alice/ });
  await expect(card).toBeVisible({ timeout: 30_000 });

  const bookId = (await card.getAttribute("data-book-id"))!;
  await seedMarks(page, bookId, [
    { id: "notes-early", cfiRange: IN_CHAPTER_ONE, text: EARLY_PASSAGE, note: LONG_NOTE },
    { id: "notes-late", cfiRange: IN_CHAPTER_THREE, text: LATE_PASSAGE, note: "" },
  ]);
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
