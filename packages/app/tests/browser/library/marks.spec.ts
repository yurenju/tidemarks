// The shelf's own card: one marked passage, the reader's note on it, and the two presses.
// **Which passage is not asked here** — that is a draw, proven in `src/lib/revisit.test.ts`, and
// the line-length ceiling is `src/lib/line-length.ts`. What is asked here is what only a browser
// can answer: that the card is what a reader meets first and holds still for the day, that the
// passage carries its own book's measure, that the head row sheds its parts by measuring rather
// than at a width, and that pressing the passage really does put the reader back in the book it
// came from — **without that arrival becoming where they had read to**, which is this entrance's
// own wire into 〈回訪模式〉. The rule behind that one is `src/lib/visit.test.ts`'s, and the
// reader's other way into it is `reader/visit.spec.ts`'s.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, bookCards, importBook, PAGE_FRAME, seedProgress } from "../support/library.js";

/** A passage the reader marked, written the way the reader's own highlight would write it. */
interface Seed {
  bookId: string;
  text: string;
  note: string;
  createdAt: number;
  /** Where in the book this passage is. Section 0 unless a test needs somewhere further in. */
  cfiRange?: string;
}

/** A passage in the first section, which is where a book opens anyway. */
const IN_SECTION_ZERO = "epubcfi(/6/2!/4,/2/1:0,/2/1:8)";

/**
 * A passage several sections in, for the one test that asks *where* a tap lands.
 *
 * Alice's spine has eleven items and `chapter-3.xhtml` is the eighth, so the itemref step is
 * `/6/16`. Anywhere past the front matter would do — what it has to be is somewhere a book
 * never opens on its own, so that arriving there can only mean the passage was carried through.
 */
const IN_CHAPTER_THREE = "epubcfi(/6/16!/4,/2/1:0,/2/1:8)";

/** A passage in chapter one, for the test that needs one *behind* where the reader had read. */
const IN_CHAPTER_ONE = "epubcfi(/6/12!/4/2,/2/2/1:0,/2/2/1:8)";

/**
 * A reading position in chapter three, with the page it was on.
 *
 * The page is what makes it a position rather than a point: a passage is a visit only when it is
 * somewhere other than the page the reader had reached, and this one covers chapter three's
 * opening and nothing in chapter one.
 *
 * ⚠️ Read off the book rather than composed — `/4/2/2/2/1` is where Alice's prose begins inside
 * a chapter, and a path one step short of it sorts before the page it is printed on while
 * parsing perfectly well. `reader/visit.spec.ts` has how to re-derive these.
 */
const READ_TO_CHAPTER_THREE = {
  cfi: "epubcfi(/6/16!/4/2/2/2/1:0)",
  pageRange: "epubcfi(/6/16!/4/2,/2/2/1:0,/12/1:0)",
  percentage: 0.3,
};

/**
 * That the reader is looking at chapter three rather than at the cover.
 *
 * The section is the assertion, not the exact sentence: walking a CFI down to a node inside a
 * section is frond's own business and proven there. What is being asked here is whether the
 * passage reached the renderer at all — and a book left to itself opens at the title page.
 */
async function landedInChapterThree(page: Page): Promise<void> {
  const frame = page.frameLocator(PAGE_FRAME);
  await expect(frame.locator("body")).toContainText(/Caucus-Race/, { timeout: 30_000 });
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
    ([rows, zero]) =>
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
              cfiRange: row.cfiRange ?? zero,
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
    [seeds, IN_SECTION_ZERO] as const,
  );
}

/**
 * Give a book a name as long as a real one gets.
 *
 * The fixtures are all called things like "Alice", and what the head row has to survive is a
 * published title — a subtitle after a colon, fifteen characters of it. Nothing else can put one
 * in front of the layout: a title comes out of the epub, so the only way to test a long one is to
 * write it in.
 */
async function rename(page: Page, bookId: string, title: string): Promise<void> {
  await page.evaluate(
    ([id, name]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("books", "readwrite");
          const store = tx.objectStore("books");
          const read = store.get(id);
          read.onsuccess = () => store.put({ ...read.result, title: name });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [bookId, title] as const,
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
 * The draw is then found by the name it carries rather than by a testid of its own: the testid
 * says which block, the role and name say which control, and a name that goes missing is the kind
 * of break nobody reports (ADR-0021).
 */
function card(page: Page) {
  return page.getByTestId("mark-card");
}

// ⚠️ `exact`, because Playwright matches an accessible name by substring by default — and the
// other button on this card carries the whole passage as its name.
const another = (page: Page) =>
  card(page).getByRole("button", { name: "Another passage", exact: true });

/** What the card is showing right now. */
const passage = (page: Page) => page.getByTestId("mark-quote");

/**
 * Press 〈another〉 and wait for the card to have actually turned over.
 *
 * The press is dispatched synchronously and the draw behind it is a read of Dexie away, so a test
 * that read the card straight afterwards would sometimes read the passage still on screen. With
 * two marks seeded the draw is deterministic — the other one is the only one it may hand back.
 */
async function drawOther(page: Page): Promise<void> {
  const before = await passage(page).textContent();
  await another(page).click();
  await expect(passage(page)).not.toHaveText(before!);
}

/** How wide the quote is allowed to run, in ems of its own type size. */
async function quoteEms(page: Page): Promise<number> {
  return await passage(page).evaluate((quote) => {
    const style = getComputedStyle(quote);
    return parseFloat(style.maxWidth) / parseFloat(style.fontSize);
  });
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
  await expect(card(page)).toHaveCount(0);
});

test("one passage, with the reader's note, the same one after a reload", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "Worth coming back to.", createdAt: 1 },
  ]);
  await page.reload();

  await expect(passage(page)).toHaveText(LATIN);
  // The reader's own words travel with the passage, read-only. Writing them is the book's job now
  // — there is nothing on this card to type into.
  await expect(page.getByTestId("mark-note")).toHaveText("Worth coming back to.");

  // **Held for the day.** The reader may not be able to say yet why a passage stayed with them,
  // and a card that redrew every time they came back to the shelf would never give them the
  // chance to find out (ADR-0038).
  await page.reload();
  await expect(passage(page)).toHaveText(LATIN);
});

test("asking for another draws a different passage, and that one is today's now", async ({
  page,
}) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, manyMarks(alice, 12));
  await page.reload();
  const first = await passage(page).textContent();

  // Different, and still on the shelf: the draw is the reader asking for another passage, not a
  // way out of the screen. Which passage arrives is chance — `revisit.test.ts` holds the one
  // promise, that it is not the one being left.
  await another(page).click();
  await expect(passage(page)).not.toHaveText(first!);
  await expect(page.locator(".reader")).toHaveCount(0);
  const drawn = await passage(page).textContent();

  // **What was drawn is today's passage now** — the press is the reader asking, not a peek that a
  // reload undoes. A press whose effect a refresh takes back reads as a press that never landed.
  await page.reload();
  await expect(passage(page)).toHaveText(drawn!);
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
  //
  // Two marks, so one press reaches the other: the draw promises only that it will not hand back
  // the passage being left, and with two there is one other.
  const seen = new Map<string, number>();
  for (let i = 0; i < 2; i++) {
    seen.set((await passage(page).textContent())!, await quoteEms(page));
    // ⚠️ Waited for, not merely pressed: `click()` returns when the press is dispatched, and the
    // draw behind it is a read of Dexie away. Reading straight after would sometimes record the
    // passage that is still on screen, and the map would come back with one key.
    if (i === 0) await drawOther(page);
  }
  expect(seen.get(LATIN)).toBeCloseTo(30, 1);
  expect(seen.get(HAN)).toBeCloseTo(40, 1);
});

test("the head row sheds its label for a long title and keeps it for a short one", async ({
  page,
}) => {
  await page.goto("/");
  const { alice, chinese } = await twoBooks(page);

  // **Two titles at one width, which is the whole of the proposition.** The row drops its parts by
  // measuring — the label goes when the book's name has run out of room — and the way that rule
  // fails is by being written as a breakpoint instead, which passes every test that only ever
  // looks at one title. These two are seeded together so that the width is held constant and the
  // title is the only thing that differs.
  await rename(page, chinese, "原子習慣：細微改變帶來巨大成就的實證法則");
  await rename(page, alice, "短");
  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "", createdAt: 1_000 },
    { bookId: chinese, text: HAN, note: "", createdAt: 2_000 },
  ]);
  // 480 is measured rather than picked: the long title's label goes somewhere between 700 and
  // 620, and the short title still has room for its own at 480. Anywhere in that gap makes the
  // point; here is comfortably inside it at both ends.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.reload();

  const label = card(page).getByText("From your marks");
  const seen = new Map<string, boolean>();
  for (let i = 0; i < 2; i++) {
    seen.set(
      (await page.getByTestId("mark-book").textContent())!,
      await label.evaluate((node) => !(node as HTMLElement).hidden),
    );
    if (i === 0) await drawOther(page);
  }
  expect(seen.get("短")).toBe(true);
  expect(seen.get("原子習慣：細微改變帶來巨大成就的實證法則")).toBe(false);

  // ⚠️ **The hairline goes with the word it separates.** The label is two elements, and dropping
  // them one at a time left the rule standing against the edge of the card with nothing to its
  // left, which reads as a mistake rather than as an arrangement.
  //
  // Drawn to rather than asserted where the loop happened to stop: which of the two the card
  // opens on is chance, and an assertion about the long title has to be made while the long
  // title is the one showing.
  await expect(async () => {
    if ((await page.getByTestId("mark-book").textContent()) === "短") await another(page).click();
    await expect(page.getByTestId("mark-book")).toHaveText(
      "原子習慣：細微改變帶來巨大成就的實證法則",
    );
  }).toPass();
  await expect(card(page).locator(".mark-label-rule")).toBeHidden();

  // ⚠️ **And the row is still a row.** Dropping is only worth doing if the alternative was worse:
  // a row that wrapped would keep every part and cost the card a line of height instead.
  const lines = await card(page)
    .locator(".mark-head")
    .evaluate(
      (node) => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).fontSize),
    );
  expect(lines).toBeLessThan(3);
});

test("the words on the card go back to the passage", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "", createdAt: 1_000, cfiRange: IN_CHAPTER_THREE },
  ]);
  await page.reload();

  // The card's one press out. It goes to where the passage is, which the saved position cannot
  // do: that is where the reader stopped reading, not where this sentence is.
  await passage(page).click();
  await expect(page.locator(".reader")).toBeVisible();
  expect(page.url()).toContain(`#/book/${alice}`);
  await landedInChapterThree(page);
});

test("opening a passage from the shelf leaves the reader's place in that book alone", async ({
  page,
}) => {
  // **The bug this card shipped with.** The passage is handed to frond as where to lay out, and
  // that layout emits the `relocate` every page turn emits — so the passage was written over the
  // reader's progress before they had touched anything. Whether a jump counts as a visit is
  // settled in `src/lib/visit.test.ts`; what only a browser can say is that the position written
  // on the way in is held back at all.
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [
    { bookId: alice, text: LATIN, note: "", createdAt: 1_000, cfiRange: IN_CHAPTER_ONE },
  ]);
  await seedProgress(page, alice, READ_TO_CHAPTER_THREE);
  await page.reload();

  await passage(page).click();
  await expect(page.locator(".reader")).toBeVisible();
  await expect(page.frameLocator(PAGE_FRAME).locator("body")).toContainText(/Rabbit-Hole/, {
    timeout: 30_000,
  });

  // Back to the shelf and in again the ordinary way. The book has to open where they had read,
  // not where they looked — and reading it back through the app's own front door is the
  // assertion, because that is what the reader would do next.
  await page.goBack();
  await page.getByTestId("continue-reading").click();
  await expect(page.frameLocator(PAGE_FRAME).locator("body")).toContainText(/Caucus-Race/, {
    timeout: 30_000,
  });
});

test("the draw button stays put between draws, and the card still fits a phone", async ({
  page,
}) => {
  await page.goto("/");
  const { alice, chinese } = await twoBooks(page);
  await rename(page, alice, "Alice's Adventures in Wonderland: and Through the Looking-Glass");

  // **The two draws are as far apart as the card will ever see them**, and in both of the ways a
  // card used to be sized by: three words against a passage that runs the whole measure, under a
  // published title against a two-word one. Either difference on its own moved the frame's right
  // edge, and the button rides that edge — so the second of two presses landed beside it.
  await seedMarks(page, [
    { bookId: alice, text: `${LATIN} ${LATIN} ${LATIN}`, note: "", createdAt: 1 },
    { bookId: chinese, text: "短。", note: "", createdAt: 2 },
  ]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();

  const buttonLeft = async () => (await another(page).boundingBox())!.x;
  const before = await buttonLeft();
  await drawOther(page);
  expect(await buttonLeft()).toBeCloseTo(before, 0);

  // And the width is a ceiling rather than a size: on a phone the card is as wide as the shelf and
  // no wider, which is what it already was for a long passage.
  await page.setViewportSize({ width: 390, height: 844 });
  const box = (await card(page).boundingBox())!;
  const shelf = (await page.locator(".library").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(shelf.width);
});

test("the cover on the card is the shelf's rectangle rather than the publisher's", async ({
  page,
}) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);
  const alice = await bookIdOf(page, /Alice/);

  await seedMarks(page, [{ bookId: alice, text: LATIN, note: "", createdAt: 1 }]);
  await page.reload();

  // Every book's cover comes out the same size, so a draw that turns over to a squarer book does
  // not resize the one thing on the card that is not words. Alice's own cover is 1:1.5, which is
  // what makes this an assertion rather than a restatement of the stylesheet.
  const cover = (await card(page).locator(".mark-cover img").boundingBox())!;
  expect(cover.height / cover.width).toBeCloseTo(1.42, 2);
});

test("the shelf stops widening, and centres in what is left", async ({ page }) => {
  await page.goto("/");
  await importBook(page, BOOKS.horizontal, /Alice/);

  const shelfBox = async () => (await page.locator(".library").boundingBox())!;

  // Both above the shelf's own cap, so what is being asked is whether it stopped — 1280 is under
  // it now that the wall of covers gets to spend the width the passage used to hold back.
  await page.setViewportSize({ width: 1600, height: 900 });
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
