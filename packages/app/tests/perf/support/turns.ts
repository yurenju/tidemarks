import type { Page } from "@playwright/test";

/**
 * Times arrow-key page turns end to end, from the key going down to the page going quiet.
 *
 * `tests/browser/support/pacing.ts` measures how evenly the frames come out once a turn is
 * moving, and it starts the clock at `keyup`. That misses the part a reader complained about:
 * the gap between pressing the key and anything moving at all. The page turn listens on
 * `keyup` (docs/specs/desktop-page-turn), so that gap is at least as long as the key is held,
 * and whatever the app does before the first frame of the slide comes on top. This driver
 * presses the way a finger does — down, held, up — and records each step.
 *
 * Like pacing.ts, the whole run happens inside one `page.evaluate`, so no CDP round trip
 * lands inside the thing being timed. Keys are dispatched as synthetic events on `document`,
 * which is the path the reader's own listener takes when focus is outside the book.
 *
 * ## What each turn records
 *
 * Every frame, the sampler notes which iframe is the page, its transform, and where that
 * frame's document is scrolled. From those:
 *
 * - **motion** — the first frame after the key where the page moved: its transform changed,
 *   or a different page is showing.
 * - **commit** — the first frame where a different page is showing: another iframe holds the
 *   page role, or the same one shows another section or scroll offset.
 * - **quiet** — after the commit, the start of the first run of `QUIET_FRAMES` intervals that
 *   are each under one and a half frames. Everything the turn sets off — frond re-pointing the
 *   neighbours, the [[Highlight layer]] measuring every mark of the section again — is done by
 *   then, because any of it long enough to matter would have stretched a frame.
 *
 * And from the browser itself, the **long animation frames** (Chromium's
 * `long-animation-frame` entries, 50ms and over) that overlap the turn, with how much of each
 * was script and how much was style and layout. That split is what says which half of the
 * code a slow turn is in.
 */

/** Three frames running at the machine's cadence is quiet enough to call the turn done. */
const QUIET_FRAMES = 3;
/** An interval longer than this many frames has dropped one. */
const DROP_FACTOR = 1.5;
/** How long a key is held. A deliberate tap of an arrow key is about this. */
export const HOLD_MS = 100;
/**
 * The longest a turn is waited for before it is recorded as never going quiet. Long, because a
 * turn under hundreds of marks on a throttled CPU has been seen to block for several seconds,
 * and pressing again inside that would be timing two turns as one.
 */
const TAIL_MS = 30_000;
/** After a burst, how long the frames have to run clean and still before the queued turns count as done. */
const BURST_QUIET_MS = 1_000;
/** A gap between turns, so one turn's tail is not counted as the next one's start. */
const GAP_MS = 150;

export interface LongFrame {
  readonly start: number;
  readonly duration: number;
  /** Time inside script callbacks the frame attributes. */
  readonly script: number;
  /** From the start of style and layout to the end of the frame. */
  readonly layout: number;
}

export interface TurnRecord {
  /** The chapter's title before and after, read off the page frame's `<title>`. */
  readonly sectionBefore: string;
  readonly sectionAfter: string;
  /** From `keydown` to the first frame that moved — what the reader feels. Null if it never moved. */
  readonly downToMotion: number | null;
  /** From `keyup` to the first frame that moved — the part the app spends. */
  readonly upToMotion: number | null;
  /** From `keyup` to the new page showing. */
  readonly upToCommit: number | null;
  /** From the new page showing to the main thread going quiet. Null if it did not within the tail. */
  readonly commitToQuiet: number | null;
  /** Frame intervals from `keyup` to quiet. */
  readonly intervals: readonly number[];
  readonly longFrames: readonly LongFrame[];
}

export interface CommandRun {
  /** What one frame takes on this machine, measured while idle. */
  readonly frame: number;
  readonly turns: readonly TurnRecord[];
}

export interface BurstRun {
  readonly frame: number;
  readonly presses: number;
  /** How many pages actually turned. */
  readonly turned: number;
  /** From the first `keydown` to quiet after the last turn. */
  readonly elapsed: number;
  readonly intervals: readonly number[];
  readonly longFrames: readonly LongFrame[];
}

type Plan =
  | {
      readonly kind: "single";
      readonly turns: number;
      readonly key: string;
      /** How long to wait on each page once it has gone quiet. */
      readonly pause: number;
    }
  | {
      readonly kind: "burst";
      readonly presses: number;
      readonly every: number;
      readonly key: string;
    };

interface Driven {
  readonly frame: number;
  readonly samples: { at: number; frame: number; transform: string; place: string }[];
  readonly presses: { down: number; up: number }[];
  readonly titles: { before: string; after: string }[];
}

async function drive(page: Page, plan: Plan): Promise<Driven> {
  return await page.evaluate(
    async ({ plan, hold, tail, quietFrames, dropFactor, burstQuiet }) => {
      const selector = ".viewer-mount iframe[data-frond-page]";
      const ids = new WeakMap<Element, number>();
      let nextId = 0;
      const idOf = (element: Element) => {
        if (!ids.has(element)) ids.set(element, (nextId += 1));
        return ids.get(element)!;
      };

      const look = () => {
        const frame = document.querySelector(selector) as HTMLIFrameElement | null;
        if (!frame) return { frame: 0, transform: "", place: "", title: "" };
        const document_ = frame.contentDocument;
        const root = document_?.scrollingElement ?? document_?.documentElement;
        return {
          frame: idOf(frame),
          transform: frame.style.transform,
          place: `${document_?.title}|${root?.scrollLeft}|${root?.scrollTop}`,
          title: document_?.title ?? "",
        };
      };

      const samples: Driven["samples"] = [];
      let sampling = true;
      const tick = (at: number) => {
        const seen = look();
        samples.push({ at, frame: seen.frame, transform: seen.transform, place: seen.place });
        if (sampling) requestAnimationFrame(tick);
      };

      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const key = (type: string) =>
        document.dispatchEvent(new KeyboardEvent(type, { key: plan.key, bubbles: true }));

      requestAnimationFrame(tick);
      await wait(500);
      const idle = samples.map((sample) => sample.at);
      const intervals = idle.slice(1).map((at, index) => at - idle[index]!);
      const frame = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] ?? 16.7;

      /** Resolves once the frames since `since` show a commit followed by a quiet run. */
      const settled = async (since: number, before: string) => {
        const deadline = performance.now() + tail;
        while (performance.now() < deadline) {
          await wait(50);
          const after = samples.filter((sample) => sample.at >= since);
          const committed = after.findIndex(
            (sample) => `${sample.frame}|${sample.place}` !== before,
          );
          if (committed < 0) continue;
          let run = 0;
          for (let k = committed + 1; k < after.length; k += 1) {
            run = after[k]!.at - after[k - 1]!.at <= frame * dropFactor ? run + 1 : 0;
            if (run >= quietFrames) return;
          }
        }
      };

      const presses: Driven["presses"] = [];
      const titles: Driven["titles"] = [];

      if (plan.kind === "single") {
        for (let turn = 0; turn < plan.turns; turn += 1) {
          const seen = look();
          const before = `${seen.frame}|${seen.place}`;
          const down = performance.now();
          key("keydown");
          await wait(hold);
          const up = performance.now();
          key("keyup");
          presses.push({ down, up });
          await settled(up, before);
          titles.push({ before: seen.title, after: look().title });
          await wait(plan.pause);
        }
      } else {
        const start = performance.now();
        const before = look();
        for (let press = 0; press < plan.presses; press += 1) {
          const due = start + press * plan.every;
          await wait(Math.max(0, due - performance.now()));
          const down = performance.now();
          key("keydown");
          await wait(Math.min(hold, plan.every / 2));
          const up = performance.now();
          key("keyup");
          presses.push({ down, up });
        }
        // The queued turns finish one after another, which under load takes far longer than
        // the presses did. Done is a stretch of `burstQuiet` with every interval on time and
        // nothing moving.
        const deadline = performance.now() + tail;
        while (performance.now() < deadline) {
          await wait(200);
          const now = performance.now();
          const recent = samples.filter((sample) => sample.at >= now - burstQuiet);
          const clean = recent
            .slice(1)
            .every((sample, k) => sample.at - recent[k]!.at <= frame * dropFactor);
          // And nothing moving: a queued turn sliding along on time is clean but not done.
          const still = recent.every(
            (sample) =>
              sample.frame === recent[0]!.frame &&
              sample.place === recent[0]!.place &&
              sample.transform === recent[0]!.transform,
          );
          if (
            recent.length > 10 &&
            clean &&
            still &&
            now - presses[presses.length - 1]!.up > burstQuiet
          )
            break;
        }
        titles.push({ before: before.title, after: look().title });
      }

      sampling = false;
      return { frame, samples, presses, titles };
    },
    {
      plan,
      hold: HOLD_MS,
      tail: TAIL_MS,
      burstQuiet: BURST_QUIET_MS,
      quietFrames: QUIET_FRAMES,
      dropFactor: DROP_FACTOR,
    },
  );
}

/** The frame index where the run of quiet intervals after `from` begins, or -1. */
function quietAfter(samples: Driven["samples"], from: number, frame: number): number {
  let run = 0;
  for (let k = from + 1; k < samples.length; k += 1) {
    run = samples[k]!.at - samples[k - 1]!.at <= frame * DROP_FACTOR ? run + 1 : 0;
    if (run >= QUIET_FRAMES) return k - QUIET_FRAMES;
  }
  return -1;
}

function intervalsBetween(samples: Driven["samples"], from: number, to: number): number[] {
  const within = samples.filter((sample) => sample.at >= from && sample.at <= to);
  return within.slice(1).map((sample, index) => sample.at - within[index]!.at);
}

function overlapping(frames: readonly LongFrame[], from: number, to: number): LongFrame[] {
  return frames.filter((entry) => entry.start < to && entry.start + entry.duration > from);
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Turns `turns` pages one at a time, letting each go quiet and then waiting `pause` before
 * pressing again. The default pause only keeps one turn's tail out of the next; a longer one
 * stands in for a reader reading the page, which is what gives the reader time to lay out the
 * page after it.
 */
export async function singleTurns(
  page: Page,
  turns: number,
  key: "ArrowLeft" | "ArrowRight",
  pause = GAP_MS,
): Promise<CommandRun> {
  const { result: driven, longFrames } = await collectLongFrames(page, () =>
    drive(page, { kind: "single", turns, key, pause }),
  );
  const { samples, frame } = driven;

  const records = driven.presses.map((press, index): TurnRecord => {
    const next = driven.presses[index + 1]?.down ?? Infinity;
    const startAt = samples.findIndex((sample) => sample.at >= press.down);
    const rest = samples[startAt - 1] ?? samples[startAt]!;
    const place = `${rest.frame}|${rest.place}`;

    const motion = samples.findIndex(
      (sample, k) =>
        k >= startAt &&
        sample.at < next &&
        (`${sample.frame}|${sample.place}` !== place || sample.transform !== rest.transform),
    );
    const commit = samples.findIndex(
      (sample, k) =>
        k >= startAt && sample.at < next && `${sample.frame}|${sample.place}` !== place,
    );
    const quiet = commit < 0 ? -1 : quietAfter(samples, commit, frame);
    const end = quiet < 0 ? Math.min(next, press.up + TAIL_MS) : samples[quiet]!.at;

    const at = (k: number) => (k < 0 ? null : samples[k]!.at);
    const motionAt = at(motion);
    const commitAt = at(commit);
    const quietAt = at(quiet);
    return {
      sectionBefore: driven.titles[index]?.before ?? "",
      sectionAfter: driven.titles[index]?.after ?? "",
      downToMotion: motionAt === null ? null : round(motionAt - press.down),
      upToMotion: motionAt === null ? null : round(motionAt - press.up),
      upToCommit: commitAt === null ? null : round(commitAt - press.up),
      commitToQuiet: commitAt === null || quietAt === null ? null : round(quietAt - commitAt),
      intervals: intervalsBetween(samples, press.up, end).map(round),
      longFrames: overlapping(longFrames, press.down, end),
    };
  });

  return { frame: round(frame), turns: records };
}

/**
 * Presses the key `presses` times, `every` ms apart, without waiting for the turns — a reader
 * tapping through pages they have already read.
 */
export async function burstTurns(
  page: Page,
  presses: number,
  every: number,
  key: "ArrowLeft" | "ArrowRight",
): Promise<BurstRun> {
  const { result: driven, longFrames } = await collectLongFrames(page, () =>
    drive(page, { kind: "burst", presses, every, key }),
  );
  const { samples, frame } = driven;
  const first = driven.presses[0]!.down;
  const startAt = samples.findIndex((sample) => sample.at >= first);

  let turned = 0;
  let lastCommit = startAt;
  for (let k = Math.max(1, startAt); k < samples.length; k += 1) {
    const was = samples[k - 1]!;
    const is = samples[k]!;
    if (`${was.frame}|${was.place}` !== `${is.frame}|${is.place}`) {
      turned += 1;
      lastCommit = k;
    }
  }
  const quiet = quietAfter(samples, lastCommit, frame);
  const end = quiet < 0 ? samples[samples.length - 1]!.at : samples[quiet]!.at;

  return {
    frame: round(frame),
    presses,
    turned,
    elapsed: round(end - first),
    intervals: intervalsBetween(samples, first, end).map(round),
    longFrames: overlapping(longFrames, first, end),
  };
}

/**
 * The long animation frames during `run` — every driver's, since the browser keeps one record of
 * them for the whole page whichever way the turns were made.
 */
export async function collectLongFrames<T>(
  page: Page,
  run: () => Promise<T>,
): Promise<{ result: T; longFrames: LongFrame[] }> {
  await page.evaluate(() => {
    const store: LongFrame[] = [];
    const keep = (entries: PerformanceEntryList) => {
      for (const entry of entries) {
        const loaf = entry as PerformanceEntry & {
          styleAndLayoutStart: number;
          scripts: { duration: number }[];
        };
        store.push({
          start: loaf.startTime,
          duration: loaf.duration,
          script: loaf.scripts.reduce((sum, script) => sum + script.duration, 0),
          layout: loaf.styleAndLayoutStart
            ? loaf.startTime + loaf.duration - loaf.styleAndLayoutStart
            : 0,
        });
      }
    };
    const observer = new PerformanceObserver((list) => keep(list.getEntries()));
    observer.observe({ type: "long-animation-frame" });
    (window as unknown as { __perfLongFrames: unknown }).__perfLongFrames = {
      // Entries are delivered after the frame they describe, so the last turn's may still be
      // queued when the run returns; `takeRecords` hands those over before disconnecting.
      finish: () => {
        keep(observer.takeRecords());
        observer.disconnect();
        return store;
      },
    };
  });
  const finish = () =>
    page.evaluate(() =>
      (
        window as unknown as { __perfLongFrames: { finish: () => LongFrame[] } }
      ).__perfLongFrames.finish(),
    );
  try {
    const result = await run();
    return { result, longFrames: await finish() };
  } catch (error) {
    // The page usually outlives a failed run, and an observer left on it would go on collecting
    // into whatever runs next.
    await finish().catch(() => undefined);
    throw error;
  }
}
