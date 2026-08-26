// The shelf's own card: today's five marked passages, one at a time, from whichever books they
// came from. **Which five, and in what order, is not asked here** — that is a sort over
// `lastShownAt`, proven exhaustively in `src/lib/revisit.test.ts`, and the line-length ceiling
// is `src/lib/line-length.ts`. What is asked here is what only a browser can answer: that the
// card is what a reader meets first, that the source on it is the loudest title on the screen,
// that it holds one height while they flick through it, and that pressing the passage really
// does put them back in the book it came from.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, settled } from "../support/library.js";

/** A passage the reader marked, written the way the reader's own highlight would write it. */
interface Seed {
  bookId: string;
  text: string;
  note: string;
  createdAt: number;
}

/**
 * Puts marked passages on the shelf by writing the rows a highlight would leave.
 *
 * Straight into IndexedDB, which the support helpers otherwise avoid. The alternative is
 * selecting prose in two different books and painting it, which is four page turns and a
 * selection per passage — and none of that is what this file is about. `reader/` covers the
 * path that writes these rows for real.
 */
async function seedMarks(page: Page, seeds: Seed[]): Promise<void> {
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("annotations", "readwrite");
          const store = tx.objectStore("annotations");
          for (const [index, row] of rows.entries()) {
            store.put({
              id: `seed-${index}`,
              bookId: row.bookId,
              cfiRange: "epubcfi(/6/2!/4,/2/1:0,/2/1:8)",
              text: row.text,
              note: row.note,
              color: "indigo",
              createdAt: row.createdAt,
              updatedAt: row.createdAt,
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
    seeds,
  );
}

/** The id of the card carrying this title. */
async function bookIdOf(page: Page, title: RegExp): Promise<string> {
  const id = await bookCards(page).filter({ hasText: title }).first().getAttribute("data-book-id");
  expect(id).toBeTruthy();
  return id!;
}

/**
 * The card, as a region to look inside.
 *
 * The two arrows are then found by the names they carry rather than by a testid of their own:
 * the testid says which block, the role and name say which control, and a name that goes missing
 * is the kind of break nobody reports (ADR-0021).
 */
function card(page: Page) {
  return page.getByTestId("mark-card");
}

/** How wide the quote is allowed to run, in ems of its own type size. */
async function quoteEms(page: Page): Promise<number> {
  return await page.getByTestId("mark-quote").evaluate((quote) => {
    const style = getComputedStyle(quote);
    return parseFloat(style.maxWidth) / parseFloat(style.fontSize);
  });
}

/** Walks the whole batch, gathering what each card says and how tall the card stands. */
async function walkBatch(page: Page): Promise<{ texts: string[]; heights: number[] }> {
  const total = Number((await page.getByTestId("mark-count").textContent())!.split(" of ")[1]);
  const texts: string[] = [];
  const heights: number[] = [];
  for (let i = 0; i < total; i++) {
    texts.push((await page.getByTestId("mark-quote").textContent())!);
    heights.push((await card(page).boundingBox())!.height);
    if (i < total - 1) await card(page).getByRole("button", { name: "Next passage" }).click();
  }
  return { texts, heights };
}

const LATIN = "Alice was beginning to get very tired of sitting by her sister on the bank.";
const HAN = "我冒了嚴寒，回到相隔二千餘里，別了二十餘年的故鄉去。";

/** Both books on the shelf, by id: Alice, and the Chinese one. */
async function twoBooks(page: Page): Promise<{ alice: string; chinese: string }> {
  await importBook(page, BOOKS.horizontal, /Alice/);
  await importBook(page, BOOKS.emphasis, /字重與強調/);
  return {
    alice: await bookIdOf(page, /Alice/),
    chinese: await bookIdOf(page, /字重與強調/),
  };
}

/** Enough marked passages that the card has to choose, rather than showing all there is. */
function manyMarks(bookId: string, count: number): Seed[] {
  return Array.from({ length: count }, (_, i) => ({
    bookId,
    text: `Marked passage number ${i}, kept for later.`,
    note: "",
    createdAt: 1_000 + i,
  }));
}

test("nothing marked says what the slot is for", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  await expect(page.getByTestId("marks-empty")).toBeVisible();
  await expect(page.getByTestId("mark-card")).toHaveCount(0);
});

test("the card draws five out of many, and stops at both ends", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, manyMarks(alice, 12));
  await page.reload();

  // Five of the twelve, and the count says so. Which five is `revisit.test.ts`.
  await expect(page.getByTestId("mark-count")).toHaveText("1 of 5");
  // **No wrapping.** The batch has two ends, and an arrow that came back round would make them
  // unfindable — a reader cannot tell a full circuit from a card that has stopped responding.
  await expect(card(page).getByRole("button", { name: "Previous passage" })).toBeDisabled();

  await card(page).getByRole("button", { name: "Next passage" }).click();
  await expect(page.getByTestId("mark-count")).toHaveText("2 of 5");
  await expect(card(page).getByRole("button", { name: "Previous passage" })).toBeEnabled();

  for (let i = 0; i < 3; i++) {
    await card(page).getByRole("button", { name: "Next passage" }).click();
  }
  await expect(page.getByTestId("mark-count")).toHaveText("5 of 5");
  await expect(card(page).getByRole("button", { name: "Next passage" })).toBeDisabled();
});

test("the card is one height all the way through the five", async ({ page }) => {
  await page.goto("/");
  const { alice, chinese } = await twoBooks(page);

  // Passages of wildly different lengths, which is the whole difficulty: a card sized to its
  // contents moves the arrows out from under the reader's thumb between one flick and the next.
  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "", createdAt: 1_000 },
    { bookId: chinese, text: HAN, note: "再讀一次。", createdAt: 2_000 },
    { bookId: chinese, text: "短。", note: "", createdAt: 3_000 },
    { bookId: alice, text: `${LATIN} ${LATIN} ${LATIN} ${LATIN}`, note: "", createdAt: 4_000 },
    { bookId: chinese, text: HAN.repeat(6), note: "很長的一則想法。".repeat(4), createdAt: 5_000 },
  ]);
  await page.reload();

  const { heights } = await walkBatch(page);
  expect(heights).toHaveLength(5);
  for (const height of heights) expect(height).toBeCloseTo(heights[0]!, 0);
});

test("today's five are the same five after a reload", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, manyMarks(alice, 12));
  await page.reload();
  const first = await walkBatch(page);

  // The reader may not be able to say yet why a passage stayed with them. A card that redrew
  // every time they came back to the shelf would never give them the chance to find out.
  await page.reload();
  const second = await walkBatch(page);
  expect(second.texts).toEqual(first.texts);
});

test("asking for another five starts again at the first of them", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, manyMarks(alice, 12));
  await page.reload();

  await card(page).getByRole("button", { name: "Next passage" }).click();
  await card(page).getByRole("button", { name: "Next passage" }).click();
  await expect(page.getByTestId("mark-count")).toHaveText("3 of 5");

  await page.getByTestId("mark-repick").click();
  await expect(page.getByTestId("mark-count")).toHaveText("1 of 5");
  // **There is no way to clear the card, and that is deliberate** — anything that can be
  // emptied becomes a thing owed. Asking for more is the only control here.
  await expect(card(page)).toBeVisible();
});

test("the passage on the card carries its own book's line-length ceiling", async ({ page }) => {
  await page.goto("/");
  const { alice, chinese } = await twoBooks(page);

  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "", createdAt: 1_000 },
    { bookId: chinese, text: HAN, note: "再讀一次。", createdAt: 2_000 },
  ]);
  await page.reload();

  // **Both ceilings, and that is one proposition rather than two.** What is under test here is
  // that the ceiling comes from *this passage's own book* — a card with `40em` written into its
  // stylesheet would pass either assertion on its own, and only fail when the two disagree. The
  // numbers themselves belong to `src/lib/line-length.test.ts`, which is where they are pinned.
  const seen = new Map<string, number>();
  for (let i = 0; i < 2; i++) {
    seen.set((await page.getByTestId("mark-quote").textContent())!, await quoteEms(page));
    if (i === 0) await card(page).getByRole("button", { name: "Next passage" }).click();
  }
  expect(seen.get(LATIN)).toBeCloseTo(30, 1);
  expect(seen.get(HAN)).toBeCloseTo(40, 1);
});

test("pressing the passage opens the book it came from", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [{ bookId: alice, text: LATIN, note: "", createdAt: 1_000 }]);
  await page.reload();

  // The book's own words go back to the book; the reader's own note opens for writing. Both
  // presses live on this card, so which is which has to be legible from the words themselves.
  await page.getByTestId("mark-quote").click();
  await expect(page.locator(".reader")).toBeVisible();
  expect(page.url()).toContain(`#/book/${alice}`);
});

test("a thought written on the shelf is still there after a reload", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [{ bookId: alice, text: LATIN, note: "", createdAt: 1_000 }]);
  await page.reload();

  await page.getByTestId("mark-note-input").fill("Down the rabbit-hole again.");
  // Committed on the way out: the card is not a form, and leaving it is what finishing looks
  // like — so the assertion has to leave it too. Pressed on the age rather than on the quote,
  // because the quote now leaves the shelf entirely.
  await page.getByTestId("mark-when").click();
  // The box turning back into the written line is what committed looks like from outside, and it
  // is read back from the database — so reloading any earlier throws the write away with the page.
  await expect(page.getByTestId("mark-note")).toContainText("Down the rabbit-hole again.");
  await page.reload();

  await expect(page.getByTestId("mark-note")).toContainText("Down the rabbit-hole again.");
});

test("the source is the loudest book title on the first screen", async ({ page }) => {
  await page.goto("/");
  const { chinese } = await twoBooks(page);

  // The book in progress is the one with nothing marked in it — the case the card has to
  // survive, because that is the title a reader would otherwise hand the passage to.
  await bookCards(page).filter({ hasText: "Alice" }).getByTestId("book-open").click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
  await page.goBack();
  await expect(page.getByTestId("reading-now-title")).toContainText("Alice");

  await seedMarks(page, [{ bookId: chinese, text: HAN, note: "", createdAt: 2_000 }]);
  await page.reload();

  await expect(page.getByTestId("mark-book")).toContainText("字重與強調");
  const sizeOf = (id: string) =>
    page.getByTestId(id).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(await sizeOf("mark-book")).toBeGreaterThan(await sizeOf("reading-now-title"));
});

test("the shelf stops widening, and centres in what is left", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  const shelfBox = async () => (await page.locator(".library").boundingBox())!;

  await page.setViewportSize({ width: 1280, height: 900 });
  const narrow = await shelfBox();
  await page.setViewportSize({ width: 2560, height: 900 });
  const wide = await shelfBox();

  expect(wide.width).toBeCloseTo(narrow.width, 0);
  // Centred: the same gap on both sides. Measured against the box the shelf actually sits in
  // rather than against the window — the page holds a scrollbar's width of the right edge open
  // (`scrollbar-gutter: stable`), so the window's own width is 15px wider than the space being
  // divided, and an assertion written against it fails on a shelf that is correctly centred.
  const gaps = await page.locator(".library").evaluate((shelf) => {
    const box = shelf.getBoundingClientRect();
    const around = shelf.parentElement!.getBoundingClientRect();
    return { left: box.left - around.left, right: around.right - box.right };
  });
  expect(gaps.left).toBeCloseTo(gaps.right, 0);
});
