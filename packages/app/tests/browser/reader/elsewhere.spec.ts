// A position that arrived from another device, offered to a reader who has the book open.
//
// **One wiring test, and it is the wire that has no other test.** Whether a given position is
// worth offering is exhausted in src/lib/elsewhere.test.ts, where it costs nothing; what only a
// browser can say is that a pull reaches the open reader at all, that the banner is on screen
// without the reader having asked for the chrome, and that taking the offer moves the book.
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
import { BOOKS, openBook, waitForIndex } from "../support/library.js";

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

/**
 * Stands in for the server, holding whatever the test puts in `offered`.
 *
 * It starts empty on purpose: the app syncs on its own — once on open, and a few seconds after
 * each page turn — and a server with something to say from the start would raise the banner
 * before the test had arranged the case it is about.
 */
async function fakeSync(page: Page, read: () => StoredPosition | null): Promise<void> {
  // The device believes it is signed in, so `syncNow` opens the door at all (`lib/session.ts`).
  // Nothing real is behind it: every call to `/api/sync` is answered here.
  await page.addInitScript(() => localStorage.setItem("tidemarks-signed-in", "1"));
  await page.route("**/api/sync*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { conflicts: { books: [], progress: [], annotations: [] } } });
      return;
    }
    const offered = read();
    await route.fulfill({
      json: {
        books: [],
        progress: offered === null ? [] : [offered],
        annotations: [],
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
  await fakeSync(page, () => offered);

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
  await fakeSync(page, () => offered);

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
