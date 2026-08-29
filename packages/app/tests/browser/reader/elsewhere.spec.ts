// What arrives from another device while the reader has the book open: where they were, and what
// they marked.
//
// **Wiring tests, and these are wires no other test covers.** Whether a given position is worth
// offering is exhausted in src/lib/elsewhere.test.ts, where it costs nothing; what only a browser
// can say is that a pull reaches the open reader at all, that the banner is on screen without the
// reader having asked for the chrome, that taking the offer moves the book — and that a mark the
// pull wrote into Dexie is one the panel is holding, which is a second wire and a separate break.
//
// **A fourth angle, and the odd one out: that a failed push does not eat the pull behind it.**
// That is control flow in `lib/sync.ts` with no layout in it, so it would belong a layer down —
// except there is no layer down. `sync.ts` reaches Dexie, `fetch` and a Lingui macro, none of
// which survive the node runner's transform, so it has no unit harness at all, and a browser is
// the only place the two halves of a sync run in order.
//
// The position it offers is a real one, read back out of the reader after turning some pages — a
// hand-written CFI would prove the banner appears and prove nothing about the jump.
//
// **Where the reader is, is read from the position note rather than from the text on the page.**
// `visibleText()` reading an empty string after a turn is a known flake on two of the three
// engines (#15, #46), and this spec is not about the text: the note is written by the same
// `relocate` the reader's own position comes from, and it is a string this file can compare.
import type { Page } from "@playwright/test";
import type { SyncBook } from "../../../src/lib/types.js";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  fakeSync,
  openBook,
  openChrome,
  returnToForeground,
  waitForIndex,
  type StoredAnnotation,
  type StoredPosition,
} from "../support/library.js";

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

// **A sync pushes before it pulls, and one book's epub failing to go up used to end the whole
// round** — `lib/sync.ts` has what that cost the reader. What this adds is the ordering itself:
// that the pull still happens, which no other case here would notice, because in all of them the
// push succeeds.
//
// **And that the book is tried again**, which is the half that is easy to ship broken: the push
// keeps `dirtyAt` on a book whose body did not go up, and the pull that follows writes that same
// book back a moment later. A pull that cleared the flag there — it used to — left the epub on
// this device for good, and the other device holding a shelf card whose file is not there.
//
// So the upload is refused for good, and the book is asked for on both sides of a pull. Refused
// rather than left to chance: intermittent is how #122 found this, and intermittent is no way to
// keep it.
test("a book body that will not upload does not stop a position arriving", async ({ page }) => {
  let offered: StoredPosition | null = null;
  let onServer: SyncBook[] = [];
  await fakeSync(page, () => ({ position: offered, books: onServer }));

  let uploads = 0;
  await page.route("**/api/books/*/file", (route) => {
    uploads += 1;
    return route.abort();
  });

  await openBook(page, BOOKS.vertical);
  await waitForIndex(page);
  await expect.poll(() => storedCfi(page)).not.toBeNull();
  const here = (await storedPosition(page)) as StoredPosition;

  // The book coming back down, which is what the pull writes over the local row — and what used
  // to take the "still owed" flag with it. Later than the local row so it plainly wins the merge;
  // a real server's echo ties, and a tie goes to the remote side too (`merge.ts`).
  //
  // The title says what it is rather than naming the fixture: the pull really does write it onto
  // the shelf's row, and a second book's name sitting there would read as a bug to whoever comes
  // next. Nothing below looks at it.
  onServer = [
    {
      id: here.bookId,
      title: "the row the server sends back",
      author: "",
      addedAt: 0,
      updatedAt: Date.now() + 60_000,
      deletedAt: null,
    },
  ];
  offered = {
    ...here,
    cfi: "epubcfi(/6/40!/4/2/1:0)",
    pageRange: null,
    chapterLabel: null,
    percentage: 0.9,
    lastReadAt: Date.now() + 60_000,
  };
  await returnToForeground(page);

  await expect(page.getByTestId("elsewhere")).toBeVisible({ timeout: 15_000 });
  const afterThePull = uploads;

  // One more round, now that the book has been through a pull. `RESUME_COALESCE_MS` folds two
  // returns landing within a second of each other into one sync, and this has to be its own.
  await page.waitForTimeout(1_500);
  await returnToForeground(page);

  // Still owed, so still asked for: the pull wrote the book back without writing off what this
  // device has yet to hand over.
  await expect.poll(() => uploads, { timeout: 15_000 }).toBeGreaterThan(afterThePull);
});
