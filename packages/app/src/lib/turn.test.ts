// The shapes a turn makes out of *time*, which is the part no other layer can see: the two
// halves of the nudge at the end of the book, a held arrow key landing the turn before it, the
// page that is asked for but not yet laid out, and a reader who wants less movement. Each of
// these is a few hundred milliseconds long and correct-looking at both ends, so the browser
// layer can only report where it stopped — `tests/browser/reader/paging.spec.ts` and
// `turn-pacing.spec.ts` are the same turns made for real, and they own whether frond does the
// right thing once told. This file owns only whether it was told the right thing at the right
// moment.
import { describe, expect, test } from "vitest";
import type { PageOffset, TurnInProgress } from "@yurenju/frond/renderer";
import {
  AT_REST,
  BOUNCE_FRACTION,
  BOUNCE_MS,
  TURN_COMMAND_MS,
  TURN_SETTLE_MS,
  createTurnRunner,
  type TurnClock,
} from "./turn";
import { createNavigator } from "./navigator";

/**
 * A turn that records what was asked of it.
 *
 * **It is a recorder, not an imitation.** What these tests check is whether the runner issues
 * the right calls on the right timeline — nothing here claims to behave the way a real turn
 * behaves. The half of the question this cannot answer, whether frond does the right thing once
 * told, is the browser tests' (CONTEXT.md, on what the runner's tests are worth).
 */
interface FakeTurn extends TurnInProgress {
  /** Every distance `moveTo` was called with, in order. */
  readonly moves: readonly number[];
  /** `"commit"` or `"cancel"`, in the order they arrived. */
  readonly ended: readonly string[];
  /**
   * Ends the turn the way frond does when something else ends it — a key, a jump, a resize.
   * Neither commit nor cancel: the turn is simply no longer the one in progress.
   *
   * `takesOver` is frond's own argument, and the whole of what separates the two cases: a jump
   * is answerable for where the reader lands, a relayout moves nobody.
   */
  abandon(takesOver: boolean): void;
}

function fakeTurn(
  shape: { extent?: number; atBoundary?: boolean; hasPreview?: boolean } = {},
): FakeTurn {
  const moves: number[] = [];
  const ended: string[] = [];
  let live = true;
  let stranded = false;
  return {
    extent: shape.extent ?? 300,
    atBoundary: shape.atBoundary ?? false,
    hasPreview: shape.hasPreview ?? true,
    get live() {
      return live;
    },
    get stranded() {
      return stranded;
    },
    // **A turn that is over does not move**, which is frond's own contract for this
    // (`renderer.ts`, on what `moveTo` does once the turn is no longer live) rather than an
    // imitation of it. Recording the call anyway would let "commit, then move" record the same
    // as "move, then commit" — and the first of those leaves the outgoing page frozen across
    // the middle of the screen.
    moveTo(distance: number): PageOffset {
      if (!live) return { x: 0, y: 0 };
      moves.push(distance);
      return { x: distance, y: 0 };
    },
    commit() {
      live = false;
      ended.push("commit");
    },
    cancel() {
      live = false;
      ended.push("cancel");
    },
    abandon(takesOver: boolean) {
      live = false;
      stranded = !takesOver;
    },
    moves,
    ended,
  };
}

/** A clock the test winds by hand. One `advance` runs whatever frame was waiting on it. */
function fakeClock(reduceMotion: boolean) {
  let at = 0;
  let waiting: ((now: number) => void)[] = [];
  const clock: TurnClock = {
    raf: (step) => {
      waiting.push(step);
    },
    now: () => at,
    reduceMotion: () => reduceMotion,
  };
  return {
    clock,
    advance(ms: number) {
      at += ms;
      const due = waiting;
      waiting = [];
      for (const step of due) step(at);
    },
  };
}

function runnerOver(open: () => TurnInProgress | undefined, opts: { reduceMotion?: boolean } = {}) {
  const { clock, advance } = fakeClock(opts.reduceMotion ?? false);
  const asked: string[] = [];
  const slid: PageOffset[] = [];
  const runner = createTurnRunner({
    renderer: () => ({
      beginTurn: open,
      next: async () => {
        asked.push("next");
      },
      previous: async () => {
        asked.push("previous");
      },
    }),
    navigator: () => createNavigator({ rtl: false }),
    slide: (at) => slid.push(at),
    clock,
  });
  return { runner, advance, asked, slid };
}

describe("a turn nobody dragged", () => {
  test("nudges out and comes straight back at the end of the book", () => {
    const turn = fakeTurn({ extent: 300, atBoundary: true });
    const { runner, advance } = runnerOver(() => turn);

    runner.run({ kind: "commandTurn", towards: "next" });

    advance(BOUNCE_MS);
    expect(turn.moves.at(-1)).toBeCloseTo(300 * BOUNCE_FRACTION);
    expect(turn.ended).toEqual([]);

    advance(BOUNCE_MS);
    expect(turn.moves.at(-1)).toBe(0);
    expect(turn.ended).toEqual(["cancel"]);
  });

  test("lands the turn still in flight before beginning another", () => {
    const first = fakeTurn({ extent: 300 });
    const second = fakeTurn({ extent: 300 });
    const opening = [first, second];
    const { runner, advance } = runnerOver(() => opening.shift());

    runner.run({ kind: "commandTurn", towards: "next" });
    advance(TURN_COMMAND_MS / 2);
    // Half the time, half the distance: `easeInOut` is symmetrical about its middle. Asserting
    // the distance and not just "it has not finished" is what pins the easing — the wrong curve
    // is still unfinished here, and still ends in the right place.
    expect(first.moves.at(-1)).toBe(150);
    expect(first.ended).toEqual([]);

    // A reader leaning on the arrow key repeats faster than a turn takes. Without this the book
    // would start a turn per repeat, finish none of them, and sit still under the held key.
    runner.run({ kind: "commandTurn", towards: "next" });
    expect(first.moves.at(-1)).toBe(300);
    expect(first.ended).toEqual(["commit"]);
  });

  test("turns the plain way when there is a page but nothing laid out behind it", () => {
    const turn = fakeTurn({ hasPreview: false, atBoundary: false });
    const { runner, asked } = runnerOver(() => turn);

    runner.run({ kind: "commandTurn", towards: "next" });

    expect(turn.ended).toEqual(["cancel"]);
    expect(asked).toEqual(["next"]);
  });

  test("puts what is drawn over the page back when something else moves the reader", () => {
    const turn = fakeTurn({ extent: 300 });
    const { runner, advance, slid, asked } = runnerOver(() => turn);

    runner.run({ kind: "commandTurn", towards: "next" });
    advance(TURN_COMMAND_MS / 2);
    slid.length = 0;

    // A key, a jump. frond has already put its own frames back, so the marks drawn over the page
    // have to go back with them — left where the turn carried them they would sit off the side
    // of the book until something else repainted.
    turn.abandon(true);
    advance(TURN_COMMAND_MS / 2);

    expect(slid).toEqual([AT_REST]);
    expect(turn.ended).toEqual([]);
    // And **nothing is turned on top of it**: a contents entry or a CFI is already carrying the
    // reader to a page, so a turn delivered here would land them one past where they asked to go.
    // The other half of this is the test below.
    expect(asked).toEqual([]);
  });

  test("still delivers the page when the slide is cut short by a relayout", () => {
    const turn = fakeTurn({ extent: 300 });
    const { runner, advance, asked } = runnerOver(() => turn);

    runner.run({ kind: "commandTurn", towards: "next" });
    advance(TURN_COMMAND_MS / 2);

    // A window resized, a setting applied: frond puts its frames back at rest, so the slide has
    // nothing left to move — and **nothing is taking the reader anywhere**. Giving up here is
    // what left a reader pressing the button on a page that never changed, with no position
    // written either (#135).
    turn.abandon(false);
    advance(TURN_COMMAND_MS / 2);

    expect(asked).toEqual(["next"]);
    expect(turn.ended).toEqual([]);
  });

  test("lands where it is going without animating under reduced motion", () => {
    const turn = fakeTurn({ extent: 300 });
    const { runner } = runnerOver(() => turn, { reduceMotion: true });

    runner.run({ kind: "commandTurn", towards: "next" });

    expect(turn.moves).toEqual([300]);
    expect(turn.ended).toEqual(["commit"]);
  });
});

describe("the tail of a turn a finger let go of", () => {
  test("delivers the page when the settle is cut short by a relayout", () => {
    const turn = fakeTurn({ extent: 300 });
    const { runner, advance, asked } = runnerOver(() => turn);

    runner.run({ kind: "beginTurn", towards: "next", from: "right" });
    runner.run({ kind: "commitTurn", from: 200, to: 300 });
    advance(TURN_SETTLE_MS / 2);

    // The finger already crossed the threshold, so this page is as asked-for as a button's —
    // and the loss looks the same from the reader's side: "I swiped and nothing happened".
    turn.abandon(false);
    advance(TURN_SETTLE_MS);

    expect(asked).toEqual(["next"]);
  });
});
