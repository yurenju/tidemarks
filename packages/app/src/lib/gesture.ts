// The gesture machine — what a *sequence* of pointer events adds up to.
//
// `touch.ts` answers "what is this one press": ten pixels of travel is a drag, half a second of
// stillness is a long press, a third of a page is a turn. This file answers the other half:
// **a press, some moves and a release, arriving in some order, mean what?** — which of them
// claims the gesture, and what happens to the other candidates when one of them does.
//
// That question used to have no interface at all. It lived in a thousand-line effect inside
// `Reader.tsx`, where seven handlers wrote to twelve shared `let`s and nothing but reading order
// said which of them ran first. The rules were tested; the interleaving was not, and neither was
// the one thing most likely to be wrong about it — whether every route out of a press remembers
// to call off the long-press clock.
//
// **Which side of the seam a number sits on is decided by who asks it**, not by whether it is
// arithmetic. `startsDrag` is asked by three callers and belongs to `touch.ts`; the two small
// predicates below are asked once each, from inside a transition, and reading them anywhere else
// would be reading them out of the state they are about. What CONTEXT.md 〈手勢〉 keeps is the
// rest of the shape of this module — the three things it refuses to touch, and why. It is not
// repeated here; two copies of a list is one copy that goes stale.
//
// The one part worth keeping next to the code is the trade behind the first refusal. ⚠️ **Holding
// no timer costs the threshold its unit test** — how long a press must be held is now one line of
// `setTimeout` in the caller. That was taken deliberately: a wrong threshold is something the
// reader feels on the first try, and a missing cancellation is not something anyone can report.

import type { TurnDirection, TurnEdge } from "@yurenju/frond/renderer";
import type { Navigator } from "./navigator";
import { handleAt, type Point, type SelectionEnds } from "./selection-handles";
import {
  commitsTurn,
  dampen,
  isTap,
  startsDrag,
  TAP_SELECTION_GRACE_MS,
  TAP_SLOP_PX,
} from "./touch";

// The window the release speed is measured over. Long enough to have two or three moves in it on
// a 60Hz screen, short enough that it is the flick and not the drag before it.
const VELOCITY_WINDOW_MS = 90;

// How many positions of a drag are kept. Enough to cover the velocity window at any frame rate;
// the rest is a drag the reader has already stopped making.
const TRAIL_SAMPLES = 8;

/**
 * What a turn in progress measures, as the caller sees it at this instant.
 *
 * `null` means the caller has no turn — either it was never begun, or frond refused one because
 * there is no page that way. The machine reads that as "the drag did not take", which is what
 * lets the next move try again.
 */
export interface TurnFacts {
  /** How far the page has to travel to be turned, in px. */
  readonly extent: number;
  /** There is nothing on the other side: the ends of the book. */
  readonly atBoundary: boolean;
}

/** Everything that can happen to a gesture, from all four surfaces it can arrive on. */
export type GestureEvent =
  | {
      kind: "press";
      x: number;
      y: number;
      /** `performance.now()`. One clock for the whole machine, so two events can be compared. */
      at: number;
      /** `PointerEvent.pointerType`: `'mouse'`, `'touch'`, `'pen'`, … */
      pointerType: string;
      isLink: boolean;
      /**
       * Something is selected at the moment the finger lands, so the reader is adjusting it and
       * the page must not move. Asked **at the press and only there**: a selection that appears
       * later is the platform's own long press, and by then the page is already following.
       */
      hasSelection: boolean;
    }
  | { kind: "move"; x: number; y: number; at: number; turn: TurnFacts | null }
  | {
      kind: "release";
      x: number;
      y: number;
      at: number;
      isLink: boolean;
      /** frond's answer about the browser's own selection inside the book's frame. */
      hasSelection: boolean;
      /** Whether the app is showing a selection it drew itself, which frond cannot see. */
      showingSelection: boolean;
      /** The id of the highlight under the finger, hit-tested by the caller. */
      onHighlight: string | null;
      turn: TurnFacts | null;
    }
  /** The system took the touch away: an edge gesture, a call coming in. No release follows. */
  | { kind: "cancel" }
  /** The caller's long-press clock has run out. */
  | { kind: "longPressFired" }
  /** There was no word under the long press — a margin, a picture, the gap between paragraphs. */
  | { kind: "selectionRefused" }
  /** A physical left/right input: an arrow key, or one of the two page buttons. */
  | { kind: "side"; side: "left" | "right" }
  /** A finger on one of the two ends of a selection the app drew. */
  | { kind: "handleDown"; end: "start" | "end"; point: Point; ends: SelectionEnds }
  | { kind: "handleMove"; point: Point }
  /**
   * A finger let go somewhere no surface of ours can see — over a page button beside the book,
   * or on a handle that captured the pointer. Whatever was being selected settles.
   */
  | { kind: "strayRelease" };

/**
 * One thing for the caller to do.
 *
 * **Flat on purpose.** One `kind` per action, with no nesting to switch on twice, so a caller
 * that forgets to handle one of them fails to compile rather than failing on a phone.
 */
export type GestureIntent =
  /** Start the clock that turns a still finger into a selection. */
  | { kind: "armLongPress" }
  /** Call it off: this press is no longer a candidate. */
  | { kind: "cancelLongPress" }
  /** The page starts following the finger. The caller answers with `TurnFacts` on the next move. */
  | { kind: "beginTurn"; towards: TurnDirection; from: TurnEdge }
  /** Put the turn this far across, damping already applied. */
  | { kind: "moveTurn"; distance: number }
  /** Put the turn back where it was, now, with no animation: it has been swapped or abandoned. */
  | { kind: "dropTurn" }
  /** Slide the rest of the way and take the page. */
  | { kind: "commitTurn"; from: number; to: number }
  /** Slide back to where it started and put the page down again. */
  | { kind: "cancelTurn"; from: number; to: number }
  /** A turn nobody dragged: it slides on its own (docs/specs/desktop-page-turn/spec.md). */
  | { kind: "commandTurn"; towards: TurnDirection }
  | { kind: "lowerChrome" }
  /** A tap: up if it was down, down if it was up. One press, one toggle, no timer (ADR-0020). */
  | { kind: "toggleChrome" }
  /** Select the word under this point — the long press has been held. */
  | { kind: "beginSelection"; at: Point }
  /** Take the selection out to where the finger is now, anchored at its far end. */
  | { kind: "extendSelection"; from: Point; to: Point }
  /** The finger is on the selection: 〈標〉 waits (CONTEXT.md 〈chrome〉). */
  | { kind: "holdSelection" }
  /** The finger has finished with it, so the colour row may stand up. */
  | { kind: "settleSelection" }
  /** Put the selection away entirely. */
  | { kind: "dropSelection" }
  | { kind: "openNote"; annotationId: string };

export interface GestureResponse {
  readonly intents: readonly GestureIntent[];
  /**
   * Whether the browser should be stopped from acting on this press as a tap of its own.
   *
   * **Not an intent**, and the separation is the point: every intent is something to do to the
   * book, and this is an answer about the event itself, which the caller has to give back to the
   * browser synchronously inside the listener. One member of an array meaning something different
   * from all the others is how a caller ends up handling it a frame too late.
   */
  readonly preventDefault: boolean;
}

export interface GestureMachine {
  send(event: GestureEvent): GestureResponse;
  /**
   * Whether a selection appearing now should be blamed on the last tap rather than on the reader.
   *
   * **Phone browsers select a word on a plain tap** — Chrome for Android's Touch to Search — and
   * frond reports that selection exactly as it reports a deliberate one (#36). What separates
   * them is not the DOM but when the tap was: this window closes on the next press, from which
   * moment the reader is driving again.
   */
  blamesTapForSelection(at: number): boolean;
}

/**
 * How far the *drag* has gone, which is not how far the finger has.
 *
 * The first `TAP_SLOP_PX` belong to deciding that this is a drag at all. Counting them in would
 * make the page jump by that much the instant the drag begins; leaving them out costs the page a
 * fixed lag of the same size, which is the trade every platform makes.
 */
function dragDistance(dx: number): number {
  if (Math.abs(dx) <= TAP_SLOP_PX) return 0;
  return dx > 0 ? dx - TAP_SLOP_PX : dx + TAP_SLOP_PX;
}

/**
 * Whether the finger has left the patch of screen a still one stays in.
 *
 * The distance half of the long press, asked as the finger moves rather than when the clock runs
 * out. Asking it late gets an ordinary press wrong: a press drifts a few pixels while it settles,
 * and if that drift is *downwards* it is not a page turn either (`startsDrag` is sideways-only,
 * ADR-0024) — so the press would fail the distance test at the threshold, never be reconsidered,
 * and do nothing at all however long it was held.
 */
function stillWithinSlop(dx: number, dy: number): boolean {
  return Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX;
}

/**
 * Where the page actually sits for a drag of this distance.
 *
 * Two rules in one place because they are the same question asked twice — once on every move, and
 * once at the release to say where the settle animation starts from. Written out at both would let
 * the page settle from somewhere it was never drawn.
 */
function shownDistance(distance: number, turn: TurnFacts): number {
  return turn.atBoundary ? dampen(distance, turn.extent) : Math.min(distance, turn.extent);
}

export function createGestureMachine(
  nav: Navigator,
  opts: {
    /**
     * Whether the pointer in the reader's hand gets the selection the app draws rather than the
     * browser's (ADR-0036).
     *
     * **Asked, not held.** A machine with both a touchscreen and a mouse is two devices, and the
     * answer changes under the reader's hand as they move between them. What must not disagree is
     * this and the book's `user-select`, so the caller owns the one answer and both read it from
     * there — a copy taken here would be the stale half of a book that selects two ways.
     */
    readonly ownSelection: () => boolean;
  },
): GestureMachine {
  const { ownSelection } = opts;

  // Where and when the pointer went down, and the facts about that instant that decide what the
  // press may become. frond deliberately does not pair a press with a release (its ADR-0002).
  let press: {
    x: number;
    y: number;
    at: number;
    pointerType: string;
    isLink: boolean;
    hadSelection: boolean;
  } | null = null;

  // The selection the finger is making, and the point it is being made away from.
  //
  // **One field for two gestures**, because they are the same gesture from here: a long press
  // fixes the anchor where the finger landed and extends from it, and dragging a handle fixes it
  // at the *other* end and extends from that. Neither can run while the page is being dragged.
  let selecting: { anchor: Point } | null = null;

  // Whether the caller's long-press clock is running. Held so that a cancellation is only asked
  // for when there is something to cancel — which is what makes "did this route call it off"
  // answerable at all.
  let armed = false;

  // The turn the finger is dragging. `sign` is which way it is going, so dragging back the other
  // way can swap it for the other page rather than leaving the reader pushing at a dead one.
  let drag: { sign: number } | null = null;

  // The last few positions of the drag, for how fast it was going when the finger left. A flick
  // is short and quick, and distance alone cannot tell it from a nudge.
  let trail: { travel: number; at: number }[] = [];

  // When the last tap ended. Zeroed on the next press: from that moment the reader is driving.
  let tappedAt = 0;

  function speedAtRelease(): number {
    const last = trail[trail.length - 1];
    if (last === undefined) return 0;
    const first = trail.find((sample) => last.at - sample.at <= VELOCITY_WINDOW_MS);
    if (first === undefined || first.at === last.at) return 0;

    // Measured along the drag's own direction: a finger that turned back at the last moment was
    // not flicking forward, and its speed should not carry the page over.
    const advanced = Math.abs(last.travel) - Math.abs(first.travel);
    return Math.max(0, advanced / (last.at - first.at));
  }

  /** Calls off the long-press clock, and says whether there was one to call off. */
  function disarm(into: GestureIntent[]): void {
    if (!armed) return;
    armed = false;
    into.push({ kind: "cancelLongPress" });
  }

  /** The finger has finished with the selection, if one was being made. */
  function settle(into: GestureIntent[]): void {
    if (selecting === null) return;
    selecting = null;
    into.push({ kind: "settleSelection" });
  }

  function onPress(
    event: Extract<GestureEvent, { kind: "press" }>,
    intents: GestureIntent[],
  ): boolean {
    press = {
      x: event.x,
      y: event.y,
      at: event.at,
      pointerType: event.pointerType,
      isLink: event.isLink,
      hadSelection: event.hasSelection,
    };
    // The reader is driving from here on, so a selection is theirs again.
    tappedAt = 0;

    // A finger held still on the text chooses a word (ADR-0036). Only a finger, and only where
    // the selection is ours to make: under a mouse the browser is still doing this.
    disarm(intents);
    selecting = null;
    if (ownSelection() && event.pointerType !== "mouse") {
      armed = true;
      intents.push({ kind: "armLongPress" });
    }

    // ## Whose press this is
    //
    // The browser does not get to act on it as a tap of its own — that is the search bar in #36,
    // and this is the only moment early enough to stop it. **The mechanism was measured, and it
    // is not the one Chrome's documentation names**: making the text unselectable only made the
    // bar rarer on a real phone (21% of taps against 72%), while cancelling the tap's own default
    // stopped it, 0 in 15 (#40, frond #80).
    //
    // Only a finger — a mouse press has no `touchend` to cancel — and never on a link: the
    // suppressed press loses its `click`, and the click is how a footnote marker opens.
    //
    // What is deliberately *not* asked is where it landed, nor how long it will last. A long
    // press is a page turn that has not finished yet as far as this moment can tell, and waiting
    // to find out is waiting until after the browser has decided.
    return event.pointerType !== "mouse" && !event.isLink;
  }

  function onMove(event: Extract<GestureEvent, { kind: "move" }>, intents: GestureIntent[]): void {
    const started = press;
    if (started === null) return;

    // The finger is making a selection: it is not going to turn a page with the same stroke.
    if (selecting !== null) {
      intents.push({
        kind: "extendSelection",
        from: selecting.anchor,
        to: { x: event.x, y: event.y },
      });
      return;
    }

    const dx = event.x - started.x;
    const dy = event.y - started.y;

    // A finger that has travelled is no longer a still one, whichever way it went. Asked of the
    // raw travel and not of `startsDrag`, because a finger going down the page turns nothing and
    // is still moving.
    if (!stillWithinSlop(dx, dy)) disarm(intents);

    // A mouse turns no page: the desktop has the edge buttons and the arrow keys, and a drag
    // there is how text is selected.
    if (started.pointerType === "mouse") return;
    // **Where the selection is ours, a standing one no longer stops the page.** That rule was the
    // compensation for not knowing where the finger had landed. The handles are ours now and they
    // claim their own presses, so a press anywhere else is what it looks like.
    if (!ownSelection() && started.hadSelection) return;

    const travel = dragDistance(dx);

    // The caller has no turn: either one was asked for and frond refused it — there is no page
    // that way — or this drag never began. Either way the next test gets to ask again.
    if (drag !== null && event.turn === null) drag = null;

    // Whether this frame is the one that asked for a turn, in which case there is nothing yet to
    // move: how far the page may travel and whether it is against the end of the book are the
    // turn's own measurements, and the caller has not made them. It costs the first frame of a
    // drag, where the finger is a pixel past the slop and the page has barely anywhere to go.
    let asking = false;

    if (drag === null) {
      if (!startsDrag(dx, dy)) return;
      drag = { sign: Math.sign(travel) };
      trail = [];
      asking = true;
      intents.push({ kind: "beginTurn", ...nav.dragTowards(travel) });
      // The press has become a page turn, so whatever was selected goes with the page it was on.
      // Done at the start of the drag rather than when it commits, because a drag that springs
      // back has still spent this press: leaving the wash standing under a page the reader just
      // pushed at reads as the selection having survived something it did not.
      intents.push({ kind: "dropSelection" });
    } else if (travel !== 0 && Math.sign(travel) !== drag.sign) {
      // Dragged back past where it started and on the other way: that is the other page being
      // asked for, so the turn is swapped rather than pinned at zero.
      intents.push({ kind: "dropTurn" });
      drag = { sign: Math.sign(travel) };
      trail = [];
      asking = true;
      intents.push({ kind: "beginTurn", ...nav.dragTowards(travel) });
    }

    trail.push({ travel, at: event.at });
    if (trail.length > TRAIL_SAMPLES) trail.shift();

    if (asking || event.turn === null) return;

    intents.push({ kind: "moveTurn", distance: shownDistance(Math.abs(travel), event.turn) });
  }

  function endDrag(turn: TurnFacts | null, intents: GestureIntent[]): void {
    drag = null;
    if (turn === null) return;

    const distance = Math.abs(trail[trail.length - 1]?.travel ?? 0);
    const shown = shownDistance(distance, turn);
    const take =
      !turn.atBoundary &&
      commitsTurn({ distance, extent: turn.extent, velocity: speedAtRelease() });

    if (!take) {
      intents.push({ kind: "cancelTurn", from: shown, to: 0 });
      return;
    }
    // **A page turn puts the chrome away**, this route included. Asked for before the animation
    // rather than after it, so the bars are not still sliding over a page that has turned.
    intents.push({ kind: "lowerChrome" });
    intents.push({ kind: "commitTurn", from: shown, to: turn.extent });
  }

  function onRelease(
    event: Extract<GestureEvent, { kind: "release" }>,
    intents: GestureIntent[],
  ): void {
    const started = press;
    press = null;
    disarm(intents);

    // A selection was being made, and this press is spent on having made it. Nothing else may
    // read the release: it neither raises the chrome nor puts the selection back down.
    if (selecting !== null) {
      settle(intents);
      return;
    }

    if (drag !== null) {
      endDrag(event.turn, intents);
      return;
    }

    const dx = event.x - (started?.x ?? event.x);
    const dy = event.y - (started?.y ?? event.y);
    const ms = event.at - (started?.at ?? event.at);

    if (!isTap(dx, dy, ms)) {
      // A drag or a long press. The drag turned its page while the finger was still down, and the
      // long press was choosing text; neither leaves anything for the release to spend.
      return;
    }

    // A tap that landed on a highlight opens its note, and is spent on that.
    if (event.onHighlight !== null) {
      intents.push({ kind: "openNote", annotationId: event.onHighlight });
      return;
    }

    // Whatever is selected after a tap was not chosen by that tap: either the browser took a word
    // out of it (#36), or it was already there and the reader has just asked for it to go away.
    // Tapping is the only way to put a selection down by hand now that it does not also turn.
    tappedAt = event.at;
    // `hasSelection` is frond's answer about the browser's own selection, and where the app draws
    // its own that answer is permanently no — so what is on screen has to be asked as well, or a
    // tap would stop being the way to dismiss a selection on exactly the devices where it is the
    // only way.
    const dismissing =
      started?.hadSelection === true || event.hasSelection || event.showingSelection;
    if (dismissing) intents.push({ kind: "dropSelection" });

    // A tap nothing else has a claim on is what raises the chrome — or puts it back down, which is
    // the same tap seen from the other state. A tap on a link belongs to the link, and one spent
    // on dismissing a selection is spent: one press, one thing.
    if (!event.isLink && !dismissing) intents.push({ kind: "toggleChrome" });
  }

  function onCancel(intents: GestureIntent[]): void {
    press = null;
    disarm(intents);
    // The system took the finger away mid-selection. What has been selected so far stands and
    // settles, exactly as if the finger had lifted: dropping it would be taking the reader's work
    // away over something they did not do.
    settle(intents);
    if (drag !== null) {
      drag = null;
      intents.push({ kind: "dropTurn" });
    }
  }

  function onLongPressFired(intents: GestureIntent[]): void {
    armed = false;
    const started = press;
    // The press is over, or it has already become a page turn. Either way there is no still
    // finger left for the word to belong to.
    if (started === null || drag !== null) return;
    // The point is where the finger *landed*, not where it is now: the distance half of this
    // decision was asked on every move, and a press that drifted a few pixels is still this word.
    selecting = { anchor: { x: started.x, y: started.y } };
    intents.push({ kind: "beginSelection", at: { x: started.x, y: started.y } });
  }

  function onHandleDown(
    event: Extract<GestureEvent, { kind: "handleDown" }>,
    intents: GestureIntent[],
  ): void {
    // **Which handle, asked of the geometry rather than of the element.** A long press selects one
    // word, and one word puts the two hit regions on top of each other; the press then goes to
    // whichever button the DOM has on top, which need not be the one the reader was aiming at.
    // `handleAt` answers with the nearer, and the element's own answer stands only where the point
    // is outside both — which a press in the corner of a 44px square can be.
    const grabbed = handleAt(event.point, event.ends) ?? event.end;
    // The end being dragged is the one that moves, so the anchor is **the other one** — which is
    // the whole difference between this and a long press, and why both can share `selecting`.
    selecting = {
      anchor: grabbed === "start" ? event.ends.end.anchor : event.ends.start.anchor,
    };
    intents.push({ kind: "holdSelection" });
  }

  return {
    send(event: GestureEvent): GestureResponse {
      const intents: GestureIntent[] = [];
      let preventDefault = false;

      switch (event.kind) {
        case "press":
          preventDefault = onPress(event, intents);
          break;
        case "move":
          onMove(event, intents);
          break;
        case "release":
          onRelease(event, intents);
          break;
        case "cancel":
          onCancel(intents);
          break;
        case "longPressFired":
          onLongPressFired(intents);
          break;
        case "selectionRefused":
          // There was nothing to select under the finger, so the press carries on being whatever
          // it would otherwise have been — a tap, or a drag if it starts travelling.
          selecting = null;
          break;
        case "side":
          // A page turn puts the chrome away, whichever route asked for it (CONTEXT.md 〈chrome〉).
          intents.push({ kind: "lowerChrome" });
          intents.push({ kind: "commandTurn", towards: nav.onSide(event.side) });
          break;
        case "handleDown":
          onHandleDown(event, intents);
          break;
        case "handleMove":
          if (selecting !== null) {
            intents.push({ kind: "extendSelection", from: selecting.anchor, to: event.point });
          }
          break;
        case "strayRelease":
          settle(intents);
          break;
      }

      return { intents, preventDefault };
    },

    blamesTapForSelection(at: number): boolean {
      return tappedAt !== 0 && at - tappedAt < TAP_SELECTION_GRACE_MS;
    },
  };
}
