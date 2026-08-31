/**
 * Where the reader is in the book they have open, as one value with one writer.
 *
 * ## Why these five facts are one module
 *
 * "Where is the reader" is really five questions, and answering them separately is what used to
 * go wrong:
 *
 * - `position` — what this device claims about the book. It is what syncs.
 * - `screen` — the page in front of their eyes. The same row as `position` while they are
 *   simply reading, and a hundred pages from it during a visit.
 * - `visit` — the progress a visit is defending, or `null` while they are reading (`visit.ts`).
 * - `offer` — a position another device wrote, offered and not yet answered (`elsewhere.ts`).
 * - `ready` — whether the book is on screen yet, which decides whether an offer can be shown.
 *
 * Every one of them moves in step with the others: taking an offer ends a visit, refusing one
 * writes the screen's row as the position, and a `relocate` during a visit moves `screen`
 * alone. Held apart, each of those is a rule somebody has to remember at the call site; held
 * here, they are one transition with one name.
 *
 * ## The shape
 *
 * A reducer, like `chrome.ts`: events in, next state and a list of effects out. Nothing here
 * touches Dexie, the network, the renderer or a clock — the caller reads the clock and hands
 * the reading in, and carries out the effects. That is what makes the *ordering* testable,
 * which is the half that `visit.ts` and `elsewhere.ts` cannot see from where they stand: they
 * answer whether a jump begins a visit and whether an arriving row is worth a banner, and every
 * bug this module exists to prevent was in *when* those answers were asked.
 *
 * ⚠️ **The caller holds this in a ref, not in state.** frond's `relocate` is a callback that
 * has to read the current value at the moment the page moves, which is exactly what a React
 * render cannot promise. `Reader.tsx` keeps the ref authoritative and projects the two fields
 * the screen draws from into state after each dispatch.
 */
import type { At } from "./route";
import type { Progress } from "./types";
import { entersVisit, leavesVisit } from "./visit";
import { elapsedSince, positionFromElsewhere, type Elapsed } from "./elsewhere";

// Re-exported so that the banner's wording can name the reading it prints without reaching past
// this module for it: `elsewhere.ts` is behind this seam now.
export type { Elapsed };

/** A position from another device, with how long ago it was written read once on arrival. */
export interface Offer {
  readonly position: Progress;
  readonly elapsed: Elapsed;
}

export interface Place {
  /**
   * Which book every other field is about.
   *
   * Carried so that a row arriving for another book can be ignored rather than measured against
   * this one. Opening a book is a chain of awaits and a sync round can land anywhere inside it;
   * with the book named in both the state and the event, that case is a mismatch rather than a
   * window somebody has to remember to close.
   */
  readonly bookId: string;
  /** What this device claims about the book. `null` until the saved position has been read. */
  readonly position: Progress | null;
  /** The page in front of the reader, which during a visit is not `position`. */
  readonly screen: Progress | null;
  /** The progress a visit is defending, or `null` while the reader is simply reading. */
  readonly visit: Progress | null;
  /** An offer from elsewhere, held until the reader answers it. */
  readonly offer: Offer | null;
  /**
   * Whether the book is on screen.
   *
   * An offer arriving before this is true is held rather than shown: the banner is drawn over
   * the whole reader, so it would stand over a blank viewer, and the two buttons under it both
   * need a renderer that does not exist yet.
   */
  readonly ready: boolean;
  /**
   * The last whole-book fraction the index reported for the page on screen, or `null` while it
   * is still building.
   *
   * **Not `position.percentage`**, which stands in the last fraction it knew when the index has
   * no answer yet — a real number to render a bar from, and not one a displacement may be
   * measured against. `stats.ts` drops a sitting whose ends are `null` for exactly that reason,
   * so a `groundCovered` carrying a stand-in would turn a sitting the device could not place
   * into one it claims to have placed at zero.
   */
  readonly fraction: number | null;
}

export type PlaceEvent =
  /** A book was opened. Nothing is known about it yet, and nothing of the last one survives. */
  | { kind: "opened"; bookId: string }
  /**
   * The saved position has been read out of storage, along with the address the book was opened
   * at. **Both are settled here, before the first layout**, because the layout emits a
   * `relocate` that would otherwise write the passage over the reader's progress.
   */
  | { kind: "recalled"; bookId: string; saved?: Progress; at?: At }
  /** The book is on screen. */
  | { kind: "ready"; bookId: string }
  /** frond reported the page moving. `fraction` is absent until the whole-book index exists. */
  | { kind: "relocated"; bookId: string; position: Progress; fraction?: number }
  /** A sync round brought this book's position from another device. */
  | { kind: "pulled"; bookId: string; position: Progress; now: number }
  /**
   * The reader asked to go back to a marked passage.
   *
   * `pageRange` is **the page on screen right now**, read from the renderer rather than from the
   * stored position — see `visit.ts` for why the stored one answers the wrong question. `null`
   * where there is no page to compare against, which is also the answer when no book is up.
   */
  | { kind: "passageAsked"; bookId: string; target: string; pageRange: string | null }
  /** [[Go there]] on the banner. */
  | { kind: "offerTaken" }
  /** [[Stay here]] on the banner: the page on screen is where the reader is. */
  | { kind: "stayedHere"; now: number }
  /** The visit mark on the Scrubber: the way back to where reading stopped. */
  | { kind: "markPressed" };

export type PlaceEffect =
  /** Write the reader's progress — every store that holds one, and a sync round after it. */
  | { kind: "recordPosition"; position: Progress }
  /** Move the book. */
  | { kind: "goToCfi"; cfi: string }
  /**
   * This much of the book has been covered in this sitting, for `stats.ts` to read off the
   * reading session. Emitted only for a move that is really reading: ground covered during a
   * visit is a displacement of zero, and counting the minutes against it would report the
   * reader as slower than they are.
   */
  | { kind: "groundCovered"; fraction: number };

interface Step {
  readonly state: Place;
  readonly effects: readonly PlaceEffect[];
}

/** A book nobody has placed the reader in yet. */
export function placeFor(bookId: string): Place {
  return {
    bookId,
    position: null,
    screen: null,
    visit: null,
    offer: null,
    ready: false,
    fraction: null,
  };
}

const still = (state: Place): Step => ({ state, effects: [] });

export function nextPlace(state: Place, event: PlaceEvent): Step {
  switch (event.kind) {
    case "opened":
      return still(placeFor(event.bookId));

    case "recalled": {
      if (event.bookId !== state.bookId) return still(state);
      const saved = event.saved;
      // **Only a `cfi:` address opens a visit**: it is the one that names a passage. A chapter
      // or a fraction is a place, and going to a place is reading, not visiting one of your own
      // marks.
      const visiting =
        event.at?.kind === "cfi" &&
        saved !== undefined &&
        entersVisit(saved.pageRange, event.at.cfi);
      return still({
        ...state,
        position: saved ?? null,
        visit: visiting && saved !== undefined ? saved : null,
      });
    }

    case "ready":
      if (event.bookId !== state.bookId) return still(state);
      return still({ ...state, ready: true });

    case "relocated": {
      if (event.bookId !== state.bookId) return still(state);
      // The screen has moved whatever else is true — everything below this line is the claim
      // that this is where the reader *is* in the book, and a visit is not that claim.
      // The fraction is noted whether or not this move counts as reading: it is a fact about
      // where the page is, and a visit holds the *ground* still, not the index's answer.
      const moved: Place = {
        ...state,
        screen: event.position,
        fraction: event.fraction ?? state.fraction,
      };
      if (state.visit !== null) {
        if (!leavesVisit(state.visit, event.position)) return still(moved);
      }
      const effects: PlaceEffect[] = [];
      if (event.fraction !== undefined)
        effects.push({ kind: "groundCovered", fraction: event.fraction });
      effects.push({ kind: "recordPosition", position: event.position });
      return { state: { ...moved, visit: null, position: event.position }, effects };
    }

    case "pulled": {
      if (event.bookId !== state.bookId) return still(state);
      // Nothing to measure against yet — the open is still downloading or parsing. Saying
      // nothing is right: the position is about to be picked up by the open itself, and a
      // refusal would have nothing of this device's to write in its place.
      if (state.position === null) return still(state);
      const offered = positionFromElsewhere(state.position, event.position);
      if (offered === null) return still(state);
      // **An offer already standing is replaced, never taken away** — only a fresher one
      // displaces it, and answering it is the reader's to do.
      return still({
        ...state,
        offer: { position: offered, elapsed: elapsedSince(offered.lastReadAt, event.now) },
      });
    }

    case "passageAsked": {
      if (event.bookId !== state.bookId) return still(state);
      const jump: PlaceEffect[] = [{ kind: "goToCfi", cfi: event.target }];
      // A second passage during a visit is still the same visit: what is being kept is where
      // the reader stopped reading, and that did not change when they tapped another mark.
      if (state.visit !== null) return { state, effects: jump };
      // Nothing to defend. `position` is null only before the first `relocate` of a book that
      // has never been read, and there is no progress to lose there.
      if (state.position === null) return { state, effects: jump };
      if (!entersVisit(event.pageRange, event.target)) return { state, effects: jump };
      return { state: { ...state, visit: state.position }, effects: jump };
    }

    case "offerTaken": {
      if (state.offer === null) return still(state);
      // **It ends a visit as well**, and has to: pressing this is the reader saying that other
      // place is where they are. Left standing, the visit would swallow the very `relocate`
      // this navigation causes whenever the offer is behind what is being kept.
      return {
        state: { ...state, visit: null, offer: null },
        effects: [{ kind: "goToCfi", cfi: state.offer.position.cfi }],
      };
    }

    case "stayedHere": {
      // Where the reader is looking, which during a visit is not what this device claims.
      const here = state.screen ?? state.position;
      // Never null while a banner is up — the offer is only made once this device knows where
      // it is, which is the same guard that keeps this from being a button that does nothing.
      if (here === null) return still(state);
      const kept: Progress = { ...here, lastReadAt: event.now, dirtyAt: event.now };
      // **This is the one move that carries progress backwards.** The rule during a visit is
      // that progress only goes forward, which is a rule about what happens on its own; a
      // reader who presses this has said where they are, and being told "no, you are still a
      // hundred pages on" is the button doing nothing.
      const effects: PlaceEffect[] = [];
      // **The ground covered comes back with it.** A visit holds that measure still along with
      // the progress, and this is the one move that ends a visit without reading forward — so
      // left alone, a reader who answers the banner and closes the book straight after is
      // recorded as having read to a page they have just disowned, and `stats.ts` counts it.
      //
      // ⚠️ **The index's own answer, never `kept.percentage`.** That field stands in the last
      // fraction the reader had when the index has not finished building, and `0` for a book
      // never opened — reporting one would place a sitting that nothing could place, which is
      // the case `stats.ts` drops rather than reads as "moved nowhere".
      if (state.visit !== null && state.fraction !== null) {
        effects.push({ kind: "groundCovered", fraction: state.fraction });
      }
      effects.push({ kind: "recordPosition", position: kept });
      return {
        state: { ...state, visit: null, offer: null, position: kept, screen: kept },
        effects,
      };
    }

    case "markPressed": {
      if (state.visit === null) return still(state);
      // **The CFI, not the fraction the mark is drawn at.** A fraction is rounded to a page
      // boundary on the way in — measured: a mark standing at 47% landed at 43% — and the
      // reader pressing this is asking for the page they left.
      //
      // Nothing here ends the visit: arriving is what ends it. The `relocate` this causes
      // reaches the gate above with a position at or past what is being kept.
      return { state, effects: [{ kind: "goToCfi", cfi: state.visit.cfi }] };
    }

    default:
      // An event nothing here answers is a move the reader makes and never gets, and nothing
      // reports that. This is what makes it a compile error instead.
      event satisfies never;
      return still(state);
  }
}

/**
 * The offer the banner may draw, which is not the same as the offer being held.
 *
 * An offer that arrived while the book was still opening is kept — it is the reader's to answer
 * and nothing may throw it away — but it is not shown until there is a book under it. Before
 * that the banner would stand over a blank viewer, and both of its buttons need a renderer that
 * does not exist yet: [[Go there]] would navigate nothing and then clear the offer for good.
 */
export function bannerOffer(state: Place): Offer | null {
  return state.ready ? state.offer : null;
}
