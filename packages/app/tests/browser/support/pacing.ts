import type { BrowserContext, Page } from "@playwright/test";
import { TURN_COMMAND_MS } from "../../../src/lib/turn.js";

/**
 * How evenly the frames came out while a page was being turned.
 *
 * The question a reader asks is "did it stutter", and the number that answers it is not an
 * average frame rate. An average hides the one 66ms frame that the eye actually sees among the
 * sixty good ones around it, and an average is also what makes a benchmark say "59.2 fps" for
 * both a smooth turn and a visibly hitching one. So what is collected here is the **interval
 * between frames**, and what is reported is the tail of that distribution.
 *
 * ## Every turn is measured in two halves
 *
 * Both ways of turning a page are two things joined at a handover, and the two halves fail for
 * different reasons and are not fixed by the same change. Reporting one number over both would
 * let an improvement in one hide a regression in the other.
 *
 * A **drag** hands over when the finger lifts:
 *
 * - **follow** — the page under the finger, driven by `pointermove`. A dropped frame here is a
 *   page that lags behind the thumb, and the reader feels it as the book being heavy.
 * - **settle** — the tail after the release: the app's own `requestAnimationFrame` easing
 *   (`TURN_SETTLE_MS`), then the commit, then frond re-pointing the neighbouring frames.
 *
 * A **command turn** — an arrow key or a page button — hands over when its animation runs out:
 *
 * - **slide** — the `TURN_COMMAND_MS` easing, from a standstill across the whole page. Nobody is
 *   pushing this one, so a dropped frame here is the app's own alone.
 * - **reshuffle** — the commit and frond re-pointing the frames either side, which is the same
 *   work the back half of a drag's settle does.
 *
 * ## What a frame is here
 *
 * Not 16.7ms. The screen this runs on is measured first, while nothing is moving, and the
 * cadence that comes back is what "one frame" means for the rest of the run — so the same
 * thresholds still mean the same thing if this ever runs somewhere that paints at 120Hz.
 */
export interface FramePacing {
  /** How many intervals were sampled. Two frames make one interval. */
  readonly intervals: number;
  /** The median interval, in ms. This is the "when it is going well" number. */
  readonly p50: number;
  /**
   * The 95th percentile, in ms — where stutter shows up first when reading the report.
   * **Reported, not asserted on**, and for the opposite reason to `longest`: a segment holds
   * every measured turn's intervals end to end, so the regression this suite exists to catch —
   * one hitch per turn — is a few percent of them and passes any percentile. See `jumps`.
   */
  readonly p95: number;
  /**
   * The single worst interval, in ms. **Reported, not asserted on** — on a machine running
   * several browsers at once this is the scheduler's number rather than the app's, which is what
   * issue #61 was. `jumps` below is what took its place.
   */
  readonly longest: number;
  /** How many intervals ran longer than one and a half frames — i.e. dropped at least one. */
  readonly dropped: number;
  /**
   * Those as a share of all intervals, 0 to 1. **Reported, not asserted on** — it says how many
   * frames the machine felt like handing out, and the same code that drops none running alone
   * drops all of them on an oversubscribed one, which is also what a turn laying out per frame
   * looks like (issue #71). The repaint counts below are what guard that regression instead.
   */
  readonly droppedShare: number;
  /**
   * How many intervals were long enough to read as a jump rather than as a dropped frame — see
   * `JUMP_FACTOR`.
   *
   * **A count, and it is compared against the number of turns rather than against the number of
   * samples.** Both other shapes have been tried and neither works. The worst interval goes red
   * when the scheduler takes one slice from a browser sharing four cores with three others, which
   * is the flake issue #61 was. A share of the samples cannot go red at all for the regression
   * this is here to catch: a segment holds *every* measured turn's intervals end to end, so a
   * turn that hitches once each time is six long intervals out of the drag's 138 — 4.3%, under
   * any percentile a benchmark would put a ceiling on.
   *
   * **It is harder to trip on a busy machine than a share is, not immune to one.** A machine
   * that stalls for `JUMP_FACTOR` frames — about 233ms at 60Hz — once in every measured turn
   * fails this, and the scheduler can do that. What it cannot do is fail it the way a share
   * fails, where merely painting slower throughout is enough.
   */
  readonly jumps: number;
}

export interface TurnPacing {
  /** What one frame takes on this machine, measured while idle. */
  readonly frame: number;
  /** How many turns the numbers below are made of. The thrown-away warm-up is not counted. */
  readonly turns: number;
  /** The page following the finger. */
  readonly follow: FramePacing;
  /** The tail after the finger lifts: the easing, the commit, and the reshuffle behind it. */
  readonly settle: FramePacing;
}

export interface CommandPacing {
  /** What one frame takes on this machine, measured while idle. */
  readonly frame: number;
  /** How many turns the numbers below are made of. The thrown-away warm-up is not counted. */
  readonly turns: number;
  /** The `TURN_COMMAND_MS` easing, from a standstill. */
  readonly slide: FramePacing;
  /** The commit and frond re-pointing the frames either side. */
  readonly reshuffle: FramePacing;
}

/** The one frame among the three that is the page the reader is reading. */
const PAGE_FRAME = ".viewer-mount iframe[data-frond-page]";

/** An interval longer than this many frames has dropped one. */
const DROP_FACTOR = 1.5;

/**
 * And an interval longer than *this* many frames reads as a jump rather than as a dropped frame.
 *
 * A page that hitches for a fifth of a second during a 180ms settle has not eased anywhere — it
 * has jumped. Fourteen frames is about that, and the number was calibrated when this was a
 * ceiling on the worst interval in the run; what changed in issue #61 is not the number but what
 * is counted with it (`FramePacing.jumps`).
 */
const JUMP_FACTOR = 14;

/**
 * The labels the drivers stamp into the trace, so the repaints can be split the same way the
 * frame intervals are.
 *
 * Each one names the segment that **begins** at that instant. `warmup` covers the whole of the
 * first turn, which is thrown away; `between` covers the gap between one turn and the next, and
 * exists so that those repaints belong to a segment nothing asserts on rather than leaking into
 * the next turn.
 *
 * Prefixed, because anything at all may call `console.timeStamp` and the trace does not say who.
 */
const SEGMENT = {
  warmup: "tidemarks:warmup",
  follow: "tidemarks:follow",
  settle: "tidemarks:settle",
  slide: "tidemarks:slide",
  reshuffle: "tidemarks:reshuffle",
  between: "tidemarks:between",
} as const;

export interface TurnOptions {
  /** How many turns to measure, on top of the one thrown away. */
  readonly turns?: number;
  /** How far each drag travels, in px. Negative is forward in a left-to-right book. */
  readonly dx?: number;
  /** Roughly how long each drag takes. */
  readonly ms?: number;
  /** How many `pointermove`s the drag is made of. */
  readonly steps?: number;
}

export interface CommandOptions {
  /** How many turns to measure, on top of the one thrown away. */
  readonly turns?: number;
  /** Which arrow key. `ArrowRight` is forward in a left-to-right book. */
  readonly key?: "ArrowLeft" | "ArrowRight";
}

/**
 * What one run of a gesture produced: the frame stamps, and where each turn began, handed over
 * and ended.
 *
 * ## What is deliberately not in here: which section the book was in
 *
 * A section boundary is a far more expensive turn than a page within a section, so a run that
 * crossed one would be reporting a mixture — and the only thing guarding against that is a
 * comment saying the sample books have long enough first sections. Making it checkable was
 * tried and abandoned: the page frame's `src` is a blob URL belonging to that frame, not to the
 * section, so it changes as frond rotates its three frames and says nothing about where in the
 * book they point. Nothing else frond puts in the DOM names the section either.
 *
 * Settling it would mean frond saying which section a frame holds, which is exactly the shape
 * of fact CLAUDE.md says belongs on frond's side of the line. Until then it is unverified, and
 * docs/specs/desktop-page-turn/measurements.md says so rather than letting a comment imply it
 * was checked.
 */
interface DrivenTurns {
  readonly idle: number[];
  readonly stamps: number[];
  readonly spans: { from: number; handover: number; to: number }[];
}

/** Long enough to cover the tail: the commit, and frond re-pointing the frames either side. */
const TAIL_MS = 400;

/** A gap between turns, so one turn's tail is not counted as the next one's start. */
const GAP_MS = 250;

/** What one run asks for: which gesture, how many turns, and the shape of each one. */
type Plan =
  | {
      readonly kind: "drag";
      readonly turns: number;
      readonly dx: number;
      readonly ms: number;
      readonly steps: number;
    }
  | { readonly kind: "command"; readonly turns: number; readonly key: string };

/**
 * Runs the book through several page turns, timing every frame each one takes.
 *
 * ## Why the whole run happens inside one `page.evaluate`
 *
 * `dragPage` in `library.ts` already builds a gesture out of dispatched `PointerEvent`s, and
 * this deliberately does not call it in a loop. Each call is a round trip over the CDP socket,
 * and a round trip lands in the middle of the very thing being timed — the frames it costs
 * would be counted against the app. Everything here, the gesture and the sampling both, stays
 * on the page for the duration. The arrow key goes the same way and for the same reason: the
 * Reader listens for `keyup` on `document` and does not ask whether the event is trusted, so a
 * synthetic one takes the path a reader's does.
 *
 * The cost of that choice is that this helper carries its own copy of the pointer-dispatch
 * code. That duplication is the price of the measurement being about the app rather than about
 * the harness.
 *
 * ## Why both gestures are one function with a branch in it
 *
 * Everything around the turn itself is the same either way: the idle cadence, the frame
 * sampler, the warm-up, the tail, the gap. **None of it can be shared from out here** — this
 * callback is serialised into the page, so a helper defined in this module would not exist by
 * the time it ran. One branch inside one function is what keeping that scaffold in a single
 * copy costs, and it is cheaper than the forty lines the two would otherwise repeat.
 *
 * ## The first turn is thrown away
 *
 * The first commit of a session pays for work that happens once — the neighbouring section
 * views laying out for the first time, whatever the engine had not yet compiled. Measured, it
 * is several times the worst of the turns after it, and including it would mean the benchmark
 * mostly reports how long a warm-up took. It carries its own trace label rather than being cut
 * out afterwards, which is what lets the paint counts drop it too.
 *
 * ## Where a turn's two halves are cut
 *
 * A drag's, at the `pointerup`. A command turn's, at the first frame at or after
 * `TURN_COMMAND_MS`, which is the frame the app's own easing finishes on. That mark is stamped
 * from the frame's `requestAnimationFrame` callback, and a frame paints after its callbacks
 * have run — so **that frame's repaint always lands in `reshuffle`**, never in `slide`. One
 * repaint per turn sits on the far side of the line from the frame interval it belongs to.
 * Saying which side it falls on is worth more than pretending the cut is exact.
 */
async function drive(page: Page, plan: Plan): Promise<DrivenTurns> {
  return await page.evaluate(
    async ({ selector, plan, commandMs, tailMs, gapMs, SEGMENT }) => {
      const frameOf = () => document.querySelector(selector) as HTMLIFrameElement | null;

      // Every frame the browser paints from here until the last turn is over, as one stream.
      // Timestamps only: a sampler that did arithmetic per frame would be measuring itself.
      const stamps: number[] = [];
      let sampling = true;
      const tick = (at: number) => {
        stamps.push(at);
        if (sampling) requestAnimationFrame(tick);
      };

      const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

      // What one frame costs on this machine, with nothing moving. Everything below is read
      // against this rather than against an assumed 60Hz.
      requestAnimationFrame(tick);
      await wait(500);
      const idle = stamps.slice();

      const spans: { from: number; handover: number; to: number }[] = [];

      for (let turn = 0; turn <= plan.turns; turn += 1) {
        // The warm-up turn's repaints go to a label nothing asserts on, which is what lets the
        // paint count exclude it. The frame intervals throw it away by dropping the first span.
        const warm = turn === 0;
        const opens = warm ? SEGMENT.warmup : plan.kind === "drag" ? SEGMENT.follow : SEGMENT.slide;
        const closes = plan.kind === "drag" ? SEGMENT.settle : SEGMENT.reshuffle;

        let from: number;
        let handover: number;

        if (plan.kind === "drag") {
          const frame = frameOf();
          const view = frame?.contentWindow;
          const target = frame?.contentDocument?.body;
          if (!frame || !view || !target) throw new Error("no page frame to drag");

          const box = frame.getBoundingClientRect();
          const start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

          // The same coordinate compensation `dragPage` makes: the frame moves while the finger
          // is on it, and a `clientX` inside a frame that has moved counts from its new corner.
          // Passing raw travel would make the drag look stationary to frond.
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
                clientX: start.x + travel - now.left,
                clientY: start.y - now.top,
              }),
            );
          };

          // Always forward, never back and forth. Turning back lands on the page just left,
          // which is already laid out and already the peek on that side — the cheapest turn
          // there is, and not the one a reader spends their evening doing.
          from = performance.now();
          console.timeStamp(opens);
          send("pointerdown", 0);
          for (let step = 1; step <= plan.steps; step += 1) {
            await nextFrame();
            await wait(plan.ms / plan.steps);
            send("pointermove", (plan.dx * step) / plan.steps);
          }

          handover = performance.now();
          if (!warm) console.timeStamp(closes);
          send("pointerup", plan.dx);
        } else {
          if (!frameOf()) throw new Error("no page frame to turn");

          from = performance.now();
          console.timeStamp(opens);
          document.dispatchEvent(new KeyboardEvent("keyup", { key: plan.key, bubbles: true }));

          // Spin on frames rather than on a timer, so the cut falls on a frame boundary — the
          // same boundary the sampled stamps are on.
          handover = from;
          while (handover < from + commandMs) handover = await nextFrame();
          if (!warm) console.timeStamp(closes);
        }

        await wait(tailMs);
        const to = performance.now();
        console.timeStamp(SEGMENT.between);
        spans.push({ from, handover, to });

        await wait(gapMs);
      }

      sampling = false;
      return { idle, stamps, spans };
    },
    {
      selector: PAGE_FRAME,
      plan,
      commandMs: TURN_COMMAND_MS,
      tailMs: TAIL_MS,
      gapMs: GAP_MS,
      SEGMENT,
    },
  );
}

/** The drag, as a plan. `dx` negative is forward in a left-to-right book. */
const dragPlan = ({ turns = 6, dx = -400, ms = 300, steps = 12 }: TurnOptions): Plan => ({
  kind: "drag",
  turns,
  dx,
  ms,
  steps,
});

/** And the arrow key. `ArrowRight` is forward in a left-to-right book. */
const commandPlan = ({ turns = 12, key = "ArrowRight" }: CommandOptions): Plan => ({
  kind: "command",
  turns,
  key,
});

/** Splits a driven run into its two halves, thrown-away first turn already dropped. */
function halves(sampled: DrivenTurns): {
  frame: number;
  turns: number;
  first: FramePacing;
  second: FramePacing;
} {
  const intervalsIn = (from: number, to: number): number[] => {
    const within = sampled.stamps.filter((at) => at >= from && at <= to);
    return within.slice(1).map((at, index) => at - within[index]!);
  };

  // The idle stretch runs before the first turn, so its own samples are the whole of it.
  const frame = median(sampled.idle.slice(1).map((at, index) => at - sampled.idle[index]!));

  const measured = sampled.spans.slice(1);
  return {
    frame: round(frame),
    turns: measured.length,
    first: summarise(
      measured.flatMap((span) => intervalsIn(span.from, span.handover)),
      frame,
    ),
    second: summarise(
      measured.flatMap((span) => intervalsIn(span.handover, span.to)),
      frame,
    ),
  };
}

/** Drags the page across and times every frame of it. */
export async function measureTurnPacing(
  page: Page,
  options: TurnOptions = {},
): Promise<TurnPacing> {
  const { frame, turns, first, second } = halves(await drive(page, dragPlan(options)));
  return { frame, turns, follow: first, settle: second };
}

/** Turns the page with the arrow key and times every frame of it. */
export async function measureCommandPacing(
  page: Page,
  options: CommandOptions = {},
): Promise<CommandPacing> {
  const { frame, turns, first, second } = halves(await drive(page, commandPlan(options)));
  return { frame, turns, slide: first, reshuffle: second };
}

function summarise(intervals: number[], frame: number): FramePacing {
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const dropped = intervals.filter((gap) => gap > frame * DROP_FACTOR).length;

  return {
    intervals: intervals.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    longest: round(Math.max(0, ...intervals)),
    dropped,
    droppedShare: intervals.length === 0 ? 0 : round(dropped / intervals.length, 3),
    jumps: intervals.filter((gap) => gap > frame * JUMP_FACTOR).length,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value: number, places = 1): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * How many times the browser repainted per turn, and in which half of the turn.
 *
 * ## Why frame intervals are not enough
 *
 * A machine fast enough to repaint a full screen inside 16.7ms drops no frames while doing it,
 * so the pacing measurements above read perfectly clean over a drag that is repainting every
 * pixel of the page on every `pointermove`. That is not a hypothetical: it is what this reader
 * was doing, and what showed it was paint flashing in a browser's own devtools, not any number
 * here.
 *
 * The cost of those repaints is fill rate, and fill rate is the thing a phone has least of. So
 * this counts the work rather than timing it — the count is the same on a fast machine and a
 * slow one, which is exactly what makes it worth asserting on.
 *
 * ## How the halves are told apart without aligning two clocks
 *
 * A trace event's `ts` is microseconds on the monotonic clock the browser starts from, and
 * `performance.now()` counts from the document's origin — converting one to the other is a
 * layer of arithmetic that would have to be right and could not be checked. So nothing is
 * converted. The drivers call `console.timeStamp` at each boundary, which Chromium emits as a
 * `TimeStamp` event **in the same trace stream, on the same clock, as `Paint`**. Sorting the
 * two kinds together and walking the list is the whole of the segmentation.
 *
 * **Chromium only.** It comes out of the tracing categories devtools' own performance panel
 * uses, and the other two engines have no equivalent to reach from a test.
 */
export interface DragPaints {
  /** Repaints in one measured turn, press to end of tail. The warm-up turn is not in here. */
  readonly total: number;
  /** Of those, the ones while the page was under the finger. */
  readonly follow: number;
  /** And the ones after it lifted. */
  readonly settle: number;
}

export interface CommandPaints {
  /** Repaints in one measured turn, key to end of tail. The warm-up turn is not in here. */
  readonly total: number;
  /** Of those, the ones during the `TURN_COMMAND_MS` easing. */
  readonly slide: number;
  /** And the ones after it, for the commit and the frames either side. */
  readonly reshuffle: number;
}

interface TraceEvent {
  readonly name?: string;
  readonly ts?: number;
  readonly args?: { readonly data?: { readonly message?: string } };
}

/** Whether a `TimeStamp` in the trace is one of this file's, rather than anyone else's. */
function ours(event: TraceEvent): boolean {
  return event.args?.data?.message?.startsWith("tidemarks:") === true;
}

/** Counts the drag's repaints, split at the moment the finger lifts. */
export async function countTurnPaints(
  page: Page,
  context: BrowserContext,
  options: TurnOptions = {},
): Promise<DragPaints> {
  const { counts, turns } = await tracePaints(context, page, (p) => drive(p, dragPlan(options)));
  const follow = counts(SEGMENT.follow) / turns;
  const settle = counts(SEGMENT.settle) / turns;
  return { total: round(follow + settle), follow: round(follow), settle: round(settle) };
}

/** Counts a command turn's repaints, split at the end of its easing. */
export async function countCommandPaints(
  page: Page,
  context: BrowserContext,
  options: CommandOptions = {},
): Promise<CommandPaints> {
  const { counts, turns } = await tracePaints(context, page, (p) => drive(p, commandPlan(options)));
  const slide = counts(SEGMENT.slide) / turns;
  const reshuffle = counts(SEGMENT.reshuffle) / turns;
  return { total: round(slide + reshuffle), slide: round(slide), reshuffle: round(reshuffle) };
}

/** Runs a driver under the tracer and returns the repaints, per segment label. */
async function tracePaints(
  context: BrowserContext,
  page: Page,
  drive: (page: Page) => Promise<DrivenTurns>,
): Promise<{ counts: (segment: string) => number; turns: number }> {
  const cdp = await context.newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on("Tracing.dataCollected", ({ value }) => events.push(...(value as TraceEvent[])));

  await cdp.send("Tracing.start", {
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      includedCategories: ["devtools.timeline"],
    },
  });

  const driven = await drive(page);

  await cdp.send("Tracing.end");
  await new Promise<void>((done) => cdp.once("Tracing.tracingComplete", () => done()));
  await cdp.detach();

  // Ordered across the whole trace rather than per batch: `Tracing.dataCollected` arrives in
  // chunks, and a `Paint` from the renderer and a `TimeStamp` from the page are not guaranteed
  // to be in the same one.
  const ordered = events
    .filter((event) => event.name === "Paint" || event.name === "TimeStamp")
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const marks = ordered.filter((event) => event.name === "TimeStamp" && ours(event));
  if (marks.length === 0) {
    // Loud rather than zero. If a future Chromium stops emitting these, every count below would
    // come out at 0 and read as "this turn repaints nothing" — the best possible result, from a
    // measurement that had stopped happening.
    throw new Error("no TimeStamp events in the trace: console.timeStamp is not being recorded");
  }

  const tally = new Map<string, number>();
  let segment: string | null = null;
  for (const event of ordered) {
    if (event.name === "TimeStamp") {
      // **Only ours end a segment.** The prefix on `SEGMENT` above is written for this and was
      // never read: anything may call `console.timeStamp`, and React does — in development it
      // marks `Render`, `Commit`, `Remaining Effects` and `Waiting for Paint` on this same
      // stream. Treating those as boundaries handed every repaint after one to React's label
      // instead of to the turn, and a drag came out at 0 repaints while the finger was down.
      //
      // That is what a suite pointed at the dev server used to measure, and the ceilings in
      // `reader/turn-pacing.spec.ts` were calibrated through it. A foreign mark is now passed
      // over entirely, so the segment it lands inside goes on being the segment.
      if (!ours(event)) continue;
      segment = event.args?.data?.message ?? null;
      continue;
    }
    // Before the first mark: whatever the page was doing when tracing began, not a turn.
    if (segment === null) continue;
    tally.set(segment, (tally.get(segment) ?? 0) + 1);
  }

  return {
    counts: (name: string) => tally.get(name) ?? 0,
    // The warm-up turn carries its own label, so it is already out of every count above.
    turns: driven.spans.length - 1,
  };
}

/** The pacing, as one line per segment, for a test's own report. */
export function describePacing(pacing: TurnPacing | CommandPacing): string {
  const line = (name: string, segment: FramePacing) =>
    `${name}: p50 ${segment.p50}ms, p95 ${segment.p95}ms, longest ${segment.longest}ms, ` +
    `dropped ${segment.dropped}/${segment.intervals} (${Math.round(segment.droppedShare * 100)}%), ` +
    `jumps ${segment.jumps}/${pacing.turns} turns`;

  const segments =
    "follow" in pacing
      ? [line("follow", pacing.follow), line("settle", pacing.settle)]
      : [line("slide", pacing.slide), line("reshuffle", pacing.reshuffle)];

  return [`one frame on this machine: ${pacing.frame}ms`, ...segments].join("\n");
}
