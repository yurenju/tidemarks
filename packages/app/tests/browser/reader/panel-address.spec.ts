// Every panel is in the address now, and the back button steps out one storey (ADR-0046).
//
// What only a browser can say: that `history.back()` really pops the entry the app pushed, that
// a reload comes back to the panel that was up, and that a tab whose *first* entry already names
// a panel can still be got out of. The rules themselves are pure and live in
// src/lib/route.test.ts (which spelling means which storey) and src/lib/chrome.test.ts (what the
// chrome comes back as); none of that can tell you whether the address moved.
//
// ⚠️ **Almost every case here presses back or reloads**, so nothing in it is safe to fold into
// another file: a stray history entry left behind by a helper is a failure two tests later.
//
// Which glyph the way out wears is not asserted anywhere on its own. It does not need to be: the
// name is how these cases and `hand-held.spec.ts` reach the button at all, so a ✕ and a ← that
// swapped places would take both files red.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import {
  BOOKS,
  openBook,
  openChrome,
  openPanel,
  longPressSelect,
  selectVisibleText,
} from "../support/library.js";

/** The `?d=` field of the address, or `null` when there is none. */
function panelInAddress(page: Page): string | null {
  const hash = new URL(page.url()).hash;
  const cut = hash.indexOf("?");
  if (cut === -1) return null;
  return new URLSearchParams(hash.slice(cut + 1)).get("d");
}

/** The book id the address is on, which every `?d=` carries a copy of. */
function openBookId(page: Page): string {
  const hash = new URL(page.url()).hash;
  const cut = hash.indexOf("?");
  const path = cut === -1 ? hash : hash.slice(0, cut);
  return decodeURIComponent(path.replace("#/book/", ""));
}

/**
 * Marks the passage on screen, which is the shortest way to a book with one note in it.
 *
 * A long press rather than a selection added by hand: on the pointer these cases are about, the
 * browser's own selection inside the book is off and Tidemarks draws its own (ADR-0036).
 */
async function markPassage(page: Page): Promise<void> {
  await longPressSelect(page);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();
  await paintMark(page);
}

/**
 * The same, with a mouse, and it hands back the words so the quote can be found in the list.
 *
 * A range added by hand rather than a long press, because on a fine pointer the book is
 * selectable and the browser's own selection is the one in play (ADR-0036).
 */
async function markVisiblePassage(page: Page): Promise<string> {
  const text = await selectVisibleText(page);
  await expect(page.locator(".highlight-toolbar")).toBeVisible();
  await paintMark(page);
  return text;
}

async function paintMark(page: Page): Promise<void> {
  await page.locator(".highlight-toolbar .swatch").first().click();
  await expect(page.locator(".highlight-box").first()).toBeVisible();
}

test.describe("on a desk, where a panel stands beside the book", () => {
  test("raising a panel puts it in the address, and back takes it away again", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    const bookId = openBookId(page);

    await openPanel(page, /Contents/);
    expect(panelInAddress(page)).toBe(`toc/${bookId}`);

    // What Android's back button does, and what the browser's does on a desk. **The book stays**
    // — the panel was a storey above it, not a screen of its own.
    await page.goBack();
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    expect(panelInAddress(page)).toBe(null);
    await expect(page.locator(".reader")).toBeVisible();

    // And only now does back leave the book. One press per storey, in the order they were built.
    await page.goBack();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
  });

  // Another face on the same storey, so the address is written over rather than pushed. Pushed,
  // a reader who tried two panels on the way would have to press back once per panel to leave a
  // book they only entered once.
  test("swapping one panel for another does not add a storey", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    const bookId = openBookId(page);

    await openPanel(page, /Contents/);
    await openPanel(page, /Notes/);
    expect(panelInAddress(page)).toBe(`notes/${bookId}`);

    await page.goBack();
    expect(panelInAddress(page)).toBe(null);
    await expect(page.locator(".reader")).toBeVisible();
  });

  // ⚠️ `?d=` holds one value, so the four faces are exclusive by construction. This is the one
  // pair a reader can ask for at once, [[About]] having a door of its own in the same bar.
  test("opening the book's details closes the panel that was standing", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    const bookId = openBookId(page);

    await openPanel(page, /Contents/);
    await page.getByTestId("reader-about").click();

    await expect(page.getByTestId("panel-about")).toBeVisible();
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    expect(panelInAddress(page)).toBe(`about/${bookId}`);
  });

  /**
   * The storey rule seen from the side that has nothing to do with pressing ✕.
   *
   * A page turn puts the chrome away, panel and all — one of eight events that can. If descending
   * only counted when the reader asked for it in so many words, this turn would leave the panel's
   * history entry standing with nothing on screen belonging to it, and the reader would press
   * back twice to leave a book they entered once.
   *
   * **An arrow key rather than the page button**, and the difference matters: a press anywhere
   * outside the panel is an outside press first, and Base UI spends it dismissing the panel
   * rather than turning anything. The key is the one route into a turn that is not also a
   * dismissal, so it is the only one that puts *this* claim on the line.
   */
  test("a page turn takes the panel's history entry with it", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    await openPanel(page, /Contents/);

    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    // **The whole chrome went, not just the panel**, which is what says a turn did this rather
    // than a press outside: dismissing a panel leaves the bars standing, and only a turn drops
    // the reader all the way to [[Read]] (`lib/chrome.ts`).
    await expect(page.getByTestId("chrome-bottom")).toBeHidden();
    expect(panelInAddress(page)).toBe(null);

    await page.goBack();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
  });

  /**
   * The ✕ pops the entry rather than writing over it.
   *
   * Written over, the address would be right and the stack would not: an entry identical to the
   * one before it, so the reader's next press of back appears to do nothing and it takes two to
   * leave a book they entered once. **The second press is the whole assertion** — the first
   * proves nothing on its own.
   */
  test("closing a panel by hand leaves no entry behind", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    await openPanel(page, /Contents/);

    await page.getByTestId("panel-toc").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("panel-toc")).toBeHidden();

    await page.goBack();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
  });

  /**
   * The same, after the address has been rewritten under the standing panel.
   *
   * Pressing a quote in [[Notes]] takes the reader to the passage and writes the page they landed
   * on into the bar, so it can be copied out. Beside the book the panel stays up through that.
   * ⚠️ **That write has to carry the entry's own state along**: the mark `showPanel` put there is
   * what the ✕ afterwards reads to know it may pop, and a `null` in its place turns the next
   * press of back into a no-op. Measured; nothing else in the suite goes near this pair.
   */
  test("nor does it once a jump has rewritten the address underneath it", async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    const text = await markVisiblePassage(page);
    await openPanel(page, /Notes/);

    // The quote itself. Beside the book the panel stays standing through the jump, which is the
    // arrangement this case needs — the ✕ below has to be the thing that closes it.
    await page
      .getByTestId("panel-notes")
      .getByRole("button", { name: text.slice(0, 12), exact: false })
      .click();
    await expect(page.getByTestId("panel-notes")).toBeVisible();
    expect(new URL(page.url()).hash).toContain("at=");

    await page.getByTestId("panel-notes").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("panel-notes")).toBeHidden();

    // **And the passage the jump named is still in the address.** Stepping out of a panel takes
    // back the storey it was standing on, not the page the reader is looking at.
    expect(new URL(page.url()).hash).toContain("at=");

    await page.goBack();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
  });

  /**
   * Two storeys down in one press, which is what a ✕ on an open note editor is.
   *
   * ⚠️ **Depth is not the number of entries.** The reader climbed here in two pushes — open the
   * list, open a note — and `panelDismissed` clears both storeys in a single commit, so a
   * descent that popped one entry would land back on the list and the address→chrome mirror
   * would put it straight back on screen. What the entry carries is the panel that was standing
   * behind it, and that is what says how far back to go.
   */
  test("a ✕ on an open note leaves the whole stack, not one storey of it", async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    await markVisiblePassage(page);
    await openPanel(page, /Notes/);

    await page.getByTestId("panel-notes").getByRole("button", { name: "Add note" }).click();
    expect(panelInAddress(page)).toMatch(/^notes\/.+\/.+/);

    await page.getByTestId("panel-notes").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("panel-notes")).toBeHidden();
    expect(panelInAddress(page)).toBe(null);

    // And one press of back leaves the book, because both entries went with it.
    await page.goBack();
    await expect(page.getByTestId("book-card").first()).toBeVisible();
  });
});

test.describe("on a hand-held, where a panel covers the screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(
    ({ browserName }) => browserName === "firefox",
    "Playwright has no mobile emulation for Firefox",
  );

  // The one change a reader will notice: an address that survives a reload survives it whatever
  // the panel was, including [[Layout]], which they were only glancing at.
  for (const [label, testId, entry] of [
    ["Contents", "panel-toc", /Contents/],
    ["Notes", "panel-notes", /Notes/],
    ["Type", "panel-layout", /Type/],
  ] as const) {
    test(`${label} is still standing after a reload`, async ({ page }) => {
      await openBook(page, BOOKS.horizontal);
      await openPanel(page, entry);

      await page.reload();
      await expect(page.getByTestId(testId)).toBeVisible();
    });
  }

  test("the book's details is still standing after a reload", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    // The bar it lives in is away until the reader asks for it, which on a hand-held is the
    // whole of what [[Read]] means.
    await openChrome(page);
    await page.getByTestId("reader-about").click();
    await expect(page.getByTestId("panel-about")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("panel-about")).toBeVisible();
  });

  /**
   * The two storeys of [[Notes]], walked out of the way they were walked into.
   *
   * The reader took two steps to get here — open the list, press a mark in it — so back gives
   * them two, and the middle one is the list. Ending up at the book from inside a note would
   * skip a screen they had been standing on.
   */
  test("back leaves a note for the list it came from, and only then the book", async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    const bookId = openBookId(page);
    await markPassage(page);

    await openPanel(page, /Notes/);
    await page.getByTestId("panel-notes").getByRole("button", { name: "Add note" }).click();
    expect(panelInAddress(page)).toMatch(new RegExp(`^notes/${bookId}/.+`));

    await page.goBack();
    expect(panelInAddress(page)).toBe(`notes/${bookId}`);
    await expect(page.getByTestId("panel-notes")).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId("panel-notes")).toBeHidden();
    await expect(page.locator(".reader")).toBeVisible();
  });

  /**
   * Two storeys climbed in one step, so one step back.
   *
   * Pressing a mark on the page opens its note directly — the reader never saw the list, and
   * putting a stop on the way out at a screen they were never on would be the app inventing a
   * step for them.
   */
  test("a note opened from the page takes one press of back to leave", async ({ page }) => {
    await openBook(page, BOOKS.vertical);

    // [[Mark and note]] is the route that climbs both storeys at once: the reader is put straight
    // into the editor from a selection on the page, having never seen the list. (Pressing a mark
    // already on the page is the same jump through the same `openNote`; this one is asked for
    // through a button rather than through a hit test on boxes drawn beside the text.)
    await longPressSelect(page);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    await page.getByRole("button", { name: "Mark and note" }).click();
    await expect(page.getByTestId("panel-notes")).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId("panel-notes")).toBeHidden();
    await expect(page.locator(".reader")).toBeVisible();
  });
});

/**
 * The address a reader pasted, which is the case that fails silently and only here.
 *
 * A panel opened inside the app sits on an entry the app pushed, and closing it is a
 * `history.back()`. Pasted into a new tab, that same address *is* the tab's first entry: there
 * is nothing behind it to pop, so `back()` changes nothing, no `hashchange` arrives, the state
 * machine is never told — and the panel stays on screen through every press of ←. Nothing in a
 * suite that always opens the book first would ever reach it.
 */
test.describe("an address somebody pasted", () => {
  test("can be got out of, though nothing pushed it", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    const bookId = openBookId(page);

    // A navigation rather than a press inside the app, which is what makes this the case under
    // test: the browser leaves `history.state` empty on one, so the entry carries no mark and
    // the ✕ has to take the other branch.
    await page.goto(`/#/book/${encodeURIComponent(bookId)}?d=toc/${encodeURIComponent(bookId)}`);
    await expect(page.getByTestId("panel-toc")).toBeVisible();

    await page.getByTestId("panel-toc").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    expect(panelInAddress(page)).toBe(null);
    await expect(page.locator(".reader")).toBeVisible();
  });

  // Losing one note should not cost the whole list — the same answer `lib/route.ts` gives every
  // other unreadable address, one field further in.
  test("naming a note that is not there falls back to the list", async ({ page }) => {
    await openBook(page, BOOKS.horizontal);
    const bookId = openBookId(page);
    const id = encodeURIComponent(bookId);

    await page.goto(`/#/book/${id}?d=notes/${id}/nope`);

    await expect(page.getByTestId("panel-notes")).toBeVisible();
    await expect.poll(async () => panelInAddress(page)).toBe(`notes/${bookId}`);
  });
});
