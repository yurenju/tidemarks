// Not a test: this is the screen sweep (defined in CONTEXT.md), which walks every screen the app
// has and photographs it for a person to look at. It compares nothing — no baselines, no pixel
// comparison — so green means only that all 28 steps still run, and a screen can break without a
// red light anywhere. What it guards is the walk itself; the assertions live in tests/browser/.
import { test, expect, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS_DIR, segment, settled } from "../browser/support/library.js";

/**
 * The screen sweep: every screen the app has, in one pass, as PNGs.
 *
 * The images are for looking at and for discussing visual design with an assistant. What rots on
 * its own is the walk: a renamed `data-testid`, a drawer that became a dialog, a panel that opens
 * another way. Without something exercising this file, it breaks silently and stays broken until
 * the day it is needed. See docs/adr/0027-the-screen-sweep-runs-in-the-container.md.
 *
 * **How things are found here:** a `data-testid` names the screen or the region, and whatever is
 * inside it is found by role and by name — `getByTestId("panel-toc").getByRole("button", …)`.
 * The words are the English ones, which is a claim this file can only make because
 * `playwright.sweep.config.ts` pins the interface language. Both halves were missing at once
 * (#30): the messages moved to English (ADR-0031) while these steps still named the Chinese
 * ones, and nothing was pinning the language either, so which of the two was wrong could not
 * be read off a failure. Ten of the twenty-eight steps photographed the screen before the
 * click for a day.
 *
 * Book titles and chapter names are the exception, and not really one: those are the epub's own
 * words, not Tidemarks', and finding them by their text is the only way to say a chapter was
 * chosen rather than that some button was pressed.
 */

// Where the pictures land. The container run sets this to the directory it has mounted;
// everywhere else it is `.scratch/shots`, which `.gitignore` already covers — these are looked
// at and thrown away, not kept.
const SHOTS_DIR =
  process.env.TIDEMARKS_SHOTS_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".scratch", "shots");

/**
 * The four books the shelf is stocked with.
 *
 * More than the two `library.ts` names, and for a different reason: those two are what the
 * claims about direction and rendering ride on, while these four are here to make a shelf look
 * like a shelf — four covers, mixed scripts, mixed orientations.
 *
 * The reader screens use Alice and 草枕: Alice is long enough that a two-column spread has text
 * in both columns (the first sweep used a book that only filled the left one), and 草枕 is the
 * vertical Japanese one.
 */
const SHELF = [
  join(BOOKS_DIR, "weiguang-ji-horizontal-chinese.epub"),
  join(BOOKS_DIR, "kusamakura-vertical-japanese.epub"),
  join(BOOKS_DIR, "alice-in-wonderland-horizontal.epub"),
  join(BOOKS_DIR, "emphasis-weight-500-chinese.epub"),
];

// Something that is not an epub, for the import error. The README is committed, so this does
// not depend on a file anyone has to make first.
const NOT_A_BOOK = resolve(BOOKS_DIR, "..", "..", "README.md");

test("sweeps every screen", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const dir = join(SHOTS_DIR, device);
  const touch = testInfo.project.use.hasTouch ?? false;

  // Start from an empty directory rather than overwriting into a full one. A step that is
  // renamed or dropped would otherwise leave its picture behind, and a stale picture in a
  // directory of fresh ones is worse than a missing one — there is nothing about it that says
  // it is old.
  await rm(dir, { recursive: true, force: true });

  const taken: string[] = [];
  const failed: string[] = [];

  /**
   * One screen: put the app into a state, then photograph it.
   *
   * Failures are collected instead of thrown. The 28 steps are one continuous journey, so a
   * broken step usually takes several later ones down with it — the first sweep had one bad
   * text selection fail four steps at once — and seeing all four together is what says they
   * have one cause. Throwing on the first would report one, and the next run would report the
   * second. The collected list is what turns the run red, at the end.
   */
  const step = async (name: string, act: () => Promise<void>): Promise<void> => {
    const number = String(taken.length + failed.length + 1).padStart(2, "0");
    try {
      await act();
      await page.screenshot({ path: join(dir, `${number}-${name}.png`) });
      taken.push(`${number}-${name}`);
    } catch (error) {
      // The state of the reader as well as the message. A picture answers "what is on screen"
      // and the message answers "which call gave up", but the step that broke first here was
      // neither: the bars were parked because a panel was standing, and nothing visible said so.
      const where = await chromeState(page).catch(() => "");
      failed.push(`${number}-${name}: ${(error as Error).message.split("\n")[0]}${where}`);
      // A picture of the failure as well, under a name nobody will mistake for a screen.
      await page
        .screenshot({ path: join(dir, `${number}-${name}-FAILED.png`) })
        .catch(() => undefined);
    }
  };

  const fileInput = () => page.locator('input[type="file"][accept=".epub"]');

  /**
   * Puts away a panel if one is standing, and waits until it has gone.
   *
   * **Both halves are load-bearing on a hand-held**, where a panel sends the entries and the
   * Scrubber back to their edges (#167). While one is up there is no `chrome-nav` to press and
   * no bar sitting at home, so anything that reaches for either has to come through here first.
   *
   * The close button rather than Escape: nothing in this app listens for Escape — the presses
   * the first sweep was littered with were doing nothing at all — and on a hand-held the entry
   * that opened the panel is itself parked, so the panel's own ✕ is the one way in that works
   * from both anchors.
   */
  const closePanel = async () => {
    const reader = page.locator(".reader");
    if ((await reader.getAttribute("data-panel")) === null) return;
    await page.locator(".panel-close").click();
    await expect(reader).not.toHaveAttribute("data-panel", /.*/, { timeout: 10_000 });
  };

  /**
   * Raises the chrome, the way the device in hand raises it.
   *
   * Not `library.ts`'s `openChrome`: that one clicks a mouse, which is the desktop's way in and
   * is deliberately the only way in there (ADR-0024). A hand-held is swept with touch emulation
   * on, and a press there is a tap.
   */
  const raiseChrome = async () => {
    await closePanel();
    const box = (await page.locator(".viewer").boundingBox())!;
    const x = box.x + box.width / 2;

    // **Where to press: on the book, and not on a mark.**
    //
    // A press on a marked passage opens that note — which is what it is for, and what makes a
    // fixed press point wrong here. Once a mark is on the page it parks the nav bar behind a
    // panel and the wait below never sees three bars at home; worse, the note it opens stays
    // expanded, so a later step looking for "Add note" finds an editor already open. Both were
    // real: the marks moved under the old point when line heights changed (ADR-0032) and took
    // two steps of this sweep with them.
    //
    // The marks are on screen as `.highlight-box`, so the point is chosen rather than guessed:
    // the first of these heights that clears every one of them by a line or so. The list starts
    // where this always pressed, so a page with no marks presses exactly where it used to.
    const clearOfMarks = async (): Promise<number> => {
      const marks = await page.locator(".highlight-box").evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
      const CLEARANCE = 28;
      for (const fraction of [0.45, 0.72, 0.2, 0.33, 0.6]) {
        const candidate = box.y + box.height * fraction;
        const clear = marks.every(
          (mark) => candidate < mark.top - CLEARANCE || candidate > mark.bottom + CLEARANCE,
        );
        if (clear) return candidate;
      }
      return box.y + box.height * 0.45;
    };

    // Pressed until it is up **and standing still**, not once, and the two are one condition
    // rather than two steps. A press that finds a selection standing is spent putting that
    // selection down and raises nothing (`library.ts`'s openChrome says why the window for that
    // is wider than it looks), and closing a panel can hand the press underneath it to the book,
    // which takes the chrome straight back down. Asking separately — up, then settled — meant
    // the second question was put to a chrome that had already left: a bar on its way out still
    // answers "visible" for the length of its slide, so the wait for it to stop never ended.
    //
    // Each round checks before pressing, or a press meant to raise the chrome would put an
    // already-raised one back down.
    await expect(async () => {
      await closePanel();
      if ((await page.locator(".chrome[data-up]").count()) === 0) {
        const y = await clearOfMarks();
        if (touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await page.waitForTimeout(400);
      }
      await expect(page.locator(".chrome[data-up]")).toHaveCount(1, { timeout: 1_000 });
      // The bars at their home position, read off the bars themselves rather than off a timer —
      // `library.ts`'s `chromeSettled` asks the same question, but it waits without a bound of
      // its own, which inside this retry would spend the whole budget on one round.
      await page.waitForFunction(
        () =>
          [".chrome-top", ".chrome-nav", ".chrome-bottom"].every((selector) => {
            const bar = document.querySelector(selector);
            if (bar === null) return false;
            const at = getComputedStyle(bar).transform;
            return at === "none" || at === "matrix(1, 0, 0, 1, 0, 0)";
          }),
        undefined,
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 25_000 });
  };

  const openPanel = async (label: string | RegExp, testId: string) => {
    await raiseChrome();
    await page.getByTestId("chrome-nav").getByRole("button", { name: label }).click();
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
  };

  /**
   * Opens a book and, when a chapter is named, jumps to it through the table of contents.
   *
   * Both books open on front matter — a plate, a title page, an imprint — and every reader
   * screen here is meant to show a page of the book itself. Without the jump the first sweep's
   * reader screens were of a copyright notice.
   */
  const openBook = async (title: string, chapter?: RegExp) => {
    await page.goto("/#/");

    // The shelf draws the book being read on its own and the rest as a wall of covers, so a
    // book that has been opened once is no longer among the cards — waiting for whichever of
    // the two carries this title covers both. It is also the wait for the shelf to be drawn at
    // all: `goto` to another hash of the same document resolves before React has re-rendered,
    // and asking either locator for a count in that gap answers zero.
    const card = page.getByTestId("book-card").filter({ hasText: title });
    const readingNow = page.getByTestId("reading-now").filter({ hasText: title });
    await expect(card.or(readingNow).first()).toBeVisible({ timeout: 15_000 });

    if ((await card.count()) > 0) await card.first().getByTestId("book-open").click();
    else await readingNow.getByRole("button").first().click();
    await settled(page);

    if (chapter !== undefined) {
      await openPanel("Contents", "panel-toc");
      await page.getByTestId("panel-toc").getByRole("button", { name: chapter }).first().click();
      await settled(page);
      // Choosing a chapter dismisses the panel, and on a hand-held it slides out from the bottom
      // rather than vanishing. Without this wait the next screen — the one named `reader-plain` —
      // was a picture of the table of contents on its way off the bottom of the phone.
      await expect(page.locator(".reader")).not.toHaveAttribute("data-panel", /.*/, {
        timeout: 10_000,
      });
    }
  };

  // ---- the shelf ----------------------------------------------------------

  await step("shelf-empty", async () => {
    await page.goto("/#/");
    await expect(page.getByTestId("shelf-empty")).toBeVisible({ timeout: 15_000 });
  });

  await step("shelf-import-error", async () => {
    await fileInput().setInputFiles(NOT_A_BOOK);
    await expect(page.locator(".error")).toBeVisible({ timeout: 15_000 });
  });

  await step("shelf-four-books", async () => {
    await page.goto("/#/");
    await fileInput().setInputFiles(SHELF);
    await expect(page.getByTestId("book-card")).toHaveCount(SHELF.length, { timeout: 60_000 });
    // The covers are decoded after the cards appear, and a shelf photographed without them is a
    // shelf of grey rectangles.
    await page.waitForTimeout(1_200);
  });

  await step("shelf-order-select", async () => {
    await page.getByTestId("shelf-order").locator("select").selectOption("title");
    await page.waitForTimeout(500);
  });

  await step("about-drawer", async () => {
    await page
      .getByTestId("book-card")
      .filter({ hasText: "Alice" })
      .getByTestId("book-more")
      .click();
    await expect(page.getByTestId("about-numbers")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
  });

  await step("about-delete-confirm", async () => {
    await page.getByTestId("about-delete").click();
    await expect(page.getByTestId("delete-confirm")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
  });

  // ---- settings -----------------------------------------------------------

  await step("settings-typography", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/#/settings/typography");
    await expect(page.getByTestId("settings-screen")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
  });

  // Named for what it actually shows. The sweep does not start `wrangler dev`, so `/api` and
  // `/auth` — which Vite proxies to port 5002 — answer with a gateway error, and the panel is in
  // its signed-out state with the network against it. The signed-in account screen needs a D1
  // migration and a magic code, which is its own piece of work; calling this one
  // `settings-account` would quietly offer it as the account screen.
  await step("settings-account-signed-out", async () => {
    await page.getByTestId("settings-tab-account").click();
    await expect(page.getByTestId("sign-in")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
  });

  // ---- the reader, horizontal English -------------------------------------

  await step("reader-plain", async () => {
    await openBook("Alice", /Rabbit-Hole/);
  });

  await step("reader-chrome-up", async () => {
    await raiseChrome();
  });

  await step("reader-toc", async () => {
    await openPanel("Contents", "panel-toc");
  });

  await step("reader-notes-empty", async () => {
    await openPanel(/Notes/, "panel-notes");
  });

  await step("reader-layout-panel", async () => {
    await openPanel("Type", "panel-layout");
  });

  await step("reader-selection-toolbar", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    // Forward until a page has prose on it. Alice opens on a plate and a title page, and
    // neither holds a run to grab — the first sweep failed this step and the three after it
    // until the sweep learned to turn the page and try again.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((await selectProse(page)) !== null) {
        if (await page.locator(".highlight-toolbar").isVisible()) break;
      }
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(900);
    }
    await expect(page.locator(".highlight-toolbar")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
  });

  await step("reader-highlight-painted", async () => {
    await page.locator(".highlight-toolbar .swatch").first().click();
    await page.waitForTimeout(1_000);
  });

  await step("reader-notes-filled", async () => {
    await openPanel(/Notes/, "panel-notes");
  });

  await step("reader-note-editing", async () => {
    await page.getByRole("button", { name: "Add note" }).first().click();
    await page.locator(".note-editor textarea").fill("這一段想再讀一次。");
    await page.waitForTimeout(400);
  });

  await step("reader-about-drawer", async () => {
    await page.locator(".note-editor button").click();
    await page.keyboard.press("Escape");
    await raiseChrome();
    await page.getByTestId("reader-about").click();
    await expect(page.getByTestId("about-numbers")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
  });

  await step("reader-paged-forward", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    for (let turn = 0; turn < 4; turn += 1) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(700);
    }
  });

  // The shelf's other state, and the one it is now built around: a marked passage on the card,
  // with the book in progress as a row under it. The empty half of the same pair — books, but
  // nothing marked in any of them — is what `shelf-four-books` above is a picture of.
  await step("shelf-mark-card", async () => {
    await page.goto("/#/");
    await expect(page.getByTestId("mark-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("reading-now")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
  });

  await step("shelf-mark-writing", async () => {
    await page.getByTestId("mark-note").click();
    await expect(page.getByTestId("mark-note-input")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
  });

  // ---- the reader, vertical Japanese --------------------------------------

  await step("reader-vertical", async () => {
    await openBook("草枕", /^一$/);
  });

  await step("reader-vertical-chrome-up", async () => {
    await raiseChrome();
  });

  await step("reader-vertical-toc", async () => {
    await openPanel("Contents", "panel-toc");
  });

  // ---- the dark theme -----------------------------------------------------

  await step("settings-dark", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/#/settings/typography");
    await expect(page.getByTestId("settings-screen")).toBeVisible({ timeout: 15_000 });
    // A cell to click, not an option to select: Theme became a segmented control in #167, along
    // with three of Type's other five.
    await segment(page, "setting-theme", "dark").click();
    await page.waitForTimeout(700);
  });

  await step("shelf-dark", async () => {
    await page.goto("/#/");
    await page.waitForTimeout(600);
  });

  await step("reader-dark", async () => {
    await openBook("Alice");
    await raiseChrome();
  });

  await step("reader-dark-layout-panel", async () => {
    await openPanel("Type", "panel-layout");
  });

  // The list is the point of the run: it is what gets pasted alongside the pictures, and it is
  // the only inventory of what the sweep covers — there is deliberately no second index file to
  // fall out of step with this one.
  console.log(`\n${device}: ${taken.length} screens in ${dir}`);
  for (const name of taken) console.log(`  ${name}`);
  for (const failure of failed) console.log(`  FAILED ${failure}`);

  expect(failed, "steps that no longer run — the app moved and this sweep did not").toEqual([]);
});

/**
 * Where the reader's own interface had got to, as one line for a failure message.
 *
 * Written because the failure this sweep was built to catch turned out to be invisible in both
 * of the things a failure already carries. The message named a call that gave up waiting, and
 * the picture showed a book with nothing over it — while the actual cause was a panel standing
 * off-screen, holding the bars parked at their edges. Neither says that; this does.
 *
 * Returns an empty string outside the reader, where there is nothing to report.
 */
async function chromeState(page: Page): Promise<string> {
  const reader = page.locator(".reader");
  if ((await reader.count()) === 0) return "";

  return await reader.evaluate((element) => {
    const bars = [".chrome-top", ".chrome-nav", ".chrome-bottom"].map((selector) => {
      const bar = element.querySelector(selector);
      if (bar === null) return `${selector} absent`;
      const style = getComputedStyle(bar);
      const home = style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)";
      return `${selector} ${home ? "home" : "parked"}/${style.visibility}`;
    });
    const up = element.querySelector(".chrome")?.hasAttribute("data-up") ?? false;
    const panel = element.getAttribute("data-panel");
    return ` [chrome ${up ? "up" : "down"}, panel ${panel ?? "none"}, ${bars.join(", ")}]`;
  });
}

/**
 * Selects a run of prose on the page the reader is looking at, and returns it. `null` when this
 * page holds none.
 *
 * Not `library.ts`'s `selectVisibleText`: that one takes the first long run on the page, which
 * is what a test about selection wants. A picture wants the highlight to land on **prose** —
 * the first sweep painted one over Standard Ebooks' imprint, and then over a chapter subtitle,
 * before this grew the two conditions below.
 */
async function selectProse(page: Page): Promise<string | null> {
  return await page
    .locator(".viewer-mount iframe[data-frond-page]")
    .last()
    .contentFrame()
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return null;

      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        const value = (node.nodeValue ?? "").trim();
        if (value.length < 8) continue;

        const parent = node.parentElement;
        // Inside a paragraph, and outside any heading. Both conditions are needed: the chapter
        // heading is the longest run on the page and would win the first one, and in this
        // edition its subtitle is itself a `<p>` sitting inside an `<hgroup>`.
        if (parent === null || parent.closest("p") === null) continue;
        if (parent.closest("header, hgroup, h1, h2, h3, h4, h5, h6") !== null) continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < view.innerWidth &&
          rect.top < view.innerHeight;
        if (!onScreen) continue;

        const selection = document.getSelection();
        if (selection === null) return null;
        selection.removeAllRanges();
        selection.addRange(range);
        return value;
      }

      return null;
    });
}
