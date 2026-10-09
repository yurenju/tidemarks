import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { test } from "../browser/support/fixtures.js";
import { BOOKS_DIR, bookCards, readerFrame, settled } from "../browser/support/library.js";
import { measureTurnPacing } from "../browser/support/pacing.js";
import type { Annotation } from "../../src/lib/types.js";
import {
  everyday,
  extreme,
  pointAt,
  readChapters,
  spread,
  type SeedMark,
} from "./support/marks.js";
import {
  markdown,
  summariseLongFrames,
  summariseSingle,
  type ScenarioResult,
} from "./support/report.js";
import { burstTurns, collectLongFrames, singleTurns } from "./support/turns.js";

/**
 * Page turns under load: the novel-length books, the densest type the reader allows, and
 * [[Mark]]s from none to eighty a page (issue #261, page-turn performance on a long Chinese
 * novel with many marks).
 *
 * **Nothing here asserts on a number.** Green means every scenario ran to the end; the numbers
 * go to `TIDEMARKS_PERF_DIR` (in the container, `.scratch/perf/` on the host) and are read by a
 * person. A ceiling would go red on a busy machine and teach everyone to ignore it — the
 * history in pacing.ts is that lesson twice over.
 *
 * Every scenario reopens the book at the same place, so each run turns the same pages, and the
 * marks are seeded only on the pages a run turns through. That keeps "how many marks are on
 * this page" and "how many are in this chapter" apart: the page scenarios hold about as many
 * marks in the chapter as the chapter scenario does, and differ in where they sit.
 */

const DIRECTIONS = {
  horizontal: {
    name: "horizontal",
    book: join(BOOKS_DIR, "novel-length-horizontal-chinese.epub"),
    forward: "ArrowRight",
    dragForward: -400,
  },
  vertical: {
    name: "vertical",
    book: join(BOOKS_DIR, "novel-length-vertical-chinese.epub"),
    forward: "ArrowLeft",
    dragForward: 400,
  },
} as const;

type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

/**
 * As many characters on a page as the reader allows: the smallest type, no margin floor, two
 * columns where the book can have them. A vertical book is always one column (frond ADR-0003),
 * so the `2` is simply ignored there.
 */
const DENSE = { fontSize: 80, columns: 2, margin: 0 };

/** The long chapter, where the page scenarios run — reached by address, not by turning. */
const LONG = 13;
/** Where in it the runs start, in characters, clear of the heading and its picture. */
const START = 2_000;
/**
 * One thrown away and five measured. Within a scenario the turns come out within a few percent
 * of each other — the cost is set by the marks, not by chance — so five is enough to see it.
 */
const SINGLE_TURNS = 6;
const BURST = { presses: 5, every: 150 };
const DRAG_TURNS = 3;
/** Every page scenario seeds this many pages, from one before the start onwards. */
const SEEDED_PAGES = 8;
/** The boundaries the crossing scenarios turn over: into the long chapter, out of it, and an ordinary one. */
const BOUNDARIES = [11, 12, 13];

/**
 * How long the reading crossing stays on the last page before turning. The next chapter is laid
 * out in the background while that page is on screen, and a turn pressed before it is done has
 * nothing to slide in — measured, that turn waits about 400ms and then jumps without sliding.
 */
const READING_MS = 1_500;

const OUTPUT = resolve(
  process.env.TIDEMARKS_PERF_DIR ?? join(BOOKS_DIR, "..", "..", ".scratch", "perf"),
);

type Scenario =
  | "no marks · ordinary chapter"
  | "no marks · long chapter"
  | "15 a page"
  | "80 a page"
  | "1,000 elsewhere in the chapter"
  | "3,000 in other chapters"
  | "across chapters · after reading the page"
  | "across chapters · straight through";

const EVERY_SCENARIO: readonly Scenario[] = [
  "no marks · ordinary chapter",
  "no marks · long chapter",
  "15 a page",
  "80 a page",
  "1,000 elsewhere in the chapter",
  "3,000 in other chapters",
  "across chapters · after reading the page",
  "across chapters · straight through",
];

test.describe.configure({ mode: "serial" });

test("horizontal at 1× CPU", async ({ page, context }) => {
  await measure(page, context, DIRECTIONS.horizontal, 1, EVERY_SCENARIO);
});

test("vertical at 1× CPU", async ({ page, context }) => {
  await measure(page, context, DIRECTIONS.vertical, 1, EVERY_SCENARIO);
});

/**
 * One throttled run, standing in for a phone. The long frames above are almost all script, and
 * script time scales with the CPU, so the 4× numbers for the rest are the 1× ones times about
 * four. This run is what checks that the scaling still holds; running every scenario at 4× would
 * be most of the suite's time to learn the same thing.
 */
test("horizontal at 4× CPU", async ({ page, context }) => {
  await measure(page, context, DIRECTIONS.horizontal, 4, ["no marks · long chapter", "15 a page"], {
    singleOnly: true,
  });
});

async function measure(
  page: Page,
  context: BrowserContext,
  direction: Direction,
  cpu: number,
  scenarios: readonly Scenario[],
  options: { singleOnly?: boolean } = {},
): Promise<void> {
  await context.addInitScript((settings) => {
    localStorage.setItem("tidemarks-settings", JSON.stringify(settings));
  }, DENSE);

  const chapters = await readChapters(direction.book);
  const long = chapters[LONG - 1]!;
  const others = chapters.filter((chapter) => chapter.chapter !== LONG);
  const id = await importOnce(page, direction.book);

  if (cpu > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }

  // How many characters one page holds, which sets the mark spacing below.
  await openAt(page, id, pointAt(long, START));
  const perPage = await charactersOnPage(page);
  const from = Math.max(0, START - perPage);
  const to = START + perPage * (SEEDED_PAGES - 1);

  const base = (scenario: string, marks: readonly SeedMark[], strips: number, dots: number) => ({
    direction: direction.name,
    cpu,
    scenario,
    marks: marks.length,
    strips,
    dots,
  });

  /** Turns from the same place in the long chapter: one at a time, then a burst, then a drag. */
  const inLong = async (
    scenario: string,
    marks: readonly SeedMark[],
    what: { burst?: boolean; drag?: boolean } = {},
  ): Promise<ScenarioResult> => {
    await seed(page, id, marks);
    const opening = pointAt(long, START);
    const strips = await openAt(page, id, opening);
    const dots = await page.getByTestId("note-dot").count();
    let result: ScenarioResult = {
      ...base(scenario, marks, strips, dots),
      single: summariseSingle(await singleTurns(page, SINGLE_TURNS, direction.forward)),
    };

    if (what.burst && !options.singleOnly) {
      await openAt(page, id, opening);
      const burst = await burstTurns(page, BURST.presses, BURST.every, direction.forward);
      result = {
        ...result,
        burst: {
          frame: burst.frame,
          presses: burst.presses,
          turned: burst.turned,
          elapsed: burst.elapsed,
          longestInterval: Math.max(0, ...burst.intervals),
          longFrames: summariseLongFrames(burst.longFrames),
        },
      };
    }
    if (what.drag && !options.singleOnly) {
      await openAt(page, id, opening);
      const { result: pacing, longFrames } = await collectLongFrames(page, () =>
        measureTurnPacing(page, { turns: DRAG_TURNS, dx: direction.dragForward }),
      );
      result = { ...result, drag: { ...pacing, longFrames: summariseLongFrames(longFrames) } };
    }
    return result;
  };

  /**
   * One crossing per boundary, in one of two ways, because they come out differently.
   *
   * - **reading**: opens on the chapter's last page, stays `READING_MS`, and turns once. That one
   *   turn is kept even though it is the first of its session — the warm-up every other run
   *   throws away — because opening a book, reading a page and turning is the case being asked
   *   about. The column says so in the issue's table rather than being quietly comparable.
   * - **straight through**: opens a little over a page before the chapter's end and turns three
   *   times without stopping, the way a reader flicks back to where they were. The first turn
   *   is the warm-up and is thrown away; whichever of the other two crosses is kept, since where
   *   a page breaks is only known after layout.
   */
  const across = async (scenario: string, way: "reading" | "straight"): Promise<ScenarioResult> => {
    await seed(page, id, []);
    const crossings = [];
    let frame = 0;
    for (const boundary of BOUNDARIES) {
      const chapter = chapters[boundary - 1]!;
      if (way === "reading") {
        await openAt(page, id, pointAt(chapter, chapter.length - 5));
        await page.waitForTimeout(READING_MS);
        const run = await singleTurns(page, 1, direction.forward);
        frame = run.frame;
        crossings.push(...run.turns);
      } else {
        await openAt(page, id, pointAt(chapter, chapter.length - Math.floor(perPage * 1.2)));
        const run = await singleTurns(page, 3, direction.forward);
        frame = run.frame;
        crossings.push(
          ...run.turns.slice(1).filter((turn) => turn.sectionBefore !== turn.sectionAfter),
        );
      }
    }
    return {
      ...base(scenario, [], 0, 0),
      crossing: summariseSingle({ frame, turns: crossings }, true),
    };
  };

  const build: Record<Scenario, () => Promise<ScenarioResult>> = {
    "no marks · ordinary chapter": async () => {
      await seed(page, id, []);
      const strips = await openAt(page, id, pointAt(chapters[4]!, 1_000));
      return {
        ...base("no marks · ordinary chapter", [], strips, 0),
        single: summariseSingle(await singleTurns(page, SINGLE_TURNS, direction.forward)),
      };
    },
    "no marks · long chapter": () =>
      inLong("no marks · long chapter", [], { burst: true, drag: true }),
    "15 a page": () => inLong("15 a page", everyday(long, from, to, perPage / 15, "everyday")),
    "80 a page": () =>
      inLong("80 a page", extreme(long, from, to, perPage / 80, "extreme"), {
        burst: true,
        drag: true,
      }),
    "1,000 elsewhere in the chapter": () =>
      inLong(
        "1,000 elsewhere in the chapter",
        everyday(long, 30_000, long.length, (long.length - 30_000) / 1_000, "chapter"),
      ),
    "3,000 in other chapters": () =>
      inLong("3,000 in other chapters", spread(others, 3_000, "book")),
    "across chapters · after reading the page": () =>
      across("across chapters · after reading the page", "reading"),
    "across chapters · straight through": () =>
      across("across chapters · straight through", "straight"),
  };

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await build[scenario]());
    console.log(`${direction.name} ${cpu}× — ${scenario}: done`);
  }

  await mkdir(OUTPUT, { recursive: true });
  const name = `${direction.name}-${cpu}x`;
  await writeFile(join(OUTPUT, `${name}.json`), JSON.stringify({ perPage, results }, null, 2));
  const table = `characters on a page: ${perPage}\n\n${markdown(results)}\n`;
  await writeFile(join(OUTPUT, `${name}.md`), table);
  console.log(table);
}

/** Imports the book once per test; every scenario after this reopens it by address. */
async function importOnce(page: Page, book: string): Promise<string> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(book);
  const card = bookCards(page).first();
  await card.waitFor({ timeout: 60_000 });
  const id = await card.getAttribute("data-book-id");
  // Said here rather than as a minute-long wait for a reader that an empty id never opens.
  if (!id) throw new Error("the imported book's card carries no data-book-id");
  return id;
}

/**
 * Opens the book at `cfi` from a blank page, so each scenario starts from a fresh load rather
 * than inheriting the last one's heap and listeners. Returns how many mark strips the opening
 * page drew, once they are all drawn.
 */
async function openAt(page: Page, id: string, cfi: string): Promise<number> {
  await page.goto("about:blank");
  await page.goto(`/#/book/${encodeURIComponent(id)}?at=${encodeURIComponent(`cfi:${cfi}`)}`);
  await page.locator('.reader[data-at="arrived"]').waitFor({ timeout: 60_000 });
  await settled(page);
  // Keys go to `document`, the way they do when the reader has not clicked into the book.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return await marksDrawn(page);
}

/**
 * How many characters the page on screen holds, counted one by one where a text node runs off
 * the page. `visibleText` in library.ts answers a different question — which text nodes are
 * touching the page — and a paragraph that starts on the page counts there in full or not at all.
 */
async function charactersOnPage(page: Page): Promise<number> {
  return await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView!;
      const inside = (rect: DOMRect) =>
        rect.width > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < view.innerWidth &&
        rect.top < view.innerHeight;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let count = 0;
      while (walker.nextNode() !== null) {
        const node = walker.currentNode as Text;
        if (node.parentElement?.closest("rt")) continue;
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        if (!rects.some(inside)) continue;
        if (rects.every(inside)) {
          count += node.data.replace(/\s/g, "").length;
          continue;
        }
        for (let at = 0; at < node.data.length; at += 1) {
          if (/\s/.test(node.data[at]!)) continue;
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          if ([...range.getClientRects()].some(inside)) count += 1;
        }
      }
      return count;
    });
}

/**
 * How many mark strips the page has drawn, once that stops changing.
 *
 * The marks are read from IndexedDB after the book is up, so the page goes on drawing them for a
 * moment after `settled` returns. A run started inside that moment would time a page that had
 * no marks yet. Three equal counts 150ms apart is what "drawn" means here.
 */
async function marksDrawn(page: Page): Promise<number> {
  const strips = page.locator(".highlight-box");
  let last = -1;
  let same = 0;
  for (let attempt = 0; attempt < 40 && same < 3; attempt += 1) {
    await page.waitForTimeout(150);
    const count = await strips.count();
    same = count === last ? same + 1 : 0;
    last = count;
  }
  return last;
}

/** Replaces every mark in the store with `marks`. */
async function seed(page: Page, bookId: string, marks: readonly SeedMark[]): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    (rows) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("tidemarks");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("annotations", "readwrite");
          const store = tx.objectStore("annotations");
          store.clear();
          for (const row of rows) store.put(row);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    // Typed against the app's own row, so a schema change shows up here as a type error rather
    // than as a run that seeds rows the reader quietly ignores and reports zero marks drawn.
    marks.map(
      (mark) =>
        ({
          ...mark,
          bookId,
          createdAt: 1_000,
          updatedAt: 1_000,
          deletedAt: null,
        }) satisfies Annotation,
    ),
  );
}
