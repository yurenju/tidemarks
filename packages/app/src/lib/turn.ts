// How a page turn moves: how long each kind takes, the shape it travels through, and the code
// that plays it out.
//
// **Nothing here decides that a page should turn.** What a sequence of pointer events means is
// the gesture machine's (`gesture.ts`), which side is forward is the Navigator's, and the two
// pages themselves are frond's. This module is handed a decision already made — one of six
// intents — and is the hand that carries it out. The pair is the whole of it: `gesture.ts`
// answers "what did that mean", this answers "then do it".
//
// The numbers are here rather than as four constants in the Reader because the browser tests
// draw a segment boundary at `TURN_COMMAND_MS` and have to use the same number the app animates
// with. A second copy in the test would not fail when this one changed — it would quietly count
// a few frames into the wrong half (`tests/browser/support/pacing.ts`). Importing the Reader
// itself is not an option: it builds a Dexie instance at module scope, which needs a browser.
//
// Every number here is a choice, not a measurement. Where one was picked rather than measured it
// says so, and docs/specs/desktop-page-turn/measurements.md says what would settle it.

import type {
  PageOffset,
  Renderer,
  TurnDirection,
  TurnEdge,
  TurnInProgress,
} from "@yurenju/frond/renderer";
// `.js` on these two: the browser tests reach in here for `TURN_COMMAND_MS`
// (`tests/browser/support/pacing.ts`), and that side is compiled under node16 resolution, which
// wants the extension written out. The rest of `lib/` is only ever compiled by the bundler.
import type { GestureIntent, TurnFacts } from "./gesture.js";
import type { Navigator } from "./navigator.js";

/**
 * How long the page takes to finish a turn the finger let go of, or to slide back to where it
 * was.
 *
 * Short, because the reader has already done the moving. This is only the tail of a gesture, not
 * an animation they are meant to watch.
 */
export const TURN_SETTLE_MS = 180;

/**
 * And how long a turn nobody dragged takes: a page button, an arrow key.
 *
 * Longer than the settle because it is a different job. That one finishes off a movement the
 * reader has already made most of; this one crosses the whole screen from a standstill, and it
 * is the only thing on screen saying which way the book just went. Still short: a reader turns
 * thousands of pages, and every one of them waits for this.
 *
 * **Picked, not measured** (measurements.md §1). It has pressure from both sides, so moving it
 * one way only will not find the answer: too long and every one of those thousands of turns is
 * a wait; too short and it reads as a flicker rather than a movement, which is the whole point
 * of having it.
 */
export const TURN_COMMAND_MS = 220;

/**
 * The nudge a page gives when it is asked to turn past the end of the book, as a proportion of
 * the page, and how long each half of that nudge takes.
 *
 * The same answer the drag gives at the boundary, in the one form a press can take it: it moves,
 * so the book is not stuck, and it comes straight back, so this is the end. A button that does
 * nothing at all cannot be told from a book that has stopped working, and now that every other
 * press slides the page across, the dead one would be the odd one out.
 *
 * The fraction differs from the drag's overscroll limit (`touch.ts`'s 25%) on purpose: that one
 * is how far the reader pushed it, this one is how far the system pushed it for them.
 */
export const BOUNCE_FRACTION = 0.06;
export const BOUNCE_MS = 110;

/** Eases out of the speed it was already going. The tail of a gesture the reader began. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Starts and ends at rest. A turn nobody was pushing, so there is no speed to inherit. */
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Where the page sits when no turn is moving it. */
export const AT_REST: PageOffset = { x: 0, y: 0 };

/**
 * The three things playing a turn asks of frond.
 *
 * **Narrow on purpose.** `Renderer` has two dozen members, so a stand-in for the whole of it can
 * only be written by asserting past the type checker — and a stand-in that is missing something
 * the runner really calls would then fail at run time, pointing at the wrong thing. Named down to
 * three, a complete stand-in is three properties, and the compiler is back on the job.
 */
export type TurnSource = Pick<Renderer, "beginTurn" | "next" | "previous">;

/**
 * The clock a turn animates against.
 *
 * Injected so that the shapes made out of time — the two halves of a bounce, a repeat landing the
 * turn before it — can be checked without a browser. The default is the real one; nothing in the
 * app passes this.
 */
export interface TurnClock {
  /** Asks for the next frame. */
  readonly raf: (step: (now: number) => void) => void;
  /** Milliseconds, on the same scale the frame is handed. */
  readonly now: () => number;
  /** Whether the reader has asked for less movement. */
  readonly reduceMotion: () => boolean;
}

const browserClock: TurnClock = {
  raf: (step) => {
    requestAnimationFrame(step);
  },
  now: () => performance.now(),
  reduceMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

/**
 * The intents that ask for a page to move — the six of the gesture machine's that reach here.
 *
 * **The six kinds are still written out by hand, so `Extract` is not what keeps this honest.**
 * Adding a seventh to the gesture machine and not to this list would leave it selected by
 * neither, and the page would quietly not move. What catches that is the pair of exhaustive
 * switches at either end: the Reader's must route every `GestureIntent` somewhere, and `run`'s
 * must handle every `TurnIntent`. Both end in `satisfies never`, so a kind that reaches neither
 * is a compile error.
 */
export type TurnIntent = Extract<
  GestureIntent,
  { kind: "beginTurn" | "moveTurn" | "dropTurn" | "commitTurn" | "cancelTurn" | "commandTurn" }
>;

export interface TurnRunner {
  /** Carries out one intent. */
  run(intent: TurnIntent): void;
  /**
   * What the turn the finger is dragging measures right now, for the gesture machine to decide
   * against. `null` when there is no such turn.
   */
  facts(): TurnFacts | null;
}

/**
 * Makes the hand that plays turns out.
 *
 * `renderer` and `navigator` are asked for each time rather than held, and both have to be:
 * a renderer arrives when a book opens and goes when it closes, and a navigator is **replaced
 * mid-book** — the book's direction is settled by the first section that lays out vertically
 * (CONTEXT.md, on turn direction), so one captured at open time can be the wrong way round.
 *
 * `slide` moves whatever the app has drawn over the page — the highlight layer — with the page
 * itself. A mark belongs to a passage of the book, not to the screen.
 */
export function createTurnRunner(deps: {
  readonly renderer: () => TurnSource | null;
  readonly navigator: () => Navigator | null;
  readonly slide: (at: PageOffset) => void;
  readonly clock?: TurnClock;
}): TurnRunner {
  const { renderer, navigator, slide } = deps;
  const clock = deps.clock ?? browserClock;

  /** The turn a finger is dragging. */
  let dragTurn: TurnInProgress | null = null;

  /**
   * The turn a press is playing out, and whether it ends in a page or back where it started.
   *
   * Held so that the next press can land this one rather than fight it: a reader leaning on the
   * arrow key repeats faster than a turn takes, and each `beginTurn` abandons the one before it —
   * so without this they would start a turn per repeat and finish none of them, and the book
   * would sit still under a held key.
   */
  let commanded: { turn: TurnInProgress; take: boolean } | null = null;

  /**
   * A turn from frond, with whatever is drawn over the page tied to the page it is drawn over.
   *
   * **Wrapped here rather than at each call site**, because a turn is put back by several routes
   * — released, bounced, swapped for the other page, cancelled by a press going somewhere else —
   * and every one of them ends at `cancel()`. A route added later gets this without knowing it
   * exists.
   *
   * **Committing is the one ending that does not put the layer back, and that is deliberate.**
   * The boxes on it were measured against the page that has just left; frond swaps the frames at
   * once, while the repaint that replaces those boxes waits for `relocate` to come back through
   * React. Snapping the layer home in between would draw the old page's marks over the new page
   * for a frame — the mark slides off the edge, blinks back at its old spot on the wrong page,
   * and then goes. Left where the turn carried them, the stale boxes are off the side of the book
   * and clipped until the repaint drops them.
   */
  const openTurn = (
    towards: TurnDirection,
    from: TurnEdge,
    source: TurnSource,
  ): TurnInProgress | undefined => {
    const turn = source.beginTurn(towards, from);
    if (turn === undefined) return undefined;

    return {
      extent: turn.extent,
      atBoundary: turn.atBoundary,
      hasPreview: turn.hasPreview,
      get live() {
        return turn.live;
      },
      moveTo: (distance) => {
        const at = turn.moveTo(distance);
        slide(at);
        return at;
      },
      commit: () => turn.commit(),
      cancel: () => {
        turn.cancel();
        slide(AT_REST);
      },
    };
  };

  /**
   * Slides a turn from one distance to another, then hands over to `finish`.
   *
   * The one animation runner both routes into a turn use. What separates them is the easing and
   * the time, which is why both are arguments rather than constants read in here: a turn that
   * finishes a drag carries on at the speed the finger left it at, and one the reader asked for
   * by pressing something starts from a standstill.
   *
   * `prefers-reduced-motion: reduce` lands it instantly. Following a finger is not affected by
   * that — direct manipulation is not an animation — but everything through here is.
   */
  const slideTurn = (
    turn: TurnInProgress,
    span: {
      readonly from: number;
      readonly to: number;
      readonly ms: number;
      readonly ease: (t: number) => number;
    },
    finish: () => void,
  ): void => {
    if (clock.reduceMotion() || span.from === span.to) {
      turn.moveTo(span.to);
      finish();
      return;
    }

    const startedAt = clock.now();
    const step = (now: number) => {
      // Something else moved the reader — a key, a jump, a resize. The turn is already over, and
      // frond has already put the frames back, so what was drawn over the page goes back too.
      if (!turn.live) {
        slide(AT_REST);
        return;
      }
      const t = Math.min(1, (now - startedAt) / span.ms);
      turn.moveTo(span.from + (span.to - span.from) * span.ease(t));
      if (t < 1) {
        clock.raf(step);
        return;
      }
      finish();
    };
    clock.raf(step);
  };

  // The tail of the gesture: slide the rest of the way, then take the turn or put it back. The
  // reader has done the moving up to this point, so it starts at the speed they left it at and
  // eases out.
  const settleTurn = (turn: TurnInProgress, from: number, to: number, take: boolean): void =>
    slideTurn(turn, { from, to, ms: TURN_SETTLE_MS, ease: easeOut }, () =>
      take ? turn.commit() : turn.cancel(),
    );

  /** Puts the turn in flight where it was going, now, so a new one can begin behind it. */
  const landCommand = (): void => {
    const held = commanded;
    commanded = null;
    if (held === null || !held.turn.live) return;
    held.turn.moveTo(held.take ? held.turn.extent : 0);
    if (held.take) held.turn.commit();
    else held.turn.cancel();
  };

  /**
   * A page turn nobody dragged: the page slides off and the next one follows it in.
   *
   * **The same turn the finger drives**, played by the clock instead — which is the reason this
   * is not simply `next()`. A reader on a desktop had no way to see which way the book went: the
   * page was replaced between two frames, and two pages of the same book in the same typeface
   * look alike enough that turning forward and turning back were the same event
   * (docs/specs/desktop-page-turn/spec.md).
   */
  const commandTurn = (towards: TurnDirection): void => {
    landCommand();
    const source = renderer();
    const edge = navigator()?.edgeFor(towards);
    if (source === null || edge === undefined) return;

    const turn = openTurn(towards, edge, source);
    if (turn === undefined) return;

    // A page to go to but nothing laid out behind the current one: sliding it across would move
    // the page off an empty screen and then cut to its destination. It turns the plain way
    // instead — the reader gets the page they asked for without watching it arrive, which is the
    // same trade `commit()` makes. This is the window right after the book opens or its settings
    // change, before the frames either side have caught up.
    if (!turn.hasPreview && !turn.atBoundary) {
      turn.cancel();
      void (towards === "next" ? source.next() : source.previous());
      return;
    }

    const take = !turn.atBoundary;
    commanded = { turn, take };
    const end = () => {
      if (commanded?.turn === turn) commanded = null;
      if (take) turn.commit();
      else turn.cancel();
    };

    if (take) {
      slideTurn(turn, { from: 0, to: turn.extent, ms: TURN_COMMAND_MS, ease: easeInOut }, end);
      return;
    }

    // The end of the book: out and back, with nothing behind it but the paper.
    const peak = turn.extent * BOUNCE_FRACTION;
    slideTurn(turn, { from: 0, to: peak, ms: BOUNCE_MS, ease: easeOut }, () =>
      slideTurn(turn, { from: peak, to: 0, ms: BOUNCE_MS, ease: easeOut }, end),
    );
  };

  return {
    run(intent: TurnIntent): void {
      switch (intent.kind) {
        case "beginTurn": {
          const source = renderer();
          // `undefined` from frond means there is no page that way. The machine hears about it on
          // the next move, as a turn that is not there, and gets to ask for one again.
          dragTurn =
            source === null ? null : (openTurn(intent.towards, intent.from, source) ?? null);
          return;
        }
        case "moveTurn":
          dragTurn?.moveTo(intent.distance);
          return;
        case "dropTurn": {
          const held = dragTurn;
          dragTurn = null;
          held?.cancel();
          return;
        }
        case "commitTurn": {
          const held = dragTurn;
          dragTurn = null;
          if (held !== null) settleTurn(held, intent.from, intent.to, true);
          return;
        }
        case "cancelTurn": {
          const held = dragTurn;
          dragTurn = null;
          if (held !== null) settleTurn(held, intent.from, intent.to, false);
          return;
        }
        case "commandTurn":
          commandTurn(intent.towards);
          return;
        default:
          // A turn intent nobody handled would otherwise be a page that does not move, which
          // nothing reports. This is what makes that a compile error instead.
          intent satisfies never;
      }
    },

    facts(): TurnFacts | null {
      return dragTurn === null
        ? null
        : { extent: dragTurn.extent, atBoundary: dragTurn.atBoundary };
    },
  };
}
