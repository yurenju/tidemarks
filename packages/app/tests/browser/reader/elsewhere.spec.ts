// What arrives from another device while the reader has the book open: where they were, and what
// they marked.
//
// **Wiring tests, and these are wires no other test covers.** Whether a given position is worth
// offering is exhausted in src/lib/elsewhere.test.ts, where it costs nothing; what only a browser
// can say is that a pull reaches the open reader at all, that the banner is on screen without the
// reader having asked for the chrome, that taking the offer moves the book — and that a mark the
// pull wrote into Dexie is one the panel is holding, which is a second wire and a separate break.
//
// The position it offers is a real one, read back out of the reader after turning some pages — a
// hand-written CFI would prove the banner appears and prove nothing about the jump.
//
// **Where the reader is, is read from the position note rather than from the text on the page.**
// `visibleText()` reading an empty string after a turn is a known flake on two of the three
// engines (#15, #46), and this spec is not about the text: the note is written by the same
// `relocate` the reader's own position comes from, and it is a string this file can compare.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openChrome, waitForIndex } from "../support/library.js";

/** One book's position, as `lib/position-store.ts` leaves it and the Worker would return it. */
interface StoredPosition {
  bookId: string;
  cfi: string;
  pageRange: string | null;
  percentage: number;
  chapterLabel: string | null;
  lastReadAt: number;
}

async function storedPosition(page: Page): Promise<StoredPosition | null> {
  const raw = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("tidemarks.position."));
    return key === undefined ? null : localStorage.getItem(key);
  });
  return raw === null ? null : (JSON.parse(raw) as StoredPosition);
}

function storedCfi(page: Page): Promise<string | null> {
  return storedPosition(page).then((position) => position?.cfi ?? null);
}

/** One marked passage, as the Worker would hand it back. */
interface StoredAnnotation {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** What the other device has, as a pull would report it. */
interface Elsewhere {
  position?: StoredPosition | null;
  annotations?: StoredAnnotation[];
}

/**
 * Stands in for the server, holding whatever the test puts in `read`.
 *
 * It starts empty on purpose: the app syncs on its own — once on open, and a few seconds after
 * each page turn — and a server with something to say from the start would speak before the test
 * had arranged the case it is about.
 */
async function fakeSync(page: Page, read: () => Elsewhere): Promise<void> {
  // The device believes it is signed in, so `syncNow` opens the door at all (`lib/session.ts`).
  // Nothing real is behind it: every call to `/api/sync` is answered here.
  await page.addInitScript(() => localStorage.setItem("tidemarks-signed-in", "1"));
  await page.route("**/api/sync*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { conflicts: { books: [], progress: [], annotations: [] } } });
      return;
    }
    const { position = null, annotations = [] } = read();
    await route.fulfill({
      json: {
        books: [],
        progress: position === null ? [] : [position],
        annotations,
        readingSessions: [],
        // Ahead of the cursor the app stores, so the row is never filtered out as already seen.
        cursor: Date.now(),
      },
    });
  });
}

/** What tells the app to ask the server — the return to the foreground (`App.tsx`). */
function returnToForeground(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("offers a position read elsewhere, and moves the book when it is taken", async ({ page }) => {
  let offered: StoredPosition | null = null;
  await fakeSync(page, () => ({ position: offered }));

  await openBook(page, BOOKS.vertical);
  await waitForIndex(page);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const opening = await storedCfi(page);

  // Read on a way into the book, and keep where that was. The buttons rather than the arrow
  // keys: they are labelled by what they do, so this does not have to know which way this book
  // opens (it is right-to-left).
  for (let turn = 0; turn < 4; turn += 1) {
    const before = await storedCfi(page);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(() => storedCfi(page), { message: `turn ${turn}` }).not.toBe(before);
  }
  const away = await storedPosition(page);
  expect(away?.cfi).not.toBe(opening);

  // Now back to where the book opened. This is the device with the stale tab.
  for (let turn = 0; turn < 4; turn += 1) {
    await page.getByRole("button", { name: "Previous page" }).click();
  }
  await expect.poll(() => storedCfi(page)).toBe(opening);

  // The other device wrote that position, later than anything this one has.
  offered = { ...(away as StoredPosition), lastReadAt: Date.now() + 60_000 };

  // This is the case the whole thing is about: a tab left open while the reading happened
  // elsewhere.
  await returnToForeground(page);

  // On screen without the reader touching anything — the chrome is still down.
  const banner = page.getByTestId("elsewhere");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("chrome-top")).toBeHidden();

  await banner.getByRole("button", { name: "Go there" }).click();

  await expect(banner).toBeHidden();
  await expect.poll(() => storedCfi(page)).toBe(away?.cfi);
});

// **The half that is easy to ship broken.** Turning the offer down has to be a *write*, not a
// dismissal: the pull put the other device's position into Dexie before the banner ever
// appeared, so a banner that only hides itself leaves the reader who pressed "Stay here" being
// taken there the next time they open the book (ADR-0037).
//
// Nothing here needs a real position on the far side, because nothing navigates: the offer is
// hand-written, far enough off the page for the banner to appear, and what is asserted is what
// this device wrote about itself.
test("turning the offer down writes where the reader is, rather than just hiding", async ({
  page,
}) => {
  let offered: StoredPosition | null = null;
  await fakeSync(page, () => ({ position: offered }));

  await openBook(page, BOOKS.vertical);
  await waitForIndex(page);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const here = (await storedPosition(page)) as StoredPosition;

  offered = {
    ...here,
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

  // Same page, later timestamp: that pair is the whole of what "stay here" means, and it is
  // what makes this device's position the one that wins the next merge.
  await expect.poll(async () => (await storedPosition(page))?.cfi).toBe(here.cfi);
  await expect
    .poll(async () => ((await storedPosition(page))?.lastReadAt ?? 0) > here.lastReadAt)
    .toBe(true);
});

// A mark made on the other device, landing while this one has the book open.
//
// **The pull was never the broken half.** It wrote the row into Dexie all along, and a reload
// showed it — so the reader saw the position banner appear and their notes stay missing, which
// reads as "sync is half working" rather than as anything a reader can act on. What the reader's
// copy of the marks had was one read, at the moment the book opened.
//
// The count on the notes button rather than the panel's contents: it is the same state, and it is
// on screen without a panel having to be opened first.
test("a mark made elsewhere reaches the open book without a reload", async ({ page }) => {
  let marks: StoredAnnotation[] = [];
  await fakeSync(page, () => ({ annotations: marks }));

  await openBook(page, BOOKS.vertical);
  await waitForIndex(page);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const here = (await storedPosition(page)) as StoredPosition;

  // Filed against this book, because a mark under another book's id is filtered out before the
  // wire under test is reached. The CFI is this device's position rather than a range, so nothing
  // is painted from it — what is asserted below is the state the pull reached, and drawing the
  // boxes is `highlights.spec.ts`'s half.
  const now = Date.now();
  marks = [
    {
      id: "mark-from-the-other-device",
      bookId: here.bookId,
      cfiRange: here.cfi,
      text: "a passage marked on the other device",
      note: "",
      color: "yellow",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];

  await returnToForeground(page);

  await openChrome(page);
  await expect(page.getByRole("button", { name: /Notes \(1\)/ })).toBeVisible({ timeout: 15_000 });
});
