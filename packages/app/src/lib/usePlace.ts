import { useEffect, useRef, useState, type RefObject } from "react";
import type { Renderer } from "@yurenju/frond/renderer";
import { rememberPosition } from "./position-store";
import { notePosition, scheduleSync, subscribePulledProgress } from "./sync";
import {
  bannerOffer,
  nextPlace,
  placeFor,
  type Offer,
  type Place,
  type PlaceEffect,
  type PlaceEvent,
} from "./place";
import type { Progress } from "./types";

/**
 * Everything around `lib/place.ts`: who holds the reducer's state, when it is dispatched to, what
 * its effects do, and the two facts the screen draws from.
 *
 * The reducer was lifted out of `Reader.tsx` and tested on its own, and the layer wrapping it —
 * two copies of the state, the effect runner, the pull subscription, the three actions — stayed
 * behind. The rules were gone from that file and the three hundred lines keeping them were not,
 * which is why extracting a pure function on its own never made the reader any smaller.
 *
 * ## ⚠️ Why `dispatch` hangs off a ref
 *
 * Same reason as `lib/useSelection.ts`, and the same trap: the effect that opens a book depends on
 * `[bookId]` alone, so it runs **once per book** and whatever it closes over must always point at
 * *now*. It reads `dispatch.current(...)`, and those seven characters are the whole of the
 * reminder that the value is being read at the moment of the call rather than at render time.
 *
 * ## What stays in `Reader.tsx`
 *
 * frond's `relocate` callback, which is the one place outside this file that has anything to say
 * here — it hands the move down as a `relocated` event. The banner is `ElsewhereBanner.tsx`, drawn
 * from the two fields returned here; where in the chrome's grid it sits is the reader's question,
 * not this one's.
 */

/**
 * The three things that happen every time the reader's position changes, in the order they have
 * to happen in.
 *
 * Written once because a page turn is not the only thing that moves the position: turning down an
 * offer from another device writes one too, and that write is the whole of what the refusal means
 * (`lib/elsewhere.ts`).
 */
function recordPosition(position: Progress): void {
  // Not `db.progress.put` on its own: that write is unawaited, and a reload landing before it
  // commits used to come back holding the page before this one (#173).
  rememberPosition(position);
  // Also handed to sync as a plain value, so switching app can push it without waiting on an
  // IndexedDB read first (`beaconPositions`).
  notePosition(position);
  scheduleSync();
}

/**
 * Where this sitting began and where it got to, for the reading session written on the way out
 * (`lib/stats.ts`).
 *
 * `null` until a `relocate` carries a fraction: until then the reader is in the book but not yet
 * placed in it, and 0 would be the claim that they are at the front of it. Both ends are the book
 * open effect's to reset and to read — all this hook does is keep them up to date, from the
 * `groundCovered` effect the reducer emits.
 */
export interface Ground {
  from: number | null;
  to: number | null;
}

export interface PlaceHook {
  /** The progress a visit is defending, for the Scrubber's mark (ADR-0040). */
  visit: Progress | null;
  /** The offer worth putting a banner up for, or `null` when there is nothing to answer. */
  offer: Offer | null;
  /** Hands one event to the place. Read through `.current` — see the note at the top of this file. */
  dispatch: RefObject<(event: PlaceEvent) => void>;
  ground: RefObject<Ground>;
  /** [[Go there]] on the banner. */
  goElsewhere: () => void;
  /** [[Stay here]] on the banner. */
  stayHere: () => void;
  /** Go back to a marked passage from the notes panel. */
  visitPassage: (target: string) => void;
}

export function usePlace({
  bookId,
  renderer,
}: {
  bookId: string;
  /** frond's renderer, which the reducer's `goToCfi` moves and `passageAsked` reads a page off. */
  renderer: RefObject<Renderer | null>;
}): PlaceHook {
  /**
   * Where the reader is in this book: what this device claims, what is on screen, whether a
   * visit is holding, and whether another device has offered a position (`lib/place.ts`).
   *
   * **The ref is the value and the state is a picture of it.** frond's `relocate` closed over its
   * scope pages ago and has to read the place as it is *now*, which is exactly what a render
   * cannot promise — so every rule about how the five facts move together lives in the reducer,
   * and `send` below is the only writer of either copy.
   */
  const placeRef = useRef<Place>(placeFor(bookId));
  /** The two fields the screen draws from: the Scrubber's mark, and the banner. */
  const [placeView, setPlaceView] = useState<{ visit: Progress | null; offer: Offer | null }>({
    visit: null,
    offer: null,
  });
  const ground = useRef<Ground>({ from: null, to: null });

  /** Carries out one thing the place asked for. */
  function runPlaceEffect(effect: PlaceEffect): void {
    switch (effect.kind) {
      case "recordPosition":
        recordPosition(effect.position);
        return;
      case "goToCfi":
        void renderer.current?.goToCfi(effect.cfi);
        return;
      case "groundCovered":
        ground.current.from ??= effect.fraction;
        ground.current.to = effect.fraction;
        return;
      default:
        // An effect the reducer can ask for and nothing here carries out is a write the reader
        // never gets, and nothing reports that. This is what makes it a compile error instead.
        effect satisfies never;
    }
  }

  /**
   * Hands one event to the place and carries out what comes back.
   *
   * ⚠️ **The ref moves first, then the picture, then the effects.** A `relocate` arriving
   * during the same turn has to see the state this event produced — that is the whole reason
   * the ref is authoritative — and the effects are run last because `recordPosition` is what
   * the new state means, not what produces it.
   */
  const send = (event: PlaceEvent): void => {
    const { state, effects } = nextPlace(placeRef.current, event);
    placeRef.current = state;
    const shown = bannerOffer(state);
    setPlaceView((now) =>
      now.visit === state.visit && now.offer === shown ? now : { visit: state.visit, offer: shown },
    );
    for (const effect of effects) runPlaceEffect(effect);
  };
  // Renewed on every render, and read through `.current` so the book's open effect — which ran
  // once, before any of this render existed — reaches the current one. See the note at the top.
  const dispatch = useRef(send);
  dispatch.current = send;

  /**
   * Listen for a position arriving from another device while this book is open.
   *
   * **An offer already standing is never taken away by a later pull** — only replaced by a
   * fresher one. It is the reader's to answer, and a banner that vanished on its own would take
   * the other device's position with it (`lib/elsewhere.ts`).
   */
  useEffect(() => {
    return subscribePulledProgress((rows) => {
      const arrived = rows.find((row) => row.bookId === bookId);
      // Whether there is anything worth interrupting the reader for, and whether this device
      // even knows where it is yet, are both the reducer's questions (`lib/place.ts`). The
      // book this round is about is named in the event, so a row arriving for the book that
      // was just closed is a mismatch rather than a yardstick.
      if (arrived !== undefined) {
        dispatch.current({ kind: "pulled", bookId, position: arrived, now: Date.now() });
      }
    });
  }, [bookId]);

  return {
    visit: placeView.visit,
    offer: placeView.offer,
    dispatch,
    ground,

    /**
     * Go back to a marked passage from the notes panel, holding on to where the reader had read.
     *
     * ⚠️ **The page is read from `renderer.location`, not from the stored position.** `relocate`
     * de-duplicates on section, page, fraction and CFI, and `pageRange` is in none of them — so a
     * reflow that leaves the reader on the same page of the same CFI is swallowed, and the stored
     * range still describes the layout before it. Opening this very panel is that reflow on a
     * desk, where the book gives up a column for it. Asking the stored range there would answer
     * "somewhere else" about a passage in front of the reader's eyes, and freeze the reader's
     * progress for a jump that never happened.
     *
     * The progress being defended still comes from the place's own row: it is the whole row, and
     * it is what a `relocate` has to be measured against to say the visit is over.
     *
     * **A visit itself draws nothing over the book.** All it raises is the mark on the Scrubber
     * (ADR-0040) — the way back to where reading stopped. The wash that does appear over the
     * passage is not the visit's and does not answer the same question: it says *which mark the
     * panel is pointing at*, it is gone the moment the panel is, and it appears whether or not a
     * visit was entered at all. What ADR-0040 refuses is a banner announcing the jump, and there
     * is still none.
     */
    visitPassage: (target) =>
      send({
        kind: "passageAsked",
        bookId,
        target,
        // No book on screen answers the same as no page to compare against, and both mean the
        // jump writes the passage as the position — wrong, but the answer with the fewest moving
        // parts for a case that needs a book on screen and no position in hand.
        pageRange: renderer.current?.location?.pageRange ?? null,
      }),

    /**
     * Take the offer. The `relocate` that follows writes the position, as it does for any move.
     *
     * **It ends a visit as well**, and has to. A visit can be on while this banner stands — the
     * reader went back to a marked passage, and a pull landed on top of it — and pressing this is
     * them saying that other place is where they are. Left standing, the visit would swallow the
     * very `relocate` this navigation causes whenever the offer is behind what is being kept: the
     * reader accepts a position and this device records nothing.
     */
    goElsewhere: () => send({ kind: "offerTaken" }),

    /**
     * Turn the offer down — **by writing where the reader is**, not by hiding the banner.
     *
     * The pull put the other device's position into Dexie before this banner ever appeared. Close
     * the banner without writing and the reader who said "stay here" gets that other position
     * back the next time they open the book, which is the opposite of what they pressed. Staying
     * here has to be a write, and it is the same write a page turn makes.
     *
     * **It ends a visit too, and that is the one move that carries progress backwards** — the
     * only one left in the app, since the one thing a visit does put on screen carries the reader
     * forward to their progress rather than the progress back to them (ADR-0040). It is only
     * reachable while a banner from another device happens to be standing. The rule
     * during a visit is that progress only goes forward (`lib/visit.ts`), which is a rule about
     * what happens on its own; a reader who presses this has said where they are, and being told
     * "no, you are still a hundred pages on" is the button doing nothing.
     */
    stayHere: () => send({ kind: "stayedHere", now: Date.now() }),
  };
}
