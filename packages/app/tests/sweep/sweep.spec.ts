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
 * its own is the walk: a renamed `data-testid`, a panel that became a dialog, a panel that opens
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

/**
 * The phone's three shapes of note, in Alice's first chapter (#239). Ids sort after anything the
 * sweep marked by hand, which does not matter: the list is in book order.
 */
const PHONE_NOTES = [
  {
    id: "sweep-mark-only",
    cfiRange: "epubcfi(/6/12!/4/2[chapter-1]/8,/1:0,/3:20)",
    text: "There was nothing so very remarkable in that;",
    note: "",
  },
  {
    id: "sweep-sentence",
    cfiRange: "epubcfi(/6/12!/4/2[chapter-1]/4,/1:0,/1:104)",
    text: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do:",
    note: "The whole book in its first sentence: a girl bored by a book with no pictures, about to fall into one that is nothing but.",
  },
  {
    id: "sweep-long",
    cfiRange: "epubcfi(/6/12!/4/2[chapter-1],/6/1:40,/12/1:60)",
    text: "as well as she could, for the hot day made her feel very sleepy and stupid",
    note: Array.from(
      { length: 6 },
      (_, i) =>
        `Paragraph ${i + 1}: the Rabbit is late, and Alice follows without asking why — the reading I want to come back to is how little she hesitates.`,
    ).join("\n\n"),
  },
];

/** Writes marked passages straight into IndexedDB — the rows a highlight leaves behind. */
async function seedMarks(
  page: Page,
  bookId: string,
  marks: readonly { id: string; cfiRange: string; text: string; note: string }[],
): Promise<void> {
  await page.evaluate(
    ([id, rows]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("annotations", "readwrite");
          for (const row of rows) {
            tx.objectStore("annotations").put({
              ...row,
              bookId: id,
              color: "indigo",
              createdAt: Date.now() - 3 * 86_400_000,
              updatedAt: Date.now(),
              deletedAt: null,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [bookId, marks] as const,
  );
}

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
    // The marks are on screen as `.highlight-box`, **and the one pointed at as `.highlight-wash`
    // instead** — it loses its box to the wash (`HighlightLayer.tsx`), and the wash outlives
    // [[Reflect]]. Missing the wash, the press after a note is written lands on the passage still
    // lit and puts [[Reflect]] back up, and every round after closes it only to press there again
    // (#244). So the point is chosen rather than guessed: the first of these heights that clears
    // every one of them by a line or so. The list starts where this always pressed, so a page with
    // no marks presses exactly where it used to.
    const clearOfMarks = async (): Promise<number> => {
      const marks = await page.locator(".highlight-box, .highlight-wash").evaluateAll((nodes) =>
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
      // **Choosing a chapter no longer dismisses the panel at every width**, so this asks for it
      // to go rather than waiting for it to. Above 820 the book keeps a column beside [[Contents]] and
      // the panel stays, on the grounds that a chapter is one of a list a reader may be working
      // down (`lib/chrome.ts`); narrower it goes on its own, and `closePanel` returns at once.
      //
      // Waiting is still what the wait was for: on a hand-held the panel slides out rather than
      // vanishing, and without seeing it gone the next screen — the one named `reader-plain` —
      // was a picture of the table of contents on its way off the bottom of the phone.
      await closePanel();
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

  await step("about-panel", async () => {
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

  // The typography half of this floor is gone (ADR-0050): what is photographed here is the
  // theme and the language, and the six settings are photographed in the reader's own panel.
  await step("settings-interface", async () => {
    await page.keyboard.press("Escape");
    await page.goto("/#/settings/interface");
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

  // On a desk only the selected card offers to write, and pressing its passage is what selects
  // it. On a phone the passage is a row of the index, and pressing it opens the note's page, which
  // offers the box the same way.
  await step("reader-note-editing", async () => {
    const write = page.getByRole("button", { name: "Write a note…" });
    await page.getByTestId("panel-notes").locator(".annotation-quote").first().click();
    await write.click();
    await page.locator(".note-editor textarea").fill("這一段想再讀一次。");
    await page.waitForTimeout(400);
  });

  // The same card, still selected, with a note long enough to scroll inside it: the thin scrollbar
  // in the mark's ink, the fade at the bottom, and the line under it that counts what is left.
  await step("reader-notes-long-selected", async () => {
    await page
      .locator(".note-editor textarea")
      .fill(
        Array.from(
          { length: 10 },
          (_, i) =>
            `第 ${i + 1} 段：這一段想再讀一次，下次讀到這一章的時候，把它跟前面那段對照著看。`,
        ).join("\n\n"),
      );
    await page.locator(".note-editor button").click();
    await page.waitForTimeout(600);
  });

  // ---- the phone's notes: an index, and a page per note (#239) -------------
  //
  // The three shapes a note comes in — a mark alone, a sentence with a paragraph under it, a
  // passage over several paragraphs with a long note — seeded rather than drawn: a mark over four
  // paragraphs is not something a sweep can drag out reliably, and these are the book's own CFIs.
  if (device === "mobile") {
    await step("reader-notes-index", async () => {
      await closePanel();
      const bookId = decodeURIComponent(
        new URL(page.url()).hash.replace(/^#\/book\//, "").replace(/\?.*$/, ""),
      );
      await seedMarks(page, bookId, PHONE_NOTES);
      await page.reload();
      await settled(page);
      await openPanel(/Notes/, "panel-notes");
      await expect(page.getByTestId("notes-index")).toBeVisible();
    });

    for (const [name, mark] of [
      ["reader-note-page-mark-only", PHONE_NOTES[0]!],
      ["reader-note-page-sentence", PHONE_NOTES[1]!],
      ["reader-note-page-long", PHONE_NOTES[2]!],
    ] as const) {
      await step(name, async () => {
        const index = page.getByTestId("notes-index");
        if (!(await index.isVisible())) {
          await page.getByTestId("note-page").getByRole("button", { name: /All/ }).click();
        }
        await index.locator(`[data-mark="${mark.id}"]`).click();
        await expect(page.getByTestId("note-page")).toBeVisible();
        await page.waitForTimeout(400);
      });
    }

    // The long one again with its passage opened in full — the other half of the cut.
    await step("reader-note-page-long-open", async () => {
      await page.getByRole("button", { name: /Show the full text/ }).click();
      await page.waitForTimeout(300);
    });

    // The same note open for writing (#240): the passage folded to two lines at the top, the long
    // note in the box under it, [[Done]] at the box's lower right. A mark with no note opened for
    // writing is `reader-note-editing` above, which on a phone is this same page.
    await step("reader-note-page-writing", async () => {
      await page.getByTestId("note-page").getByRole("button", { name: "Edit note" }).click();
      await expect(page.getByTestId("note-page").getByRole("textbox")).toBeFocused();
      await page.waitForTimeout(300);
    });

    // And [[Delete]]'s question in the page's date row, with the focus waiting on Cancel. Left
    // standing for the picture; the Escape the next step opens with is what answers it.
    await step("reader-note-page-delete", async () => {
      const note = page.getByTestId("note-page");
      await note.getByRole("button", { name: "Done" }).click();
      await expect(note.getByRole("textbox")).toHaveCount(0);
      await note.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(note.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.waitForTimeout(300);
    });
  }

  await step("reader-about-panel", async () => {
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

  // ---- the reader, vertical Japanese --------------------------------------

  await step("reader-vertical", async () => {
    await openBook("草枕", /^一$/);
  });

  // Two notes starting on one column, so their [[Note dot]]s share one place in the top margin,
  // each in its own ink. "Mark and note" writes in the default ink, so the second is marked from
  // the colour row and given its note afterwards, from its card.
  await step("reader-vertical-note-dots", async () => {
    const toolbar = page.locator(".highlight-toolbar");
    const panel = page.getByTestId("panel-notes");

    expect(await selectProse(page, { from: 0, to: 3 })).not.toBeNull();
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await toolbar.getByRole("button", { name: "Mark and note" }).click();
    await page.locator(".note-editor textarea").fill("ここから読み直す。");
    await page.locator(".note-editor").getByRole("button", { name: "Done" }).click();
    // [[Done]] writes the note before it closes anything, so the panel is still up for the length
    // of a database write. Asked for its ✕ inside that window, the ✕ slides away under the press.
    await expect(page.locator(".note-editor")).toHaveCount(0);
    await closePanel();

    expect(await selectProse(page, { from: 5, to: 8 })).not.toBeNull();
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await toolbar.locator(".swatch").nth(1).click();
    await openPanel(/Notes/, "panel-notes");
    // On a desk only the selected card offers to write; narrower, every card does. Asked once both
    // cards are drawn, and of the second card alone: asked earlier, an empty list says "no" on a
    // phone too, and pressing the quote there closes the panel the box was about to appear in.
    // A phone's index rows carry the same `data-mark` and quote as the desk's cards; pressing the
    // quote selects the card on a desk and opens the note's page on a phone, and either way the
    // box is then one press away.
    const cards = panel.locator("[data-mark]");
    await expect(cards).toHaveCount(2);
    await cards.nth(1).locator(".annotation-quote").click();
    await panel.getByRole("button", { name: "Write a note…" }).click();
    await page.locator(".note-editor textarea").fill("前の段落と比べる。");
    await page.locator(".note-editor").getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".note-editor")).toHaveCount(0);
    await closePanel();

    // The last one written is still the selected passage after [[Reflect]] closes, so its wash is
    // on the page. A reload puts both at rest, which is the picture.
    await page.reload();
    await settled(page);
    await expect(page.getByTestId("note-dot")).toHaveCount(1);
    await expect(page.getByTestId("note-dot").locator(".note-dot-ink")).toHaveCount(2);
    await page.waitForTimeout(400);
  });

  // A vertical book's note on a phone is still set across: the page is the app's, not frond's.
  if (device === "mobile") {
    await step("reader-vertical-note-page", async () => {
      await openPanel(/Notes/, "panel-notes");
      await page.getByTestId("notes-index").locator("[data-mark]").first().click();
      await expect(page.getByTestId("note-page")).toBeVisible();
      await page.waitForTimeout(400);
    });
  }

  await step("reader-vertical-chrome-up", async () => {
    await raiseChrome();
  });

  await step("reader-vertical-toc", async () => {
    await openPanel("Contents", "panel-toc");
  });

  // ---- the dark theme -----------------------------------------------------

  await step("settings-dark", async () => {
    await page.keyboard.press("Escape");
    // ⚠️ **Waited out rather than assumed.** A panel is a history entry now (ADR-0046), so
    // Escape asks the browser to step back and the address moves a frame later — navigating
    // inside that frame races a traversal already in flight, and what the sweep photographs
    // then is whichever of the two lands second. The panel going is the signal that it landed.
    await expect(page.getByTestId("panel-toc")).toBeHidden();
    await page.goto("/#/settings/interface");
    await expect(page.getByTestId("settings-screen")).toBeVisible({ timeout: 15_000 });
    // A tile to click, not an option to select: Theme became a segmented control in #167 and a
    // tile in ADR-0050, and it is the one typography setting still on this floor.
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
 *
 * `part` narrows it to characters `from` to `to` of that run, counted from its first one that is
 * not white space — for a picture that wants two passages on one line rather than one whole run.
 */
async function selectProse(
  page: Page,
  part?: { from: number; to: number },
): Promise<string | null> {
  return await page
    .locator(".viewer-mount iframe[data-frond-page]")
    .last()
    .contentFrame()
    .locator("body")
    .evaluate((body, part) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return null;

      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        const value = (node.nodeValue ?? "").trim();
        if (value.length < Math.max(8, part?.to ?? 0)) continue;

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
        if (part !== undefined) {
          const lead = (node.nodeValue ?? "").search(/\S/);
          range.setStart(node, lead + part.from);
          range.setEnd(node, lead + part.to);
        }
        selection.removeAllRanges();
        selection.addRange(range);
        return part === undefined ? value : range.toString();
      }

      return null;
    }, part);
}
