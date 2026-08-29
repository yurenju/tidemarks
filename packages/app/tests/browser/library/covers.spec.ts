// A cover that failed to download is fetched again on a later round, when the book's row is not
// in that round's pull.
//
// **Here rather than a layer down, for `reader/elsewhere.spec.ts`'s reason**: `lib/sync.ts`
// reaches Dexie, `fetch` and a Lingui macro, so it has no unit harness at all. And the case is
// two sync rounds with a device's own storage carrying what it learned between them, which is a
// shape no pure function holds: what makes the second round ask again is a field written to
// IndexedDB by the first.
//
// The failure it pins is #120, whose account is in `lib/sync.ts` beside the queue this is about.
import { expect, test } from "../support/fixtures.js";
import { fakeSync, returnToForeground } from "../support/library.js";
import type { SyncBook } from "../../../src/lib/types.js";

const TITLE = "A Book Whose Cover Was Late";

// One opaque pixel. The assertion is that the shelf swapped a title for a picture, and any
// picture the browser will decode answers that.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("fetches a cover that failed on a round whose pull no longer carries the book", async ({
  page,
}) => {
  const now = Date.now();
  const book: SyncBook = {
    id: "late-cover",
    title: TITLE,
    author: "Nobody",
    addedAt: now,
    updatedAt: now,
    deletedAt: null,
    hasCover: true,
  };

  // What the server has to say, which changes twice below.
  let books: SyncBook[] = [book];
  let coverIsServable = false;
  let coverRequests = 0;

  await fakeSync(page, () => ({ books }));

  // After `fakeSync`, so this wins the cover over its blanket 404 — Playwright asks the
  // last-registered handler first.
  await page.route("**/api/books/*/cover", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    coverRequests += 1;
    await (coverIsServable
      ? route.fulfill({ contentType: "image/png", body: PIXEL })
      : // Not a thrown request but a bad answer, which is the half that never even reached the
        // `catch` this used to rely on.
        route.fulfill({ status: 503, body: "" }));
  });

  await page.goto("/");

  // The row arrived and the card is on the shelf, standing in with its title because the picture
  // it should be holding did not come.
  const card = page.getByTestId("book-card").filter({ hasText: TITLE });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => coverRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(card.getByRole("img", { name: TITLE })).toBeHidden();

  // The cursor has moved past that row, so the server has nothing left to send about this book —
  // this is the state in which the old code forgot the cover for good.
  books = [];
  coverIsServable = true;

  await returnToForeground(page);

  // A picture where the title was standing in, which nothing but a second request could have put
  // there.
  await expect(card.getByRole("img", { name: TITLE })).toBeVisible({ timeout: 15_000 });
});
