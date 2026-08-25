// A turn's pacing rather than its outcome: frame intervals and repaint counts, both of them
// properties of a real compositor with no form anywhere below the browser. drag.spec.ts and
// paging.spec.ts pin what the two kinds of turn do; this is the baseline for how they feel, and
// the numbers it prints on every run are the thing to compare a change against.
import { expect, test } from "../support/fixtures.js";
import { BOOKS, openBook } from "../support/library.js";
import {
  countCommandPaints,
  countTurnPaints,
  describePacing,
  measureCommandPacing,
  measureTurnPacing,
} from "../support/pacing.js";

/**
 * How smoothly a page turn runs, as frame intervals rather than as a frame rate.
 *
 * ## What this is for
 *
 * A baseline. `drag.spec.ts` pins what a drag *does*; this pins how it *feels*, which is the
 * half that can rot without a single assertion going red. The numbers it prints are the ones to
 * compare a change against — run it before touching the turn, run it after, and read the two.
 *
 * ## Both ways of turning a page are here
 *
 * A drag and a command turn (an arrow key, a page button) are two different animations, and for
 * a while only the first of them was measured. The drag eases for `TURN_SETTLE_MS` out of the
 * speed the finger left it at, across whatever distance is left; the command turn eases for
 * `TURN_COMMAND_MS` from a standstill, across the whole page, and nothing is pushing it
 * (docs/specs/desktop-page-turn/spec.md). Neither number predicts the other.
 *
 * Each is measured in two halves — see the header of `support/pacing.ts` for why, and for what
 * each half is called.
 *
 * ## Why the thresholds are so loose
 *
 * They are a floor, not a target. When the drag baseline was taken the settle segment dropped
 * between 1% and 7% of its intervals, across both engines and across running alone and running
 * inside the full parallel suite; the ceilings below sit around four times above the worst of
 * those.
 *
 * That gap is deliberate. This suite runs `fullyParallel`, so several browsers are painting at
 * once on the same cores, and a threshold set to what a quiet machine produces would go red
 * because CI was busy — a benchmark that cries wolf gets deleted. What these catch is the kind
 * of regression that is visible to the eye: a turn that has started laying out per frame, or
 * synchronously reading geometry it used to have cached.
 *
 * **For a number rather than a light**, run this alone, where nothing else is competing:
 *
 *     npm run test:container -- --project=chromium --workers=1 turn-pacing
 *
 * ## Why there is a paint count as well
 *
 * **Frame intervals miss a whole class of problem, and it was the class this reader had.** A
 * machine fast enough to repaint a full screen inside 16.7ms drops no frames while doing it, so
 * the pacing tests read perfectly clean over a drag that is repainting every pixel of the page
 * on every `pointermove`. The reader on a phone feels that; this suite could not see it.
 *
 * So the paint tests count the repaints instead of timing them. A count is the same number on a
 * fast machine and a slow one, which is what makes it worth a threshold at all.
 *
 * ## What none of them can see
 *
 * The frames counted here are `requestAnimationFrame` callbacks, which is when the browser
 * *began* a frame — not when the compositor put it on a screen. On this headless machine the two
 * are close enough for the callback cadence to be vsync-paced (it measures the idle cadence
 * first and reports it), but a turn that is smooth here can still stutter on a phone, where the
 * compositor is the part under pressure. That measurement is a real device's to give
 * (docs/specs/swipe-to-turn/measurements.md §3).
 */

test.use({ hasTouch: true });

// Seven turns and their tails for the drag, thirteen for the arrow key, plus the warm-up and the
// idle cadence ahead of each.
test.setTimeout(120_000);

/**
 * An interval this many frames long reads as a jump rather than as a dropped frame.
 *
 * A page that hitches for a fifth of a second during a 180ms settle has not eased anywhere —
 * it has jumped. What is held under this ceiling is each segment's p95.
 *
 * ## Read off the p95, not off the single worst interval
 *
 * It used to be the worst interval in the whole run, and **that number belongs to the machine
 * rather than to the app** (issue #61). Measured on a four-core container shaped like CI, with
 * four browsers painting at once: the worst interval landed between 267ms and 1067ms in 13 runs
 * out of 20, on a random turn each time and in either half — while the same measurement on a
 * quiet machine came back with a worst interval of 17ms, an order of magnitude *inside* this
 * ceiling. A max over four hundred intervals asks "did the scheduler ever take a slice from us",
 * and on a `fullyParallel` suite the answer is yes.
 *
 * The p95 asks the question this ceiling was written for instead: **does a turn jump every
 * time.** A segment is only ten to twenty intervals long, so a hitch that happens once per turn
 * — a geometry read that stopped being cached, a layout moved onto the turn's critical path — is
 * five to ten percent of the samples and goes red here. A single stolen slice is a quarter of one
 * percent and does not. The other failure shape, a turn that has started laying out per frame,
 * never showed up in this ceiling anyway: it makes every frame a little late rather than one
 * frame enormously late, and the drop ceilings below are what catch it.
 */
const JUMP_FRAMES = 14;

/**
 * How much of a segment may drop a frame before this counts as a stutter rather than noise.
 *
 * They differ because the segments do, and they pair up: the two halves where something is
 * *moving* were clean at the baseline (0 dropped intervals, drag and arrow key alike), so
 * anything much above nothing there is new. The two *tails* already drop a few when the machine
 * is busy, and their ceilings sit above the worst of those rather than at it.
 *
 * **The arrow key's two are the drag's numbers, not its own.** Its measured worst across the
 * three engines was 0 dropped intervals in the slide and 4 of 299 in the reshuffle, which would
 * justify something far tighter — but a threshold set near a quiet machine's result is the kind
 * that goes red because CI was busy, and this suite runs `fullyParallel`. Taking the drag's
 * already-loose pair keeps one story for both paths rather than inventing a second.
 */
const FOLLOW_DROP_CEILING = 0.15;
const SLIDE_DROP_CEILING = 0.15;
const SETTLE_DROP_CEILING = 0.3;
const RESHUFFLE_DROP_CEILING = 0.3;

test("a page turn keeps its frames", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);

  const pacing = await measureTurnPacing(page);

  // The numbers are the point of this test, so they go where a reader of the report will see
  // them whether it passed or failed.
  const report = describePacing(pacing);
  test.info().annotations.push({ type: "pacing", description: report });
  console.log(`\nturn pacing\n${report}\n`);

  // A sanity check on the measurement itself before anything is concluded from it: too few
  // samples and the percentiles below mean nothing.
  expect(pacing.follow.intervals, "no frames sampled while the finger was down").toBeGreaterThan(
    50,
  );
  expect(pacing.settle.intervals, "no frames sampled after the release").toBeGreaterThan(50);

  // The page under the finger. This is the segment that was clean when the baseline was taken,
  // and the one a reader notices first, because their thumb is the reference.
  expect(pacing.follow.droppedShare).toBeLessThanOrEqual(FOLLOW_DROP_CEILING);

  // And the tail: the easing, the commit, and frond re-pointing the frames either side.
  expect(pacing.settle.droppedShare).toBeLessThanOrEqual(SETTLE_DROP_CEILING);

  // And no half of the turn may be spending a twentieth of its frames long enough to read as a
  // jump. The worst single interval is still printed above; it is the report's, not an
  // assertion's — see `JUMP_FRAMES`.
  const jumpy = Math.max(pacing.follow.p95, pacing.settle.p95);
  expect(jumpy).toBeLessThanOrEqual(pacing.frame * JUMP_FRAMES);
});

test("a turn nobody dragged keeps its frames too", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);

  const pacing = await measureCommandPacing(page);

  const report = describePacing(pacing);
  test.info().annotations.push({ type: "pacing", description: report });
  console.log(`\ncommand turn pacing\n${report}\n`);

  // The slide is short — `TURN_COMMAND_MS` is about thirteen frames at 60Hz — which is why
  // twelve turns are measured rather than the drag's six.
  expect(pacing.slide.intervals, "no frames sampled during the slide").toBeGreaterThan(50);
  expect(pacing.reshuffle.intervals, "no frames sampled after the slide").toBeGreaterThan(50);

  // The easing itself. Nothing is pushing this one, so a dropped frame here is the app's own.
  expect(pacing.slide.droppedShare).toBeLessThanOrEqual(SLIDE_DROP_CEILING);

  // And the commit behind it.
  expect(pacing.reshuffle.droppedShare).toBeLessThanOrEqual(RESHUFFLE_DROP_CEILING);

  const jumpy = Math.max(pacing.slide.p95, pacing.reshuffle.p95);
  expect(jumpy).toBeLessThanOrEqual(pacing.frame * JUMP_FRAMES);
});

/**
 * How many repaints one drag is allowed to cost.
 *
 * The frames move by `transform` and sit on compositor layers of their own
 * (`section-view.ts`'s `will-change`), so a turn should cost a handful of paints and not one per
 * `pointermove`. Measured at **4 per turn with the layers and 22 without them** — the ceiling
 * sits between the two and nearer the good number, because the failure it catches is not a few
 * percent worse but five times worse.
 *
 * **Both ends were re-measured when the count started excluding the warm-up turn and the gaps
 * between turns** (docs/specs/desktop-page-turn/measurements.md §4). The pair this replaces is
 * 9.1 and 42.6 (docs/specs/swipe-to-turn/measurements.md), which counted every repaint in the
 * run and divided by all seven turns including the warm-up; a ceiling calibrated for that
 * quantity would sit in the wrong place for this one.
 *
 * It stays a ceiling on the **whole** turn even though the count is now reported in halves. The
 * halves are what say *where* a regression is; this is the number with a measured bad end to sit
 * below, and splitting it would throw that away.
 */
const PAINTS_PER_TURN_CEILING = 10;

/**
 * And how many a turn nobody dragged is allowed to cost.
 *
 * **This one has no measured bad end, and that is worth knowing before trusting it.** Taking the
 * compositor layers away — the regression that takes a drag from 4 repaints to 22 — leaves a
 * command turn at the same 2 it measures with them. Whatever makes a drag repaint per frame
 * without those layers, an arrow key does not do it.
 *
 * So the number below is not half way between a good measurement and a bad one. It comes from
 * the arithmetic of the failure instead: the slide is `TURN_COMMAND_MS`, about thirteen frames
 * at 60Hz, so a turn that had started repainting the page once per frame could not come in under
 * thirteen. Eight sits above the measured 2 with room for noise and below anything per-frame
 * could produce.
 */
const COMMAND_PAINTS_PER_TURN_CEILING = 8;

test("and it does not repaint the whole page to move it", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the paint trace is Chromium's only");

  await openBook(page, BOOKS.horizontal);

  const paints = await countTurnPaints(page, context);
  const report = `${paints.total} per turn (follow ${paints.follow}, settle ${paints.settle})`;
  test.info().annotations.push({ type: "paints", description: report });
  console.log(`\nturn paints: ${report}\n`);

  expect(paints.total).toBeLessThanOrEqual(PAINTS_PER_TURN_CEILING);
});

test("nor to move it without a finger", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "the paint trace is Chromium's only");

  await openBook(page, BOOKS.horizontal);

  const paints = await countCommandPaints(page, context);
  const report = `${paints.total} per turn (slide ${paints.slide}, reshuffle ${paints.reshuffle})`;
  test.info().annotations.push({ type: "paints", description: report });
  console.log(`\ncommand turn paints: ${report}\n`);

  expect(paints.total).toBeLessThanOrEqual(COMMAND_PAINTS_PER_TURN_CEILING);
});
