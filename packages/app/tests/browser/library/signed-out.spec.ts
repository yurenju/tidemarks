// The promise in CONTEXT.md's 〈退路〉, as a number: a reader who never registered imports a
// book, reads it, and leaves the tab — and nothing goes to the server. `lib/session.ts` is what
// holds it up; this is the only place that checks it end to end, because the check is about
// requests a running app does or does not make.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, settled } from "../support/library.js";

/**
 * Zero requests, without registering.
 *
 * ## Why here rather than in Vitest
 *
 * The proposition is "`syncNow` and `beaconPositions` send nothing", and both are reached from
 * `App.tsx`'s own triggers — app open, either edge of `visibilitychange`, a window regaining
 * focus or the network coming back, and any tap or keystroke on the interface. A Node test
 * would have to stand in for Dexie, for the triggers and for `fetch`, and would then be
 * asserting about the stand-ins. What it protects against is someone adding one more trigger
 * that skips the check — the list above has grown once already — and only the real app has the
 * triggers in it.
 *
 * ## Why it counts `/auth` as well
 *
 * The sentence being pinned is the whole one — not a byte, to anybody — so the assertion is
 * every request to the Worker, not just `/api/sync`. This spec never opens 〈帳號〉, which is the
 * one screen with a reason to ask the server anything while signed out. `support/fixtures.ts`
 * answers `/auth/*` locally, which does not affect the count: these are the requests the app
 * made, not the ones that found a server.
 */
test("a reader who never registered sends nothing to the server", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) sent.push(request.url());
  });

  // The real import path, which dirties a book row, a cover and an epub body — everything a
  // push would carry.
  await openBook(page, BOOKS.horizontal);

  // And page turns, which are what put a position in the map `beaconPositions` reads. Twice, so
  // the second one overwrites an entry rather than only creating one.
  for (let turn = 0; turn < 2; turn += 1) {
    await page.getByRole("button", { name: "Next page" }).click();
    await settled(page);
  }

  // Leaving the tab and coming back: the beacon on the way out, a sync round on the way in.
  // `visibilityState` is read-only, so it is stubbed — the handler in `App.tsx` reads exactly
  // this and nothing else about the page's state.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Past the write-triggered debounce, because that is the trigger the import and the page turns
  // armed. Without this wait the assertion would pass on a broken build simply by finishing
  // first — so the number is load-bearing, and `scheduleSync`'s default in `src/lib/sync.ts`
  // carries a note pointing back here. It is not imported: that module pulls in Dexie and a
  // Lingui macro, neither of which this runner can transform.
  await page.waitForTimeout(4_000);

  expect(sent).toEqual([]);
});
