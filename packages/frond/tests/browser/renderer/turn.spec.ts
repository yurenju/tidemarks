// A turn in progress (frond ADR-0013): three documents mounted at once, the frames really where
// the arithmetic says, and roles changing hands without anything being rebuilt. The arithmetic
// itself is pure — `turnPlacement`, in tests/node/renderer/geometry.test.ts — and what needs an
// engine is that the frames exist and move.
import { expect, test, type Page } from "@playwright/test";
import {
  clickIntoPage,
  mountFixture,
  openHarness,
  peeksReady,
  type MountOptions,
} from "../support/harness.ts";

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

/**
 * A horizontal book of two sections, each several pages long.
 *
 * Hand-written rather than a committed fixture: what these tests need is the plainest possible
 * book that has a page before and a page after wherever the reader stands, and every ailment
 * fixture is a book with something wrong with it.
 */
async function mountPlainBook(page: Page, options: MountOptions = {}): Promise<void> {
  await page.evaluate((mountOptions) => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, index) => `<p>Paragraph ${index} of a perfectly ordinary book, long enough to be worth
        breaking into lines and then into pages.</p>`,
    ).join("");
    const section = (title: string) =>
      `<?xml version="1.0" encoding="utf-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
       <body><h1>${title}</h1>${paragraphs}</body></html>`;

    return window.frond.mountInline([section("One"), section("Two")], mountOptions);
  }, options as MountOptions);
}

test.describe("the pages either side stay mounted", () => {
  test("three frames, and only the page is painted", async ({ page }) => {
    await mountPlainBook(page);
    await peeksReady(page);
    // Off the first page, so that there is a page on both sides to have a frame for.
    await page.evaluate(() => frond.next());
    await peeksReady(page, 2);

    const frames = await page.evaluate(() => frond.frames());
    expect(frames.filter((frame) => frame.page)).toHaveLength(1);
    expect(frames.filter((frame) => frame.visible)).toHaveLength(1);
    expect(frames.find((frame) => frame.page)?.visible).toBe(true);
  });

  test("the first page of the book has nothing behind it, so there are only two", async ({
    page,
  }) => {
    // The peek that would show the previous page is not mounted at all — there is no previous
    // page. Mounting one anyway would be a document's worth of work for a page that does not
    // exist.
    await mountPlainBook(page);
    await peeksReady(page);
    // Two frames, not three: the page, and the one after it. The one before does not exist, and
    // mounting a document for it would be a section's worth of work for a page that is not there.

    const atStart = await page.evaluate(() => frond.beginTurn("prev", "left"));
    expect(atStart?.atBoundary).toBe(true);
    expect(atStart?.hasPreview).toBe(false);
    await page.evaluate(() => frond.cancelTurn());
  });

  test("a steady run of turns costs one mount, not one per turn", async ({ page }) => {
    // Mounting a document takes far longer than turning a page, so a reader turning steadily
    // gets several turns in before the first peek has landed. Every one of those turns used
    // to start a mount of its own, and each mount built a whole document into the container
    // before the staleness check could discard it: 100 turns measured 201 frames in the
    // container at once. That is a memory spike on a phone, ~200 documents' worth of parsing
    // and layout thrown away, and — because tearing that many frames down is slow in
    // Chromium — three seconds added to the end of anything that turned a lot of pages.
    //
    // Turned from inside the page deliberately. Driven a turn at a time from here, each
    // round trip gives the mount enough of a gap to land, which is exactly the timing that
    // kept this from being noticed.
    await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });
    await peeksReady(page);

    await page.evaluate(() => frond.walkNext(30));

    // Four is the whole container, not a tolerance. Three are the steady state — the page and
    // the two either side — and the fourth is a frame being mounted, which is in the container
    // from the moment the mount starts. **In this book that fourth can only be a peek's own
    // mount**, not the reader's: nothing here crosses a section, so no turn mounts a page. The
    // walk starts on the first page of the book, where there is nothing behind the reader, so
    // the page they leave behind on the first turn is a peek that has to be built.
    //
    // Each peek side is held to one frame either way: a mount in flight there means the peek
    // that stood there has already gone, and while it is in flight the side cannot start
    // another (`refreshNeighbours`).
    const frames = await page.evaluate(() => frond.frames().length);
    expect(frames).toBeLessThanOrEqual(4);
  });

  test("turning back and forth over a section edge costs one mount a side, not one per turn", async ({
    page,
  }) => {
    // The count above never crosses a section: it runs inside one, where the section a peek
    // wants never changes, so nothing there ever asks for a second mount and the ceiling is
    // never tested. This is the path that tests it. Standing on the first page of the second
    // section, the page **behind** the reader is in the section before; one turn forward and
    // it is in this one. So every turn here changes which section that side wants — and unlike
    // reading straight through, neither turn waits for a document, because both pages are
    // already in the section on screen.
    //
    // Before the mounts a side were made to take turns, that was unbounded: each turn started
    // a mount for the section the side now wanted and left the previous one running, and a
    // mount is a frame in the container from the moment it starts (`SectionView.mount` appends
    // the frame and then waits for it to load). Measured on this book, 15 turns back and forth
    // put **33 frames** in the container at once.
    //
    // The count is taken a turn at a time rather than once at the end, because by then the
    // mounts that were in flight during the run have landed and been discarded.
    //
    // **Three, not four**, and this is the one place the tighter number can be asked for: both
    // pages are inside the section on screen, so `loadSection` never has a page mount in flight
    // to allow for. What is left is the reader's page and one frame a side.
    //
    // ⚠️ This drives the turns through `next()`/`previous()`, which is only one of the two ways
    // a reader crosses a section edge. The other is dragging the page across and letting go:
    // that takes the peek as the new page and calls `refreshNeighbours` straight away, off the
    // queue and without waiting for any document, which is the faster of the two and the one a
    // phone actually does. It goes through the same guard, and no test covers it.
    await mountPlainBook(page);
    await peeksReady(page);
    await page.evaluate(() => frond.goToSection(1));

    const peak = await page.evaluate(async () => {
      let highest = 0;
      for (let turn = 0; turn < 15; turn += 1) {
        await frond.next();
        await frond.previous();
        highest = Math.max(highest, frond.frames().length);
      }
      return highest;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });
});

test.describe("dragging a page across", () => {
  test("the two pages move together, one page apart", async ({ page }) => {
    await mountPlainBook(page);
    await peeksReady(page);

    const turn = await page.evaluate(() => frond.beginTurn("next", "right"));
    expect(turn?.hasPreview).toBe(true);
    // The container is 800 wide (the harness shell), and a turn crosses the container rather
    // than the in-document stride — the reader is watching two documents move past a window.
    expect(turn?.extent).toBe(800);

    await page.evaluate(() => frond.moveTurn(200));
    const frames = await page.evaluate(() => frond.frames());
    const painted = frames.filter((frame) => frame.visible);

    // Both on screen, and exactly one extent apart: no overlap, no gap that grows.
    expect(painted).toHaveLength(2);
    const [current] = painted.filter((frame) => frame.page);
    const [incoming] = painted.filter((frame) => !frame.page);
    expect(current?.offset).toBe(-200);
    expect(incoming?.offset).toBe(600);

    await page.evaluate(() => frond.cancelTurn());
  });

  test("cancelling puts everything back, and the reader has not moved", async ({ page }) => {
    await mountPlainBook(page);
    await peeksReady(page);
    const before = await page.evaluate(() => frond.snapshot());

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(400));
    const after = await page.evaluate(() => frond.cancelTurn());

    expect(after.page).toBe(before.page);
    expect(after.cfi).toBe(before.cfi);
    const frames = await page.evaluate(() => frond.frames());
    expect(frames.every((frame) => frame.offset === 0)).toBe(true);
    expect(frames.filter((frame) => frame.visible)).toHaveLength(1);
  });

  test("committing lands on the next page, with the frames changing roles", async ({ page }) => {
    await mountPlainBook(page);
    await peeksReady(page);
    const before = await page.evaluate(() => frond.snapshot());

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(800));
    const after = await page.evaluate(() => frond.commitTurn());

    expect(after.page).toBe(before.page + 1);
    // The same page a plain `next()` would have reached: a dragged turn is not a second way of
    // paginating, it is the same turn with the reader's finger on it.
    const frames = await page.evaluate(() => frond.frames());
    expect(frames.filter((frame) => frame.page)).toHaveLength(1);
    expect(frames.filter((frame) => frame.visible)).toHaveLength(1);
    expect(frames.every((frame) => frame.offset === 0)).toBe(true);
  });

  test("and the page behind is ready again straight away", async ({ page }) => {
    // The frame that just left the screen becomes the peek on the other side, so turning back
    // needs no mount. Without this, every other drag would be the one with no preview.
    await mountPlainBook(page);
    await peeksReady(page);

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(800));
    await page.evaluate(() => frond.commitTurn());

    const back = await page.evaluate(() => frond.beginTurn("prev", "left"));
    expect(back?.atBoundary).toBe(false);
    expect(back?.hasPreview).toBe(true);
    await page.evaluate(() => frond.cancelTurn());
  });

  test("and the focus goes with it, so the keyboard still reaches the reader's page", async ({
    page,
  }) => {
    // A frame keeps its focus when it stops being the page, and a reader who has touched the
    // book at all has put the focus in one. Left where it was, every key after the first turn
    // is delivered to the frame behind them — and the outer document hears nothing while focus
    // is inside a frame, so nobody answers the press at all.
    await mountPlainBook(page);
    await peeksReady(page);
    // The precondition is the click's own doing rather than frond's, and firefox sometimes
    // takes the click without moving the focus — so `clickIntoPage` clicks again until it
    // does (#34). The assertion at the end is a bare one: that half is frond's, and it
    // happens inside `commitTurn()`.
    await clickIntoPage(page);

    const inThePage = () =>
      page.evaluate(() => document.activeElement?.hasAttribute("data-frond-page") === true);

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(800));
    await page.evaluate(() => frond.commitTurn());

    expect(await inThePage()).toBe(true);
  });
});

test.describe("a turn is not the only thing that can move the reader", () => {
  test("a page turn from elsewhere abandons it", async ({ page }) => {
    // A key press, a jump from the table of contents. The consumer may be animating the turn
    // out; `live` is how it finds out that the page under it has already gone.
    await mountPlainBook(page);
    await peeksReady(page);

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(300));
    await page.evaluate(() => frond.next());

    const frames = await page.evaluate(() => frond.frames());
    expect(frames.every((frame) => frame.offset === 0)).toBe(true);
    expect(frames.filter((frame) => frame.visible)).toHaveLength(1);
  });
});

test.describe("a vertical book", () => {
  test("moves sideways all the same, though it paginates downwards", async ({ page }) => {
    // The whole reason a turn cannot be done by scrolling: a 直排 book's next page is *below*
    // in its own document (`geometry.ts`), and the reader must be shown it arriving from the
    // side. Two documents in two frames is what makes the two independent.
    await mountFixture(page, "vertical-japanese");
    await peeksReady(page);

    const turn = await page.evaluate(() => frond.beginTurn("next", "left"));
    expect(turn?.hasPreview).toBe(true);

    await page.evaluate(() => frond.moveTurn(300));
    const frames = await page.evaluate(() => frond.frames());
    const painted = frames.filter((frame) => frame.visible);
    expect(painted).toHaveLength(2);
    // Along x, both of them, in a book whose pages advance along y.
    expect(painted.filter((frame) => frame.page)[0]?.offset).toBe(300);
    expect(painted.filter((frame) => !frame.page)[0]?.offset).toBe(-500);

    await page.evaluate(() => frond.cancelTurn());
  });
});

/**
 * `setNativeSelection` against the turn lifecycle.
 *
 * The consumer may change its mind about the browser's selection while a book is open (the app's
 * `notePointer`, ADR-0002 leaves the deciding to it), and a turn is the moment that answer can go
 * missing: three documents are mounted, only one is on screen, and the one that becomes the page
 * next is not rebuilt on its way in. So the question these ask is not "did the call work" but
 * "which frames did it reach" — and the frame it must reach is the one nobody is looking at.
 */
test.describe("changing whose selection it is, on a book that is already open", () => {
  test("a turn started before the change does not carry the old answer onto the next page", async ({
    page,
  }) => {
    // The reported defect, in the order it happens: a reader on a touchscreen desktop starts a
    // turn, moves the mouse while it is still animating, and lands on a page that is still
    // unselectable — with the long press switched off by then, leaving no way to select at all.
    await mountPlainBook(page, { nativeSelection: false });
    await peeksReady(page);

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(400));
    await page.evaluate(() => frond.setNativeSelection(true));

    // The page under the finger is deliberately left as the turn set it: a turn suppresses
    // selection for as long as the drag lasts, whatever the consumer has just said, and half a
    // dragged page is not where a selection should start growing.
    const during = await page.evaluate(() => frond.frames());
    expect(during.find((frame) => frame.page)?.selectable).toBe(false);
    expect(during.filter((frame) => frame.peek).every((frame) => frame.selectable)).toBe(true);

    await page.evaluate(() => frond.moveTurn(800));
    await page.evaluate(() => frond.commitTurn());
    // Landing starts a mount for the side that has no peek any more, and a frame whose document
    // has not arrived is still an `about:blank` — which answers "selectable" for a reason that
    // has nothing to do with the question. Both peeks in place is the state worth asserting on.
    await peeksReady(page, 2);

    // Every frame, not only the one on screen. The peek that just became the page was never
    // mounted again, and the two now either side of the reader are the next turns' pages.
    const after = await page.evaluate(() => frond.frames());
    expect(after.find((frame) => frame.page)?.selectable).toBe(true);
    expect(after.every((frame) => frame.selectable)).toBe(true);
  });

  test("and the same is true turning it off, which is the direction that must not leak", async ({
    page,
  }) => {
    // The mirror, and the more expensive one to get wrong: a page that arrives selectable is a
    // page where the next long press is the browser's own gesture — the iOS magnifier ADR-0036
    // exists to remove — over a passage the app is drawing its own selection on.
    await mountPlainBook(page);
    await peeksReady(page);

    await page.evaluate(() => frond.beginTurn("next", "right"));
    await page.evaluate(() => frond.moveTurn(400));
    await page.evaluate(() => frond.setNativeSelection(false));
    await page.evaluate(() => frond.moveTurn(800));
    await page.evaluate(() => frond.commitTurn());
    await peeksReady(page, 2);

    // Including the peek mounted *after* the change, which reads the new answer where it is
    // built rather than being told separately.
    const after = await page.evaluate(() => frond.frames());
    expect(after.find((frame) => frame.page)?.selectable).toBe(false);
    expect(after.some((frame) => frame.selectable)).toBe(false);
  });
});
