// The free account's three books, from the device's side (#186, #191). The server names the books
// it holds (`/auth/me`), and the device sends only those: a fourth book stays home, its epub body
// never goes up, and the shelf and [[Account]] both say so.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, fakeSync, openBook, settled } from "../support/library.js";

/**
 * Here rather than in Vitest for `signed-out.spec.ts`'s reason: the proposition is about the
 * requests a running app makes, and only the real app has the triggers that make them.
 *
 * The fake server is a full account — three books the device does not hold — so the one this
 * test imports is the fourth. The list is fixed: this is the server's word, and the push's reply
 * never mentions a refusal, so the device has nothing else to go on.
 */
test("a fourth book stays on the device, and both screens say so", async ({ page }) => {
  await fakeSync(page, () => ({}));
  await page.route("**/auth/me", (route) =>
    route.fulfill({ json: { userId: "u1", limit: 3, synced: ["b1", "b2", "b3"] } }),
  );
  const bodies: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/books/") && pathname.endsWith("/file")) bodies.push(pathname);
  });

  await openBook(page, BOOKS.horizontal);
  for (let turn = 0; turn < 2; turn += 1) {
    await page.getByRole("button", { name: "Next page" }).click();
    await settled(page);
  }

  // The card: the line arrives with the sync round the import and the page turns armed, so this
  // waits for it rather than for the debounce.
  await page.goto("/");
  const card = page.getByTestId("book-card").first();
  await expect(card.getByTestId("book-status")).toContainText("Only on this device", {
    timeout: 10_000,
  });

  // The details panel says the same thing about the same book.
  await page.getByTestId("book-more").first().click();
  await expect(page.getByTestId("about-only-here")).toHaveText("Only on this device");

  // [[Account]]: the count, and the one book that is not in it.
  await page.goto("/#/settings/account");
  await expect(page.getByTestId("sync-quota")).toHaveText(
    "3 of 3 books sync. 1 is only on this device.",
  );

  expect(bodies).toEqual([]);
});
