// The suite's own `settled()` helper, pinned in the only place it can be: the race it survives is
// a browser throwing a frame away mid-await, forced here on purpose. Nearly every spec leans on
// this helper, and a failure of it arrives as somebody else's flake — so this is the one file
// where a red light names the helper (testing.md principle 2: it fails alone).
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures.js";
import { BOOKS, openBook, readerFrame, settled, throughThePage } from "../support/library.js";

/**
 * `settled()` is asked for by nearly every spec in this suite, and one of its waits reaches
 * inside the book's own frame — which frond is free to throw away at any moment. This file is
 * the helper's own test, and it exists because the retry it pins reads like noise to anyone who
 * has not seen it go red: delete the retry, and both cases here fail.
 *
 * ## The window being pinned (#162)
 *
 * `settled()` resolves the page frame, then awaits `fonts.ready` **inside it**. Between those
 * two the frame can be replaced: a settings reflow tears down every SectionView and mounts new
 * ones (measured on the real app at 190%: four frames removed in the 110ms after the new page
 * frame appeared), and a page turn does the same on a smaller scale. Playwright then fails the
 * call rather than the assertion — "Execution context was destroyed" in Firefox, "Frame was
 * detached" in the other two — so the spec dies before it has said anything about the app.
 *
 * No amount of waiting **before** the frame is resolved closes that window; the loss happens
 * during the await. Asking again is the only thing that does, which is why the helper retries
 * once instead of settling harder.
 *
 * The swap is forced rather than waited for. In CI it happened once in a year of runs; here the
 * frame is torn down from inside the getter for `fonts.ready`, so the context is destroyed
 * strictly within the await, every run and in every engine.
 */
test.describe("settled", () => {
  test("retries once when the page frame is swapped mid-wait", async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    await swapPageFrameOnFontsReady(page);

    await settled(page);

    // The replacement, not the frame the wait started in.
    await expect(readerFrame(page).locator("body")).toHaveText("swapped");
  });

  test("still reports a failure that is not the frame going away", async ({ page }) => {
    await openBook(page, BOOKS.vertical);
    await readerFrame(page)
      .locator("body")
      .evaluate(() => {
        Object.defineProperty(document.fonts, "ready", {
          configurable: true,
          get: () => Promise.reject(new Error("fonts are broken")),
        });
      });

    // The retry swallows one kind of failure and no other. Widen it and a real break in the
    // book's fonts turns into a green run.
    await expect(settled(page)).rejects.toThrow("fonts are broken");
  });

  test("asks again once, and only once", async ({ page }) => {
    // The half the two cases above leave open. Both of them stay green against a
    // `throughThePage` that retries **without limit** — and "it cannot launder a real break into
    // a green run" rests entirely on the limit: a product that really did keep tearing the frame
    // down would go quietly green with an unbounded version. So the count is asserted directly.
    //
    // The failure is handed to it rather than caused by a second teardown. Forcing one means
    // holding a trap alive inside a synthetic frame while the app re-renders around it, which was
    // measured here at one run in thirty going the other way — a flaky pin for the flake it was
    // added to prevent. That the loss can be caused for real is what the first case above pins;
    // this one pins what the helper does about it.
    await openBook(page, BOOKS.vertical);

    let reads = 0;
    const alwaysDetached = () => {
      reads += 1;
      return Promise.reject(new Error("Frame was detached"));
    };

    await expect(throughThePage(page, alwaysDetached)).rejects.toThrow("Frame was detached");
    expect(reads, "the read was attempted more than twice").toBe(2);
  });
});

/**
 * Arms the current page frame so that asking for `fonts.ready` tears it down and puts a fresh
 * page frame in its place — the shape frond leaves behind, reproduced on demand.
 *
 * The promise handed back never resolves, so the caller is still awaiting when its context
 * goes: waiting on a timer instead would race the very window this is here to close.
 */
async function swapPageFrameOnFontsReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener("message", (event) => {
      if (event.data !== "tidemarks-test:swap-page-frame") return;
      const mount = document.querySelector(".viewer-mount");
      const stale = mount?.querySelector("iframe[data-frond-page]");
      if (!mount || !stale) return;

      const fresh = document.createElement("iframe");
      fresh.setAttribute("data-frond-page", "");
      mount.append(fresh);
      const document_ = fresh.contentDocument;
      if (document_) {
        document_.open();
        document_.write("<!doctype html><html><body>swapped</body></html>");
        document_.close();
      }
      stale.remove();
    });
  });

  await readerFrame(page)
    .locator("body")
    .evaluate(() => {
      Object.defineProperty(document.fonts, "ready", {
        configurable: true,
        get() {
          window.parent.postMessage("tidemarks-test:swap-page-frame", "*");
          return new Promise(() => {});
        },
      });
    });
}
