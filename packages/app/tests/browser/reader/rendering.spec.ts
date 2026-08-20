import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook, openPanel, readerFrame, settled } from "../support/library.js";

/**
 * That the prose is actually legible — no character drawn on top of the next one.
 *
 * ## Why a geometric assertion lives in spine at all
 *
 * The split this suite otherwise keeps is that frond owns the typographic claims and spine
 * owns behaviour. This one is an exception on purpose, because the defect it caught was
 * **in the app's own test image**, and no
 * suite that runs in frond's image can see it: the image resolved `serif` — and every family
 * name it does not have, which is every name the book and spine's own stack put ahead of the
 * generic — to WenQuanYi Zen Hei, whose Han glyphs carry no vertical advance. Every kanji in
 * the vertical book was laid out with none, and the character after it landed in the same
 * cell. 314 characters in one section of 草枕, in Chromium and in Firefox.
 *
 * The whole behaviour suite stayed green through all of it. It measures whether things
 * *move*, and everything did — the text was simply unreadable while doing so. What did carry
 * the defect out of the container was the evidence screenshots a pull request is read from.
 *
 * `docker/verify-fonts.sh` now checks the binding at build time, which is the earlier and
 * sharper signal. This spec is the other end of the same rope: it asserts the symptom rather
 * than one cause of it, so a future overlap arriving some other way is caught too.
 *
 * ## Why zero, not "small"
 *
 * The signal is not a threshold. A character either advances the inline axis or it does not,
 * and a broken face gives exactly 0 against a normal 18. Whitespace is excluded because a
 * collapsed space legitimately measures zero.
 */

test("no character in the vertical book is drawn on top of the next", async ({ page }) => {
  await openBook(page, BOOKS.vertical);

  // A chapter rather than the section the book opens at: the cover carries 22 characters,
  // far too few to say anything. 「一」 is 草枕's first chapter of prose.
  await openPanel(page, "目錄");
  await page.locator(".toc-item", { hasText: /^一$/ }).click();
  await settled(page);

  const { measured, collapsed } = await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const collapsed: string[] = [];
      let measured = 0;

      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        const value = node.nodeValue ?? "";
        for (let i = 0; i < value.length; i++) {
          // `charAt` rather than `value[i]`, which `noUncheckedIndexedAccess` types as possibly
          // undefined. Same code unit either way — the loop cannot leave the string.
          const char = value.charAt(i);
          if (/\s/.test(char)) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rects = [...range.getClientRects()];
          // No rect at all means the character is not laid out (a `display: none` branch),
          // which is the book's business rather than a collision.
          if (rects.length === 0) continue;
          measured++;
          // The book is vertical-rl, so the inline axis is the rect's height.
          if (rects.every((rect) => rect.height === 0)) collapsed.push(char);
        }
      }

      return { measured, collapsed };
    });

  // Guards the guard: if navigation ever lands somewhere empty, the assertion below would
  // pass by measuring nothing at all.
  expect(measured).toBeGreaterThan(2000);
  expect(collapsed, "characters laid out with no inline advance").toEqual([]);
});
