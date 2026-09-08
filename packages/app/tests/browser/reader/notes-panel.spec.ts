// The notes panel as the reader meets it: marks filed under the chapter they were made in, and
// a note that is never cut.
//
// **Wiring tests.** Which chapter a mark falls in, and where one run of them ends, is exhausted
// in `src/lib/annotation-groups.test.ts` where it costs nothing. What only a browser can answer
// is that the panel really reads the chapters the book was opened with — the boundaries are
// built at open and carried through three components — and that the note in front of the reader
// is whole, which is a question about a stylesheet and a layout rather than about a function.
//
// The passage's own three-line cut is `highlights.spec.ts`'s, in the file that draws a real mark
// by dragging over real text. What is asked here instead is the control beside it: whether the
// panel can tell a passage that is really cut from one that merely fills three lines, and what
// pressing it does. That is geometry plus a stylesheet, so no layer below this one can answer it.
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
 * A note of three paragraphs, which is the shape the cut used to lose: only the first was
 * visible, and the only route to the other two was the editor.
 */
const LONG_NOTE = [
  "The first thing I thought when I read this, written down in a hurry so as not to lose it.",
  "What I thought about it again a week later, once the chapter it belongs to had finished.",
  "And a reminder to copy both of those out somewhere the book cannot take them back.",
].join("\n\n");

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
  const headings = panel.locator(".annotation-chapter-name");
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
});

test("a note of several paragraphs is shown whole, and as paragraphs", async ({ page }) => {
  await openNotes(page);
  const note = page.getByTestId("panel-notes").locator(".note-text").first();

  const measured = await note.evaluate((el) => ({
    shown: el.getBoundingClientRect().height,
    whole: el.scrollHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));

  // Taller than three lines, or the note is not long enough here to prove anything — and nothing
  // of it is cut off. The passage above it may be; the note never is, because the only way back
  // to a cut note would be the editor.
  expect(Math.round(measured.shown / measured.line)).toBeGreaterThan(3);
  expect(measured.whole).toBeLessThanOrEqual(measured.shown + 1);

  // The blank line between two paragraphs is the reader's, and it survives to the screen: a note
  // rendered with collapsed whitespace runs the three together into one block.
  await expect(note).toHaveCSS("white-space", "pre-wrap");
});

test("the whole passage is one press away, and only where something is hidden", async ({
  page,
}) => {
  await openNotes(page);
  const panel = page.getByTestId("panel-notes");
  const expand = panel.getByRole("button", { name: "Show the whole passage" });

  // One press, not two: the short passage has nothing under its third line, and a control
  // offering to open what is already open would be the panel announcing a rest that is not there.
  await expect(expand).toHaveCount(1);

  const quote = panel.locator(".annotation-quote-text").first();
  const cut = await quote.evaluate((el) => ({
    shown: el.getBoundingClientRect().height,
    whole: el.scrollHeight,
  }));
  expect(
    cut.whole,
    "the long passage fits in three lines here, so nothing is being hidden",
  ).toBeGreaterThan(cut.shown + 1);

  await expand.click();

  // The passage now stands at its full height, and the control stays — as the way back, and so
  // that a press does not destroy the element the keyboard was on (ADR-0021).
  await expect
    .poll(() => quote.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(cut.shown + 1);
  await expect(panel.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
