import type { TurnPacing } from "../../browser/support/pacing.js";
import type { BurstRun, CommandRun, LongFrame, TurnRecord } from "./turns.js";

/**
 * Boils the raw runs down to one row per scenario, and renders the rows as Markdown tables, which
 * is the shape they are posted in on issue #261 (page-turn performance on a long Chinese novel
 * with many marks).
 *
 * Medians and maxima rather than means: a page turn that stutters once in ten is the thing
 * being looked for, and a mean spreads that one turn across the other nine.
 */

export interface LongFrameSummary {
  readonly count: number;
  readonly longest: number;
  /** Summed over the frames: how much was script, and how much was style and layout. */
  readonly script: number;
  readonly layout: number;
}

export interface SingleSummary {
  readonly turns: number;
  /** How many of them crossed into another chapter. */
  readonly crossed: number;
  readonly downToMotion: Spread;
  readonly upToMotion: Spread;
  readonly upToCommit: Spread;
  readonly commitToQuiet: Spread;
  /** Turns that never went quiet within the tail. */
  readonly neverQuiet: number;
  readonly longestInterval: number;
  readonly dropped: number;
  readonly longFrames: LongFrameSummary;
}

export interface Spread {
  readonly median: number | null;
  readonly max: number | null;
}

const round = (value: number) => Math.round(value * 10) / 10;

function spread(values: readonly (number | null)[]): Spread {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return { median: null, max: null };
  return { median: present[Math.floor(present.length / 2)]!, max: present[present.length - 1]! };
}

export function summariseLongFrames(frames: readonly LongFrame[]): LongFrameSummary {
  // The same frame can overlap two turns' windows; count it once.
  const unique = [...new Map(frames.map((frame) => [frame.start, frame])).values()];
  return {
    count: unique.length,
    longest: round(Math.max(0, ...unique.map((frame) => frame.duration))),
    script: round(unique.reduce((sum, frame) => sum + frame.script, 0)),
    layout: round(unique.reduce((sum, frame) => sum + frame.layout, 0)),
  };
}

/**
 * The first turn of a session is thrown away, as pacing.ts does: it pays for work done once,
 * and including it would mostly report how long a warm-up took.
 */
export function summariseSingle(run: CommandRun, keepFirst = false): SingleSummary {
  const turns: readonly TurnRecord[] = keepFirst ? run.turns : run.turns.slice(1);
  const intervals = turns.flatMap((turn) => turn.intervals);
  return {
    turns: turns.length,
    crossed: turns.filter((turn) => turn.sectionBefore !== turn.sectionAfter).length,
    downToMotion: spread(turns.map((turn) => turn.downToMotion)),
    upToMotion: spread(turns.map((turn) => turn.upToMotion)),
    upToCommit: spread(turns.map((turn) => turn.upToCommit)),
    commitToQuiet: spread(turns.map((turn) => turn.commitToQuiet)),
    neverQuiet: turns.filter((turn) => turn.commitToQuiet === null).length,
    longestInterval: round(Math.max(0, ...intervals)),
    dropped: intervals.filter((gap) => gap > run.frame * 1.5).length,
    longFrames: summariseLongFrames(turns.flatMap((turn) => turn.longFrames)),
  };
}

export interface ScenarioResult {
  readonly direction: string;
  readonly cpu: number;
  readonly scenario: string;
  /** How many marks the book held, and how many the opening page drew. */
  readonly marks: number;
  readonly strips: number;
  readonly dots: number;
  readonly single?: SingleSummary;
  /** Turns that crossed a chapter boundary, apart from the ones that did not. */
  readonly crossing?: SingleSummary;
  readonly burst?: Omit<BurstRun, "intervals" | "longFrames"> & {
    longestInterval: number;
    longFrames: LongFrameSummary;
  };
  readonly drag?: TurnPacing & { longFrames: LongFrameSummary };
}

const cell = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : String(value);
const pair = (spread: Spread) => `${cell(spread.median)} / ${cell(spread.max)}`;

export function markdown(results: readonly ScenarioResult[]): string {
  const lines: string[] = [];

  lines.push(
    "### Single turns (median / max, ms)",
    "",
    "| direction | CPU | scenario | marks | strips / dots on page | down→motion | up→motion | up→commit | commit→quiet | never quiet | longest interval | dropped | long frames (n, longest, script, layout) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const result of results) {
    for (const [label, summary] of [
      ["", result.single],
      [" (crossing)", result.crossing],
    ] as const) {
      if (summary === undefined || summary.turns === 0) continue;
      const frames = summary.longFrames;
      lines.push(
        `| ${result.direction} | ${result.cpu}× | ${result.scenario}${label} | ${result.marks} | ${result.strips} / ${result.dots} | ${pair(summary.downToMotion)} | ${pair(summary.upToMotion)} | ${pair(summary.upToCommit)} | ${pair(summary.commitToQuiet)} | ${summary.neverQuiet}/${summary.turns} | ${summary.longestInterval} | ${summary.dropped} | ${frames.count}, ${frames.longest}, ${frames.script}, ${frames.layout} |`,
      );
    }
  }

  const bursts = results.filter((result) => result.burst !== undefined);
  if (bursts.length > 0) {
    lines.push(
      "",
      "### Rapid presses",
      "",
      "| direction | CPU | scenario | presses | turned | elapsed (ms) | longest interval | long frames (n, longest, script, layout) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const { direction, cpu, scenario, burst } of bursts) {
      const frames = burst!.longFrames;
      lines.push(
        `| ${direction} | ${cpu}× | ${scenario} | ${burst!.presses} | ${burst!.turned} | ${burst!.elapsed} | ${burst!.longestInterval} | ${frames.count}, ${frames.longest}, ${frames.script}, ${frames.layout} |`,
      );
    }
  }

  const drags = results.filter((result) => result.drag !== undefined);
  if (drags.length > 0) {
    lines.push(
      "",
      "### Drags (follow / settle)",
      "",
      "| direction | CPU | scenario | p95 | longest | dropped | long frames (n, longest, script, layout) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const { direction, cpu, scenario, drag } of drags) {
      const { follow, settle } = drag!;
      const frames = drag!.longFrames;
      lines.push(
        `| ${direction} | ${cpu}× | ${scenario} | ${follow.p95} / ${settle.p95} | ${follow.longest} / ${settle.longest} | ${follow.dropped}/${follow.intervals} / ${settle.dropped}/${settle.intervals} | ${frames.count}, ${frames.longest}, ${frames.script}, ${frames.layout} |`,
      );
    }
  }

  return lines.join("\n");
}
