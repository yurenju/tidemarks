// Navigator — owns "which way is forward in this book", and nothing else.
//
// Three questions, and they all come out of the same one fact: a right-to-left book opens from
// the right, so leftwards is forward in it. Which page a physical left/right input asks for,
// which page a drag of this direction asks for, and which edge a page the reader *asked* for
// arrives from. One `rtl` behind all three, because a book that inverted one of them and not
// another is a book whose next page slides in from the side it is leaving towards.
//
// **What it does not own is what a gesture is.** Whether a press was a tap, whether the browser
// should be stopped from acting on it, what happens to a long press that starts travelling —
// those are `lib/gesture.ts`, which asks this module the direction questions and nothing more.
//
// Nor does it own section-edge crossing any more. Under epub.js, walking to the next spine item
// at the end of a vertical section was ours to do, and doing it needed the container's scroll
// geometry — which is why `RenditionPort` existed at all. frond's `next()` and `previous()`
// continue into the neighbouring section themselves, so that whole seam collapsed.

import type { PageProgressionDirection } from "@yurenju/frond/epub";
import type { TurnDirection, TurnEdge } from "@yurenju/frond/renderer";
// `.js` for the same reason as `gesture.ts`: the browser tests pull this file into a graph
// compiled under node16 resolution, where the extension is required.
import { incomingEdge } from "./touch.js";

/**
 * Which way this book turns pages — **one answer for the whole book**.
 *
 * The two facts underneath it are easy to run together and are not the same thing. The
 * *writing mode* is what a section laid out in, and frond reports it per section because
 * sections are not required to agree. The *page progression direction* is what the package
 * document declares about the book, and it is the one that says which side is forward.
 *
 * Taking the answer from whichever section is on screen is what made a reader unable to get
 * past 入境大廳's part dividers: those are single full-page images with no link to the book's
 * stylesheet, so they lay out `horizontal-tb` inside a vertical book. On that one page the tap
 * zones and the page buttons swapped ends, so tapping forward went back — and from the page
 * behind it, tapping forward returned to the divider.
 *
 * So the direction is decided once and then left alone. `observeSection` exists for the books
 * that declare nothing — EPUB 2 has no such attribute at all — where the writing mode is the
 * only evidence there is.
 *
 * **Only a vertical section settles that fallback**, which is not the same as "the first
 * section wins". The first section to lay out is not the book's first: the reader is put back
 * where they stopped (`start: { cfi }`), so it can perfectly well be one of those image
 * dividers. Letting it settle the answer would lock an undeclared vertical book backwards for the
 * whole session, and nothing afterwards could correct it. An undeclared book therefore reads
 * left-to-right until some section lays out vertically — which is also the right answer for a
 * book where none ever does.
 */
export interface Direction {
  /** The next page is to the left: the book opens right-to-left. */
  readonly rtl: boolean;
  /** Whether the answer is fixed. False while an undeclared book is still waiting. */
  readonly settled: boolean;
  /**
   * Offers a section's writing mode as evidence. Returns whether it was taken, which it is
   * only for the first vertical section of a book that declared no direction of its own.
   */
  observeSection(writingMode: "horizontal-tb" | "vertical-rl"): boolean;
}

export function createDirection(declared: PageProgressionDirection | undefined): Direction {
  let rtl = declared === "rtl";
  let settled = declared !== undefined;

  return {
    get rtl() {
      return rtl;
    },
    get settled() {
      return settled;
    },
    observeSection(writingMode) {
      if (settled || writingMode !== "vertical-rl") return false;
      rtl = true;
      settled = true;
      return true;
    },
  };
}

/**
 * Which way is forward, in the three places that question is asked.
 *
 * Three members, one `rtl`. Anything about *what a gesture is* — was that a tap, may the browser
 * act on this press, does a long press survive a finger that drifted — belongs to
 * `lib/gesture.ts` and is not here.
 */
export interface Navigator {
  /**
   * A physical left/right input: an arrow key, or one of the two page buttons standing either
   * side of the book. Direction is inverted here, once — callers never invert themselves.
   *
   * It answers rather than acts. Which page to go to is this module's; making the page slide,
   * and putting the chrome away because it did, belong to whoever is playing the gesture out.
   */
  onSide(side: "left" | "right"): TurnDirection;
  /**
   * What a sideways drag of this much means: which page is coming, and which edge it comes in
   * from.
   *
   * **The one place the book's direction is applied to a drag.** Which of the two pages a
   * leftward drag asks for depends on which way the book opens; which side of the screen that
   * page slides in from does not — it is the side the finger is heading away from, in every
   * book.
   */
  dragTowards(travel: number): { towards: TurnDirection; from: TurnEdge };
  /**
   * Which edge the page comes in from when the reader **asked** for the turn instead of dragging
   * it — a page button, an arrow key.
   *
   * The counterpart to `dragTowards`, and the direction reaches it the other way round. A drag
   * names its own edge: the page follows the finger, so the one arriving comes in from the side
   * the finger is heading away from, whatever the book does. A press names no side at all, so
   * the only thing left to take it from is which way the book opens — a right-opening book
   * brings its next page in from the left, and its previous page in from the right.
   */
  edgeFor(towards: TurnDirection): TurnEdge;
}

export function createNavigator(opts: { rtl: boolean }): Navigator {
  const { rtl } = opts;

  function onSide(side: "left" | "right"): TurnDirection {
    const forward = rtl ? side === "left" : side === "right";
    return forward ? "next" : "prev";
  }

  function dragTowards(travel: number): { towards: TurnDirection; from: TurnEdge } {
    const forward = travel < 0 ? !rtl : rtl;
    return { towards: forward ? "next" : "prev", from: incomingEdge(travel) };
  }

  function edgeFor(towards: TurnDirection): TurnEdge {
    // The page on its way in enters from the side the current one is leaving towards, and in a
    // book nobody is touching that side is the book's own: forward is leftwards in a
    // left-opening book, so the next page comes from the right.
    return (towards === "next") === rtl ? "left" : "right";
  }

  return { onSide, dragTowards, edgeFor };
}
