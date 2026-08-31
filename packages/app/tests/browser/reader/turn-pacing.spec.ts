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
 * ## Why nothing here asserts on a dropped-frame share any more
 *
 * ⚠️ **Do not add one back.** A dropped-frame share measures how many frames the machine felt
 * like handing out, not what the app did with them: the same code that drops 0 of 159 intervals
 * running alone drops up to 100% of them on a machine that is oversubscribed, and a turn that
 * had started laying out per frame looks exactly the same (issue #71). There is no absolute
 * ceiling that catches the regression and tolerates a saturated machine, so the share is
 * **reported and not asserted on**.
 *
 * ### What that costs, stated exactly
 *
 * The regression the share stood in for is the compositor layers going away, which takes a drag
 * from 12 repaints to 44. That one is still guarded — but by **one test on one engine**: the drag
 * paint count below, Chromium only, because the trace it reads has no equivalent in the other
 * two. So on firefox and webkit this file is now down to the jump counts and the sampler floor.
 *
 * **A command turn is guarded the same way, and on the same one engine**: taking the layers away
 * puts an arrow-key turn at 22 repaints against the 11 it measures with them, so
 * `COMMAND_PAINTS_PER_TURN_CEILING` brackets a measured pair like the drag's does. It used to
 * read as unguarded, on a measurement that had the two ends equal — that count was wrong, and
 * docs/specs/desktop-page-turn/measurements.md §5 is where it was put right.
 *
 * That is the accepted cost of issue #71, not an oversight — a benchmark that goes red because
 * the machine was busy gets muted and then deleted, and a muted one guards nothing either.
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
 * ## Why what is left is a count and not a threshold
 *
 * This suite runs `fullyParallel`, so several browsers are painting at once on the same cores,
 * and any threshold read against a share of the samples is really read against the scheduler.
 * The two things asserted on here are counted instead: how many intervals were long enough to
 * read as a *jump* rather than as a dropped frame, compared against the number of turns — a turn
 * that hitches every single time is the regression the eye sees — and how many times the browser
 * repainted per turn.
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

test("a page turn eases rather than jumping", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);

  const pacing = await measureTurnPacing(page);

  // The numbers are the point of this test, so they go where a reader of the report will see
  // them whether it passed or failed.
  const report = describePacing(pacing);
  test.info().annotations.push({ type: "pacing", description: report });
  console.log(`\nturn pacing\n${report}\n`);

  // A sanity check on the measurement itself before anything is concluded from it. **It is about
  // the sampler, not about the app**: a segment holds every turn's intervals end to end, so a
  // total says nothing about whether each individual turn produced frames — five silent turns
  // and one noisy one clear this as easily as six ordinary ones. What it does catch is a run
  // that sampled little or nothing, which would otherwise report no jumps at all and read as the
  // best possible turn.
  //
  // **One interval per turn, not a fixed count.** A fixed floor is the same mistake as the
  // dropped-frame ceiling above, one level down: it goes red when the machine hands out fewer
  // frames, which is a fact about the machine. The floor this replaces was 50, against a
  // measured 138 here — so the frame interval only had to stretch to about 2.2x before the run
  // failed as "too few frames sampled", and issue #71 measured intervals stretching far further
  // than that. Against turns, the same run has to lose 95% of its frames before it trips.
  //
  // Measured for headroom: 138 and 136 at the shape CI runs, and the worst real run seen while
  // making this change was webkit's settle at 84 over six turns, still fourteen times the floor.
  expect(
    pacing.follow.intervals,
    "too few frames sampled while the finger was down",
  ).toBeGreaterThan(pacing.turns);
  expect(pacing.settle.intervals, "too few frames sampled after the release").toBeGreaterThan(
    pacing.turns,
  );

  // A turn may not jump *every time*: fewer intervals long enough to read as a jump than there
  // were turns. One stolen slice out of six turns passes, six of six does not, and the number of
  // samples the machine handed out does not enter into it — see `FramePacing.jumps` for why
  // neither the worst interval nor a percentile can say this.
  //
  // The first of the two is the page under the finger, which is the one a reader notices first,
  // because their thumb is the reference; the second is the tail — the easing, the commit, and
  // frond re-pointing the frames either side.
  expect(pacing.follow.jumps, "the page jumped under the finger on every turn").toBeLessThan(
    pacing.turns,
  );
  expect(pacing.settle.jumps, "the tail jumped on every turn").toBeLessThan(pacing.turns);
});

test("a turn nobody dragged eases rather than jumping too", async ({ page }) => {
  await openBook(page, BOOKS.horizontal);

  const pacing = await measureCommandPacing(page);

  const report = describePacing(pacing);
  test.info().annotations.push({ type: "pacing", description: report });
  console.log(`\ncommand turn pacing\n${report}\n`);

  // The slide is short — `TURN_COMMAND_MS` is about thirteen frames at 60Hz — which is why
  // twelve turns are measured rather than the drag's six. Same floor, same reason as above, and
  // it scales with the turn count on its own because that is what it is written against.
  expect(pacing.slide.intervals, "too few frames sampled during the slide").toBeGreaterThan(
    pacing.turns,
  );
  expect(pacing.reshuffle.intervals, "too few frames sampled after the slide").toBeGreaterThan(
    pacing.turns,
  );

  // The easing itself, and the commit behind it. Same shape as the drag's pair above — but note
  // that for a command turn these two are the *whole* of what is left. The drag has a paint
  // count with a measured bad end behind it; this path does not, because taking the compositor
  // layers away does not change an arrow-key turn's repaints at all
  // (`COMMAND_PAINTS_PER_TURN_CEILING`). Below a jump, a command turn's smoothness is unwatched.
  expect(pacing.slide.jumps, "the slide jumped on every turn").toBeLessThan(pacing.turns);
  expect(pacing.reshuffle.jumps, "the commit jumped on every turn").toBeLessThan(pacing.turns);
});

/**
 * How many repaints one drag is allowed to cost.
 *
 * The frames move by `transform` and sit on compositor layers of their own
 * (`section-view.ts`'s `will-change`), so a turn should cost a handful of paints and not one per
 * `pointermove`. Measured at **12 per turn with the layers and 44 without them** — the ceiling
 * sits between the two and nearer the good number, because the failure it catches is not a few
 * percent worse but nearly four times worse.
 *
 * **Both ends were re-measured when the counter stopped taking React's marks as segment
 * boundaries** (`support/pacing.ts`, and docs/specs/desktop-page-turn/measurements.md §5). The
 * pair this replaces is 4 and 22, and that 4 was not a measurement of anything: in development
 * React writes its own `console.timeStamp` marks onto the same trace stream, so the repaints
 * while the finger was down were being tallied under React's labels rather than this suite's,
 * and a drag read as costing 0 of them. The suite ran against the dev server, so that is the
 * only shape it ever saw.
 *
 * It stays a ceiling on the **whole** turn even though the count is now reported in halves. The
 * halves are what say *where* a regression is; this is the number with a measured bad end to sit
 * below, and splitting it would throw that away.
 */
const PAINTS_PER_TURN_CEILING = 20;

/**
 * And how many a turn nobody dragged is allowed to cost.
 *
 * **This one has a measured bad end now, where it used to have none.** Taking the compositor
 * layers away puts a command turn at **22 against the 11 it measures with them**, almost all of
 * the difference in the slide — 17 repaints where there are 6. The note this replaces said the
 * two were the same, and reasoned the ceiling out of arithmetic instead; that reading came from
 * the same broken segmentation as the drag's, which had the slide at 0.
 *
 * So this is now the same kind of number as the one above: between a measured good end and a
 * measured bad one, nearer the good. The two ends are only twice apart rather than four times,
 * which is why it sits closer to the middle than the drag's does.
 */
const COMMAND_PAINTS_PER_TURN_CEILING = 15;

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
