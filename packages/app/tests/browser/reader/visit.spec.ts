// Going back to a marked passage from inside the book, and what that does to the reader's place
// in it.
//
// **Wiring tests.** Whether a jump begins a visit, and when one ends, is exhausted in
// `src/lib/visit.test.ts` where it costs nothing. What only a browser can answer is the pair of
// wires that file cannot reach: that the position written on every `relocate` is really held
// back while a visit is on, and that the page the decision is taken against is the one on screen
// — read from `renderer.location`, because the stored `pageRange` goes stale exactly here. The
// notes panel takes a column from the book on a wide desk (above 820px), and that reflow keeps
// the reader on the same page of the same CFI, which is the shape `relocate` de-duplicates away.
//
// **The reader arrives already placed**, by seeding the position and the mark rather than by
// reading four pages into the book to produce them. The path that writes those rows for real is
// `highlights.spec.ts`'s and `elsewhere.spec.ts`'s; reading them here would cost a whole-book
// index and a handful of turns per engine to reach a state two `put`s describe exactly.
//
// **Where the reader is, is read from the position note** rather than from the text on the page,
// for the reason `elsewhere.spec.ts` gives: an empty `visibleText()` after a turn is a known
// flake on two engines (#15, #46), and the note is written by the same `relocate` this is about.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  bookCards,
  fakeSync,
  openChrome,
  openPanel,
  returnToForeground,
  seedProgress,
  settled,
  type StoredPosition,
} from "../support/library.js";

/** The quote as it reads in the panel, and as the button carrying it is named. */
const PASSAGE = "A passage marked earlier";

// Alice's sixth spine item is chapter one and her eighth is chapter three, and inside one of
// them her prose begins at `/4/2/2/2/1` — body, the chapter's own `<section>`, then its first
// block.
//
// ⚠️ **These were read off the book, not composed by hand.** An invented path parses and
// compares like any other, so a mark written at `/4/2/1:0` — one step short of where the text
// actually begins — sorts *before* the page it is printed on, and the reader gets told they are
// somewhere else while looking straight at it. Not hypothetical: it is what the first version of
// this file did, and all three engines caught it. To re-derive them, open the book and read
// `pageRange` out of the position note in `localStorage`.
const IN_CHAPTER_ONE = "epubcfi(/6/12!/4/2,/2/2/1:0,/2/2/1:8)";
const CHAPTER_THREE = {
  cfi: "epubcfi(/6/16!/4/2/2/2/1:0)",
  // The page the reader had reached, which is what makes chapter one somewhere else.
  pageRange: "epubcfi(/6/16!/4/2,/2/2/1:0,/12/1:0)",
};

/**
 * The reader stopped at the top of chapter one — where `IN_CHAPTER_ONE` is the first line they
 * are looking at, rather than something a hundred pages behind them.
 */
const CHAPTER_ONE = {
  cfi: "epubcfi(/6/12!/4/2/2/2/1:0)",
  pageRange: "epubcfi(/6/12!/4/2,/2/2/1:0,/12/1:0)",
};

function storedPosition(page: Page): Promise<StoredPosition | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("tidemarks.position."));
    if (key === undefined) return null;
    return JSON.parse(localStorage.getItem(key)!) as StoredPosition;
  });
}

function storedCfi(page: Page): Promise<string | null> {
  return storedPosition(page).then((position) => position?.cfi ?? null);
}

/** Writes one marked passage straight into IndexedDB — the row a highlight leaves behind. */
async function seedMark(page: Page, bookId: string, cfiRange: string): Promise<void> {
  await page.evaluate(
    ([id, range, text]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("annotations", "readwrite");
          tx.objectStore("annotations").put({
            id: "visit-seed",
            bookId: id,
            cfiRange: range,
            text,
            note: "",
            color: "indigo",
            createdAt: 1_000,
            updatedAt: 1_000,
            deletedAt: null,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [bookId, cfiRange, PASSAGE] as const,
  );
}

/**
 * Imports Alice, seeds the reader's history into her, and opens her.
 *
 * The import is the app's own, so what is seeded is only what a reader would have done inside
 * the book — the book itself is real.
 */
async function arrive(
  page: Page,
  position: { cfi: string; pageRange: string } | null,
  mark: string,
): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(BOOKS.horizontal);
  const card = bookCards(page).filter({ hasText: /Alice/ });
  await expect(card).toBeVisible({ timeout: 30_000 });

  const bookId = (await card.getAttribute("data-book-id"))!;
  await seedMark(page, bookId, mark);
  if (position !== null) await seedProgress(page, bookId, position);
  await card.getByTestId("book-open").click();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
}

/**
 * The mark the Scrubber wears while a visit is on, found by the name it answers to.
 *
 * By role rather than by a testid, and the percentage left open: the name is the whole point of
 * the control — a mark nobody can name is a mark a screen reader cannot offer — while which
 * percentage it names is Alice's business, not this file's.
 */
const visitMark = (page: Page) => page.getByRole("button", { name: /Back to \d+%/ });

/** Opens the notes panel and presses the passage in it. */
async function jumpToPassage(page: Page): Promise<void> {
  await openPanel(page, /Notes/);
  await page.getByTestId("panel-notes").getByRole("button", { name: PASSAGE }).click();
}

test("a visit holds the reader's place, and says nothing over the book", async ({ page }) => {
  await arrive(page, CHAPTER_THREE, IN_CHAPTER_ONE);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const away = (await storedCfi(page))!;

  await jumpToPassage(page);

  // The jump lands in chapter one and the panel stays standing beside it, and the reflow that
  // gave it its column emits a `relocate` too;
  // `settled` waits them out, so a position that got through would be written by now. **Asked
  // after that wait rather than before it** — `toBeHidden` passes on an element that does not
  // exist yet, so a card arriving one render later would sail past an earlier question.
  await settled(page);

  // No banner (ADR-0040): the reader tapped the passage a moment ago, and nothing is at stake in
  // the way it is for a position that arrived from another device. What a visit does raise is the
  // Scrubber's mark, which the test below is about.
  await expect(page.getByTestId("elsewhere")).toBeHidden();
  expect(await storedCfi(page)).toBe(away);
});

// **〈Stay here〉 during a visit**, which is the one move in the app that carries progress
// backwards — and the only way to reach it is for a position from another device to arrive while
// the visit is on. The mark a visit does raise (ADR-0040) is not another way in: it carries the
// reader forward to the progress being kept, never the progress back to the reader.
//
// **What is under test is which of the two rows the button reads.** During a visit they come
// apart: `positionRef` is what this device claims about the book (chapter three, a hundred pages
// on) and `screenRef` is where the reader is looking (chapter one). A button reaching for the
// first would write the reader's place back over itself and look like it did nothing at all,
// which no other layer can see — `visit.test.ts` is pure functions and cannot hold a ref, and
// `elsewhere.spec.ts` presses this button with no visit on, where the two rows are the same row.
test("during a visit, staying here writes the page the reader is looking at", async ({ page }) => {
  let offered: StoredPosition | null = null;
  await fakeSync(page, () => ({ position: offered }));

  await arrive(page, CHAPTER_THREE, IN_CHAPTER_ONE);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const away = (await storedPosition(page))!;

  await jumpToPassage(page);
  await settled(page);
  expect(await storedCfi(page)).toBe(away.cfi);

  // A position from the other device, far enough off this page to be worth offering. Hand-written
  // because nothing navigates to it: the reader turns the offer down.
  offered = {
    ...away,
    cfi: "epubcfi(/6/40!/4/2/1:0)",
    pageRange: null,
    chapterLabel: null,
    percentage: 0.9,
    lastReadAt: Date.now() + 60_000,
  };
  await returnToForeground(page);

  const banner = page.getByTestId("elsewhere");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await banner.getByRole("button", { name: "Stay here" }).click();
  await expect(banner).toBeHidden();

  // Chapter one: not what this device claimed (chapter three), and not what was offered.
  await expect.poll(() => storedCfi(page)).not.toBe(away.cfi);
  expect(await storedCfi(page)).not.toBe(offered.cfi);
});

// Narrow enough that the panel covers the book, so pressing a passage takes the whole chrome
// away with it. That is what this test needs: the bars have to leave before it can ask for them
// back. The suite's 1000px is over 820 now, where the panel stands beside the book and the bars
// stay standing with it.
test.describe("in a window where the panel covers the book", () => {
  test.use({ viewport: { width: 700, height: 900 } });

  test("the scrubber marks the progress a visit is holding, and the mark is the way back", async ({
    page,
  }) => {
    await arrive(page, CHAPTER_THREE, IN_CHAPTER_ONE);
    await expect.poll(() => storedCfi(page)).not.toBeNull();

    await jumpToPassage(page);

    // ⚠️ **Wait for the chrome to finish leaving before asking for it back.** Pressing a passage
    // puts the bars away at this viewport — `notePressed` with `keepPanel: false`, because 700px
    // is under the 820 where the panel would stand beside the book instead of over it
    // (`lib/media.ts`) — and a bar on its way out is still
    // `visible` — `visibility` only flips at the end of the slide, on purpose. `openChrome` called
    // into that window sees a visible bar, clicks nothing, and then waits for a transform that is
    // travelling the other way.
    await expect(page.getByTestId("chrome-bottom")).toBeHidden();
    await openChrome(page);

    // Visible, and named after the place it leads to — the whole of what #110 asked for.
    await expect(visitMark(page)).toBeVisible();

    // **Pressing it is reading again**, so the visit it belonged to ends and it goes with it.
    // That is the assertion rather than the CFI it landed on: the mark going away is what tells
    // the reader their progress is theirs again, and it is only true if the jump really arrived
    // at the page being defended.
    await visitMark(page).click();
    await expect(visitMark(page)).toHaveCount(0);
  });
});

test("a marked passage on the page in front of the reader is not a visit", async ({ page }) => {
  // **Opened in the middle of a chapter, on the page the mark is on.** The reader has left
  // nothing behind, so pressing it should pass without a word.
  //
  // Chapter one rather than the title page, and that is not decoration: the title page is a
  // section one page long, so "next page" there means mounting the next document — which on a
  // loaded CI runner took longer than this waited for, and read as a turn that never happened.
  // Inside a chapter the turn is a turn.
  await arrive(page, CHAPTER_ONE, IN_CHAPTER_ONE);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const here = (await storedCfi(page))!;

  // ⚠️ **The panel takes a column from the book, and then the book reflows under it.** That is
  // the arrangement at this viewport now: 1000px is over the 820 where the column is handed
  // across (`styles/device.css`), so the reflow this guards against is one the test really
  // provokes rather than one it describes from a width that never sees it. That reflow is why the decision reads `renderer.location` rather than the stored
  // `pageRange`: `relocate` de-duplicates on section, page, fraction and CFI, none of which the
  // reflow need change, so the stored range can still describe the wider layout — and a passage
  // measured against it lands outside a page the reader is looking straight at.
  await jumpToPassage(page);

  await expect(page.getByTestId("elsewhere")).toBeHidden();
  // Nor is there anything to hold, so the Scrubber wears no mark. Counted rather than checked
  // for visibility, because the chrome is down here and everything in it is hidden anyway.
  await expect(visitMark(page)).toHaveCount(0);

  // Not merely quiet: still reading. A visit entered silently would show up here, as a page
  // turn that never reached the position.
  //
  // Clicked until it lands, the way `openChrome` is: the panel is on its way out as this
  // begins, and the book widening behind it is a reflow — a click sent into that is spent on
  // nothing, and this would then be waiting for a turn nobody asked for. A visit entered by
  // mistake is not rescued by clicking again, so the retry cannot hide the thing under test.
  await expect(async () => {
    await page.getByRole("button", { name: "Next page" }).click();
    expect(await storedCfi(page)).not.toBe(here);
  }).toPass({ timeout: 15_000 });
});
