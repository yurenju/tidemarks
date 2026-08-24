import { expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { COMMIT_FRACTION, TAP_SLOP_PX } from "../../../src/lib/touch.js";

// The books sit at the repository root rather than inside this package: both packages read the
// same two files, and two copies would be two things to keep in step.
//
// Exported because the screen sweep puts four books on the shelf rather than these two, and a
// second `../../../../..` written out somewhere else would be a second thing to get wrong the
// day this file moves.
export const BOOKS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "books",
);

/**
 * The two books, by what they are for rather than by filename.
 *
 * Both are public domain and committed (`tests/books/README.md`). A commercial book must never
 * be committed, so anything these two cannot express has to be verified through the preview
 * route instead (`docs/agents/verify.md`).
 */
export const BOOKS = {
  /** 直排日文——草枕. ppd=rtl, ruby, 傍點. Every direction-inversion claim rides on this one. */
  vertical: join(BOOKS_DIR, "kusamakura-vertical-japanese.epub"),
  /** 橫排英文——Alice. Illustrations mixed into the text. */
  horizontal: join(BOOKS_DIR, "alice-in-wonderland-horizontal.epub"),
  /**
   * 橫排繁中, written for the weight question: body at 300, `.sans` at 500, `.six-hundred`
   * at 600, `h1` at 700. Nothing else in `tests/books/` declares a numeric weight, so this is
   * the only fixture on which the reader's two-weight rule is visible at all.
   */
  emphasis: join(BOOKS_DIR, "emphasis-weight-500-chinese.epub"),
} as const;

/**
 * Imports a book through the app's own file input and waits for its card, without opening it.
 *
 * `title` is what to wait for, so a spec importing more than one book can tell which card
 * arrived — counting cards would not say which, and the shelf's order is itself under test.
 */
export async function importBook(page: Page, book: string, title: RegExp): Promise<void> {
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(book);
  await expect(bookCards(page).filter({ hasText: title })).toBeVisible({ timeout: 30_000 });
}

/**
 * The cards on the shelf.
 *
 * By `data-testid` rather than by class or by shape: the shelf's markup is being rewritten
 * across this round of work (#127–#129), and a selector spelled out of the layout is a claim
 * that the layout will not change.
 */
export function bookCards(page: Page) {
  return page.getByTestId("book-card");
}

/**
 * Imports a book through the app's own file input and opens it.
 *
 * Deliberately the real path a reader takes, rather than seeding IndexedDB from the outside:
 * the import writes the record, the cover and the epub body, and a migration that broke
 * `importEpubFile` would sail past a seeded fixture.
 *
 * The input is `hidden` (a styled button clicks it), which `setInputFiles` does not mind.
 */
export async function openBook(page: Page, book: string): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"][accept=".epub"]').setInputFiles(book);

  // The card appears once the epub has been parsed and stored.
  const cover = page.getByTestId("book-open").first();
  await expect(cover).toBeVisible({ timeout: 30_000 });
  await cover.click();

  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);
}

/**
 * Waits for the reader to be showing exactly one section, with text in it, **in a box that has
 * stopped moving**.
 *
 * The count matters. React's StrictMode mounts an effect twice in development, so two
 * `Renderer.attach()` calls are in flight at once and **two iframes exist for a moment** —
 * the first one is torn down as soon as its attach resolves. Reading through the transient
 * gives a strict-mode violation, or worse, measurements from the iframe that is about to
 * disappear. Waiting for the steady state is also the honest assertion: if it never settles
 * to one, that is a leak and this should fail.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator(PAGE_FRAME)).toHaveCount(1, { timeout: 30_000 });
  await expect(readerFrame(page).locator("body")).not.toBeEmpty({ timeout: 30_000 });

  await fontsReady(page);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  // And for the page waiting to be dragged in. A frame is in the container from the moment it
  // starts loading, so counting frames would say only that a mount had begun — frond marks a
  // peek once it is laid out and pointed at its page, and a drag started before that gets no
  // preview (frond ADR-0013). Waiting here is what keeps a spec from racing that.
  await expect(page.locator(".viewer-mount iframe[data-frond-peek]").first()).toBeAttached({
    timeout: 30_000,
  });

  // And last, for the box itself to stop moving.
  //
  // Opening or closing a panel takes a column from the book and gives it back over
  // `--chrome-motion` (`styles/device.css`, `.reader[data-panel] .reader-body`), and frond relays
  // out from whatever width its container has at the frame it is asked. Every one of those frames is a
  // real, correct layout — of a width the reader sees for 180ms and never again. A spec that
  // measures inside that window is measuring the transition, and whether it lands inside it is a
  // question of wall-clock, which is the one thing a shared image cannot pin.
  //
  // **The amplifier runs backwards here** (#174). 180ms is a long time for an idle machine, so
  // this spec alone on sixteen cores landed mid-transition every run and read a 16px margin as an
  // inset of 91; the same image running all three engines took longer than 180ms to get here and
  // went green, which is why CI never saw it. A busy machine hides this race instead of showing
  // it — do not read a green full suite as evidence the wait below is unnecessary.
  //
  // Here rather than in the panel helpers, because the hazard is not the panel — it is that
  // anything moving the container makes the next measurement a lie. Last of them, because the
  // peek above is re-mounted by the very relayout this waits for.
  await settledBox(page);
}

/**
 * Blocks until the reader's container and the page inside it measure the same three frames
 * running.
 *
 * Sampled rather than waited on with `transitionend`, because what has to hold is not "the
 * transition ended" but "frond has caught up with where it ended" — the container moves first
 * and the relayout lands a frame or two later, so the interesting quiet is the one after both.
 * A transition still in flight fails the test on its own: its width is fractional and different
 * at every frame. Three frames rather than two buys the gap between the container coming to
 * rest and frond noticing.
 *
 * Both boxes, because either alone can be still while the other is not: the container holds
 * during frond's relayout, and the frame holds while the container slides out from under it —
 * which is exactly the state #174 measured, a frame of the old width centred in a container
 * of a width in between.
 */
async function settledBox(page: Page): Promise<void> {
  const STILL_FRAMES = 3;
  const TIMEOUT_MS = 10_000;

  await page.evaluate(
    async ([frameSelector, stillFrames, timeoutMs]) => {
      const box = (element: Element | null) => {
        if (!element) return "absent";
        const rect = element.getBoundingClientRect();
        return `${rect.x},${rect.y},${rect.width},${rect.height}`;
      };
      const measure = () =>
        `${box(document.querySelector(".viewer-mount"))} ${box(document.querySelector(frameSelector))}`;
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

      const deadline = performance.now() + timeoutMs;
      let previous = measure();
      let still = 0;

      while (still < stillFrames) {
        await nextFrame();
        const current = measure();
        still = current === previous ? still + 1 : 0;
        previous = current;
        if (still < stillFrames && performance.now() > deadline) {
          throw new Error(`the reader's box is still moving after ${timeoutMs}ms: ${current}`);
        }
      }
    },
    [PAGE_FRAME, STILL_FRAMES, TIMEOUT_MS] as const,
  );
}

/**
 * Waits for the book's own fonts, in the frame the reader is on.
 *
 * Waiting at all was learned the hard way: a screenshot taken without it caught the page
 * mid-flight, with every character of a vertical line drawn at the same position, and it looked
 * exactly like a pagination bug. The book names faces (`foobar, HiraMinProN-W3, "@ＭＳ 明朝",
 * serif`), and until the resolution settles the glyph advances are the fallback's. Measurements
 * taken then are of a layout that is about to change.
 *
 * ## Why it asks twice (#162)
 *
 * The frame is resolved first and read from afterwards, and frond may drop it in between: a
 * settings reflow tears down every SectionView and mounts new ones, and a page turn does a
 * smaller version of the same. When that lands inside this await, Playwright fails the call
 * rather than the assertion, and the spec dies before it has said anything about the app.
 *
 * Nothing waited for *before* the frame is resolved closes that window — the count above is a
 * moment, not a promise that the moment lasts. Asking again, against whichever frame is the page
 * now, is what closes it.
 *
 * **Once, and only for this one failure.** A blanket retry, or a second attempt after a font
 * that genuinely never loads, would turn a real break into a green run — which is the whole
 * value of this wait. `reader/settled.spec.ts` pins both halves.
 */
function fontsReady(page: Page): Promise<void> {
  return throughThePage(page, () => waitForFonts(page));
}

/**
 * Runs a read against the page frame, and runs it again if the frame it resolved went away
 * underneath it.
 *
 * The window is the one `fontsReady` above is written about: frond drops and re-mounts its
 * SectionViews, and a call that resolved the frame a moment earlier then fails in Playwright
 * rather than in an assertion — the spec dies before it has said anything about the app. Waiting
 * for the steady state and asking again is what closes it, and the second attempt is against
 * whichever frame is the page *now*.
 *
 * **Only this failure, and only once.** Anything else is rethrown, and a second detach fails the
 * spec — a blanket retry would launder a real break into a green run.
 */
async function throughThePage<T>(page: Page, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!frameWentAway(error)) throw error;

    await expect(page.locator(PAGE_FRAME)).toHaveCount(1, { timeout: 30_000 });
    return read();
  }
}

function waitForFonts(page: Page): Promise<void> {
  return readerFrame(page)
    .locator("body")
    .evaluate((body) => body.ownerDocument.fonts.ready.then(() => undefined));
}

/**
 * Whether this failure is "the frame I was talking to is gone", as opposed to anything the book
 * or the app did.
 *
 * Matched on the message because that is all Playwright gives: the call throws a plain `Error`,
 * and the wording is the engine's. Firefox says the context was destroyed, Chromium and WebKit
 * say the frame was detached — measured, not guessed, in `reader/settled.spec.ts`, which forces
 * the same teardown in all three.
 */
function frameWentAway(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") || message.includes("Frame was detached")
  );
}

/**
 * The frame holding the page the reader is on. Everything about the book's own content is in
 * here.
 *
 * **Not "the iframe"**: frond keeps the pages either side of this one mounted as well, so a
 * drag can show them coming in (frond ADR-0013), and the container holds three frames. The
 * attribute is how frond says which one is the page.
 *
 * `.last()` rather than `.first()`: during the double-mount window above, the surviving frame is
 * the one attached second.
 */
export function readerFrame(page: Page) {
  return page.locator(PAGE_FRAME).last().contentFrame();
}

/** The one frame among the three that is the page the reader is reading. */
export const PAGE_FRAME = ".viewer-mount iframe[data-frond-page]";

/**
 * Drags a finger across the book, the way a reader turns a page (ADR-0024).
 *
 * ## Why the events are dispatched rather than driven
 *
 * Playwright's touch emulation can tap and nothing else, and a mouse is deliberately not a
 * page turn here — so the gesture is built out of `PointerEvent`s dispatched into the book's
 * own document, which is where frond listens.
 *
 * **The coordinates are computed the way a real finger's would be.** The page moves while the
 * finger is on it, and a `clientX` inside a frame that has moved counts from the frame's new
 * corner — so each step takes the finger's position in the outer document and subtracts where
 * the frame has got to. Passing the raw travel instead would make the drag look stationary to
 * frond, which is exactly the bug the coordinate compensation exists to prevent: a page that
 * follows the finger at half speed, or not at all.
 *
 * What this cannot exercise is the browser's own implicit pointer capture, which is what keeps
 * a real finger reporting to the frame it started in once it has wandered off it. That is the
 * engine's business, and it is on the by-hand list (docs/agents/verify.md).
 *
 * @param dx how far to drag, in px. Negative is leftward. For a drag that is meant to turn the
 *   page on distance, take it from `farEnoughToTurn` rather than writing a number down.
 * @param ms roughly how long the whole gesture takes. `0` is a flick, and is paced differently
 *   — see the spin below.
 * @param hold leaves the finger down, for asserting on a turn in progress. `releaseDrag` ends it.
 */
export async function dragPage(
  page: Page,
  {
    dx,
    ms = 300,
    steps = 6,
    hold = false,
  }: { dx: number; ms?: number; steps?: number; hold?: boolean },
): Promise<void> {
  await page.evaluate(
    async ({ dx, ms, steps, hold, selector }) => {
      const frameOf = () => document.querySelector(selector) as HTMLIFrameElement | null;
      const frame = frameOf();
      const view = frame?.contentWindow;
      const target = frame?.contentDocument?.body;
      if (!frame || !view || !target) throw new Error("no page frame to drag");

      const box = frame.getBoundingClientRect();
      // Where the finger lands, in the outer document: the middle of the page, clear of
      // anything the app draws over the edges.
      const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

      const send = (type: string, travel: number) => {
        const now = frameOf()?.getBoundingClientRect() ?? box;
        const Pointer = (view as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
        target.dispatchEvent(
          new Pointer(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: from.x + travel - now.left,
            clientY: from.y - now.top,
          }),
        );
      };

      const frameGap = () => new Promise((resolve) => requestAnimationFrame(resolve));

      // A flick's steps are paced by a spin rather than by a frame. `requestAnimationFrame`
      // hands the wait to the scheduler, and a loaded machine stretches it well past the 90ms
      // the app reads speed over — so a gesture written to be fast arrives slow, reads as
      // stationary, and the page correctly refuses to turn (#15). A spin is the one wait a busy
      // machine cannot lengthen much. 2ms rather than none, because two samples sharing a
      // timestamp are no speed at all and Firefox coarsens its clock.
      const spin = () => {
        const until = performance.now() + 2;
        while (performance.now() < until);
      };

      send("pointerdown", 0);
      for (let step = 1; step <= steps; step += 1) {
        if (ms > 0) {
          await frameGap();
          await new Promise((resolve) => setTimeout(resolve, ms / steps));
        } else {
          spin();
        }
        send("pointermove", (dx * step) / steps);
      }

      const finger = { from, dx, send };
      (window as unknown as { __finger?: typeof finger }).__finger = finger;
      if (!hold) send("pointerup", dx);
    },
    { dx, ms, steps, hold, selector: PAGE_FRAME },
  );
}

/**
 * How far a finger has to travel before letting go turns the page, with room to spare.
 *
 * **Two different gestures commit a turn, and a spec has to say which one it means.** Letting
 * go turns the page if the drag went past `COMMIT_FRACTION` of the page, *or* if it was still
 * moving fast enough to be a flick (`commitsTurn`, src/lib/touch.ts). A spec that writes down a
 * fixed number of pixels is choosing between those two by accident: 260px is a third of a phone
 * and a fifth of this suite's 904px page, so every spec that dragged 260 and expected a turn
 * was in fact asking for the flick — and getting it only because the synthetic finger happened
 * to be quick. On a loaded machine its steps spread past the window the app reads speed over
 * (`VELOCITY_WINDOW_MS`), the reading collapses to zero, and the page goes back where it was.
 * Correct behaviour, red test: that is #15.
 *
 * So the distance is read off the page the spec is actually looking at, and half a page is
 * taken rather than the third that would only just do — a threshold cleared by one pixel is the
 * same accident with a smaller margin.
 */
export async function farEnoughToTurn(page: Page): Promise<number> {
  // Half a page is only a margin for as long as the threshold is under half a page. Saying so
  // out loud costs one comparison and means the day someone raises the third, these specs fail
  // where the reason is written down rather than somewhere in the middle of a gesture.
  if (COMMIT_FRACTION >= 0.5) throw new Error("half a page no longer commits a turn");

  const extent = await page.locator(".viewer-mount").evaluate((mount) => mount.clientWidth);
  return Math.round(extent / 2) + TAP_SLOP_PX;
}

/** Lifts a finger left down by `dragPage(..., { hold: true })`. */
export async function releaseDrag(page: Page): Promise<void> {
  await page.evaluate(() => {
    const finger = (
      window as unknown as {
        __finger?: { dx: number; send: (type: string, travel: number) => void };
      }
    ).__finger;
    finger?.send("pointerup", finger.dx);
  });
}

/**
 * How far the page has been dragged from where it rests, in px along x.
 *
 * Read off the frame's own transform, which is what frond moves: 0 means nothing is in
 * progress, and the sign says which way the reader is pulling.
 */
export async function pageOffset(page: Page): Promise<number> {
  return await page
    .locator(PAGE_FRAME)
    .last()
    .evaluate((frame) => {
      const transform = getComputedStyle(frame).transform;
      if (transform === "none") return 0;
      return new DOMMatrixReadOnly(transform).m41;
    });
}

/**
 * What the page did while `act` ran: where it sat on every frame, and how many frames were lit.
 *
 * **The only way to see an animation from out here.** `pageOffset()` is one reading over a CDP
 * round trip, and a turn that lasts 220ms is over before a poll built out of those can be
 * trusted to have caught the middle of it — a suite that asserts on such a poll goes red on a
 * busy machine and tells nobody anything. So the sampling happens on the page, one reading per
 * `requestAnimationFrame`, and only the collected list crosses the socket.
 *
 * `act` is driven from here rather than inside the page because it is a real click on a real
 * button: what is being tested includes the wiring from that button to the turn.
 */
export async function traceTurn(
  page: Page,
  act: () => Promise<void>,
  { ms = 1200 }: { ms?: number } = {},
): Promise<{ offsets: number[]; frames: number[] }> {
  await page.evaluate(
    ({ ms, selector }) => {
      const offsets: number[] = [];
      const frames: number[] = [];
      const trace = { offsets, frames };
      (window as unknown as { __turnTrace?: typeof trace }).__turnTrace = trace;

      const startedAt = performance.now();
      const step = (now: number) => {
        const current = document.querySelector(selector);
        const mount = document.querySelector(".viewer-mount");
        if (current !== null) {
          const transform = getComputedStyle(current).transform;
          offsets.push(transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41);
        }
        if (mount !== null) {
          frames.push(
            [...mount.querySelectorAll("iframe")].filter(
              (frame) => getComputedStyle(frame).visibility === "visible",
            ).length,
          );
        }
        if (now - startedAt < ms) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    { ms, selector: PAGE_FRAME },
  );

  await act();
  await page.waitForTimeout(ms);

  return await page.evaluate(
    () =>
      (window as unknown as { __turnTrace?: { offsets: number[]; frames: number[] } })
        .__turnTrace ?? { offsets: [], frames: [] },
  );
}

/** How many of the three frames are actually being painted. Two of them, mid-turn. */
export async function visibleFrames(page: Page): Promise<number> {
  return await page
    .locator(".viewer-mount")
    .evaluate(
      (mount) =>
        [...mount.querySelectorAll("iframe")].filter(
          (frame) => getComputedStyle(frame).visibility === "visible",
        ).length,
    );
}

/**
 * Holds a finger still in the middle of the page until the press becomes a selection.
 *
 * **The only way to select anything where the pointer is coarse.** There, the browser's own
 * selection is off inside the book and Tidemarks makes its own (ADR-0036), so
 * `selectVisibleText` below has nothing to work with — `user-select: none` makes a
 * programmatically added range a no-op in WebKit, and even where it does not, a range the app
 * never heard about raises no toolbar.
 *
 * Dispatched into the book's own frame, the way `dragPage` does, because that is where frond
 * listens: an event on the container never crosses into the document holding the text.
 *
 * @param ms how long to hold. The default clears `LONG_PRESS_MS` with room for a loaded machine.
 */
export async function longPressSelect(
  page: Page,
  { ms = 700, at }: { ms?: number; at?: { x: number; y: number } } = {},
): Promise<void> {
  await page.evaluate(
    async ({ ms, at, selector }) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement | null;
      const view = frame?.contentWindow;
      const target = frame?.contentDocument?.body;
      if (!frame || !view || !target) throw new Error("no page frame to press");

      // The middle of the page unless the caller aimed somewhere — see `textPoint` for when the
      // middle will not do. A point given in the outer document's coordinates, because that is
      // where a caller can measure one; the frame's own origin is the whole conversion.
      const box = frame.getBoundingClientRect();
      const point =
        at === undefined
          ? { x: box.width / 2, y: box.height / 2 }
          : { x: at.x - box.left, y: at.y - box.top };

      const Pointer = (view as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
      const send = (type: string) =>
        target.dispatchEvent(
          new Pointer(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: point.x,
            clientY: point.y,
          }),
        );

      send("pointerdown");
      await new Promise((resolve) => setTimeout(resolve, ms));
      send("pointerup");
    },
    { ms, at, selector: PAGE_FRAME },
  );
}

/**
 * The middle of each run of text on the page, longest first, in the outer document's
 * coordinates.
 *
 * **The middle of the page is not reliably on a character.** A vertical book lays its column
 * against one edge and leaves the rest of the screen empty; a cover is a title and an author
 * with a screenful of nothing between them; how much of a page is text differs per engine
 * because the pagination does. A gesture aimed at a point with no text under it resolves to
 * whichever character happens to be nearest — which is a selection that cannot be dragged
 * anywhere, and a test that fails saying nothing about the thing it names.
 *
 * Several rather than one, because a drag needs somewhere to go as well as somewhere to start.
 */
export async function textPoints(page: Page): Promise<{ x: number; y: number }[]> {
  const points = await page.evaluate(
    ({ selector }) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement | null;
      const view = frame?.contentWindow;
      const body = frame?.contentDocument?.body;
      if (!frame || !view || !body) return [];

      const document_ = body.ownerDocument;
      const box = frame.getBoundingClientRect();
      const walker = document_.createTreeWalker(body, 4 /* SHOW_TEXT */);
      const found: { x: number; y: number; length: number }[] = [];

      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        const value = (node.nodeValue ?? "").trim();
        if (value.length === 0) continue;

        const range = document_.createRange();
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

        found.push({
          x: box.left + rect.left + rect.width / 2,
          y: box.top + rect.top + rect.height / 2,
          length: value.length,
        });
      }

      return found.sort((a, b) => b.length - a.length).map(({ x, y }) => ({ x, y }));
    },
    { selector: PAGE_FRAME },
  );

  expect(points.length, "no visible text on this page").toBeGreaterThan(0);
  return points;
}

/**
 * Selects a run of text that is on the page in front of the reader, and returns it.
 *
 * ⚠️ **Only where the browser's own selection is still on** — a desk, in this suite's terms.
 * Under mobile emulation the reader's finger is the primary pointer, selection inside the book
 * is off, and `longPressSelect` above is the way in.
 *
 * Through the selection API rather than a mouse drag. A drag has to be aimed, and aiming it
 * means knowing where the text runs — which is the opposite direction in a vertical book, and
 * a coordinate guess that differs per engine. What this exercises is the same path either way:
 * a real selection in the content document raises `selectionchange`, frond turns that into its
 * `selection` event carrying the CFI and the rectangles, and spine places the toolbar from them.
 * The one thing it does not cover is the browser's own hit-testing of a drag, which is the
 * browser's business rather than spine's.
 *
 * **A run of prose is preferred, but a short one will do.** The first page of the vertical book
 * is a cover, and what a phone shows of it is a two-character title and a four-character author
 * — no run of prose at all, because the paragraph that follows them is on the next screenful.
 * Asking for eight characters there fails the whole spec on a page that has plenty to select;
 * the fallback takes the longest visible run instead, which is a real selection in a real place.
 */
export async function selectVisibleText(page: Page): Promise<string> {
  const selected = await readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return null;

      // Long enough to be prose rather than whitespace between elements, and to give the
      // highlight a box big enough to aim a tap at.
      const PROSE = 8;

      const select = (node: Node, value: string): string | null => {
        const selection = document.getSelection();
        if (selection === null) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        return value;
      };

      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let longest: { node: Node; value: string } | null = null;
      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        const value = (node.nodeValue ?? "").trim();
        if (value.length === 0) continue;

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

        if (value.length >= PROSE) return select(node, value);
        if (longest === null || value.length > longest.value.length) longest = { node, value };
      }

      return longest === null ? null : select(longest.node, longest.value);
    });

  expect(selected, "no visible prose to select on this page").not.toBeNull();
  return selected!;
}

/**
 * Raises the chrome, which is where every control in the reader now lives.
 *
 * A mouse click on the page, which is the desktop's way in and takes no zones (ADR-0020) — so
 * where it lands does not matter, only that it is not on a link. The middle of the page it is.
 * A tap has to obey the three-tenths band and belongs in `tap.spec.ts`.
 */
export async function openChrome(page: Page): Promise<void> {
  // The same click that raises it puts it away again, so a test that already has it up must not
  // ask twice — this is "make sure it is up", not "click the page".
  const chrome = page.getByTestId("chrome-bottom");
  if (!(await chrome.isVisible())) {
    const box = (await page.locator(".viewer").boundingBox())!;

    // Clicked until it is up, rather than once.
    //
    // A tap that finds a selection standing is spent putting that selection down and raises
    // nothing — "one press, one thing" (`Reader.tsx`). Painting a highlight puts the selection
    // away, but the browser's own selection inside the iframe outlives the toolbar by a few tens
    // of milliseconds (measured: still 14 characters at +40ms, gone at +68ms). A single click
    // landing in that window is spent on the selection, and this helper then waited for a chrome
    // that was never asked for. On a loaded machine that window is wider, which is how it
    // reached CI and not this machine.
    //
    // A reader in that position taps again, so this does too. What it must not do is click
    // blind: each round checks before clicking again, or a click meant to raise the chrome would
    // put an already-raised one back down.
    await expect(async () => {
      if (!(await chrome.isVisible())) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
      }
      await expect(chrome).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }

  await chromeSettled(page);
}

/**
 * Waits for the bars to stop travelling.
 *
 * The chrome slides in now, and a bar is visible from the first frame of that slide — so
 * "visible" and "where it belongs" are two different moments, and every measurement in this
 * suite wants the second one. The wait lives here rather than in each test because reaching for
 * a rectangle is what a test does *after* calling `openChrome`.
 *
 * Identity, read off the bar itself, rather than a timer: whatever `--chrome-motion`
 * (`styles/tokens.css`) becomes, this asks the same question.
 */
export async function chromeSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    [".chrome-top", ".chrome-nav", ".chrome-bottom"].every((selector) => {
      const bar = document.querySelector(selector);
      if (bar === null) return false;
      const at = getComputedStyle(bar).transform;
      return at === "none" || at === "matrix(1, 0, 0, 1, 0, 0)";
    }),
  );
}

/**
 * Raises the chrome and opens one of its three panels by the button's own label.
 *
 * The row of entries is `chrome-nav` whichever edge it is on — that is the point of the name.
 * At this suite's 1000×700 with a fine pointer it is a row under the top bar; on a hand-held it
 * is above the Scrubber (ADR-0023), and nothing here has to know which.
 *
 * **It returns when the panel has arrived, not when it has been asked for**, in the same words
 * `openChrome` waits for the bars: a transform that has come back to rest. Playwright's own
 * actionability check is not enough here — it calls an element stable once two consecutive
 * frames agree on its box, and the tail of an ease-out moves less than a pixel per frame. A
 * click sent then is aimed at where the panel was, lands short of it, and on a desk that means
 * it lands in the book's iframe: no error, no effect, and a setting that quietly stayed put.
 */
export async function openPanel(page: Page, label: string | RegExp): Promise<void> {
  await openChrome(page);
  await page.getByTestId("chrome-nav").getByRole("button", { name: label }).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector(".panel-popup");
    if (panel === null) return false;
    const at = getComputedStyle(panel).transform;
    return at === "none" || at === "matrix(1, 0, 0, 1, 0, 0)";
  });
}

/**
 * One cell of a segmented setting — 主題, 欄數, 字型 or 留白.
 *
 * Four of 〈排版〉's six put every option on the page instead of hiding them behind a native
 * `<select>`, so choosing one is a click on the cell rather than a `selectOption`, and reading
 * back which is chosen is `aria-checked` rather than `toHaveValue`. This helper exists so the
 * specs spell that once: `segment(page, "setting-margin", 48)`.
 *
 * 行距 and 字級 are not segmented — six long labels and a slider — so they stay as they were.
 */
export function segment(page: Page, setting: string, value: string | number) {
  return page.getByTestId(`${setting}-${value}`);
}

/**
 * The reader's position, as the app itself shows it — the Scrubber's own value.
 *
 * Needs the chrome up, because that is where the Scrubber is. What used to be read here was a
 * percentage in the header, and the header is not on screen while the reader is reading.
 */
export async function progressPercent(page: Page): Promise<number> {
  const value = await page.getByTestId("scrubber-track").getAttribute("aria-valuenow");
  return Number(value);
}

/**
 * Waits for the whole-book index, after which the Scrubber is usable and a fraction exists.
 *
 * Read off the reader itself rather than off any control: the index is a fact about the book,
 * and every control that reports it is now behind a state the test would have to enter first.
 */
export async function waitForIndex(page: Page): Promise<void> {
  await expect(page.locator(".reader")).toHaveAttribute("data-indexed", "true", {
    timeout: 60_000,
  });
}

/**
 * The first line of text on the page in front of the reader.
 *
 * Used as the "did the page turn" signal. It reads from the iframe's own selection API rather
 * than from `textContent`: the whole section is in the document and only one page of it is
 * visible, so `textContent` would be identical before and after a turn.
 *
 * Through `throughThePage` for the same reason `fontsReady` is: every caller here is asking
 * across a turn, which is precisely when frond is re-mounting the frame this reads from. The
 * poll around this in most specs does not cover it — a detached frame fails the call rather than
 * returning a value the poll could reject.
 */
export function visibleText(page: Page): Promise<string> {
  return throughThePage(page, () => readVisibleText(page));
}

function readVisibleText(page: Page): Promise<string> {
  return readerFrame(page)
    .locator("body")
    .evaluate((body) => {
      const document = body.ownerDocument;
      const view = document.defaultView;
      if (view === null) return "";

      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const lines: string[] = [];

      while (walker.nextNode() !== null) {
        const node = walker.currentNode;
        if ((node.nodeValue ?? "").trim() === "") continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        // Inside the visible viewport of the iframe, which frond scrolls one page at a time.
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < view.innerWidth &&
          rect.top < view.innerHeight;
        if (onScreen) lines.push(node.nodeValue!.trim());
        if (lines.length >= 3) break;
      }

      return lines.join(" ").slice(0, 80);
    });
}
