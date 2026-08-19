// Navigator — owns "how this book turns pages": direction inversion (a right-to-left book
// opens from the right, so left is forward), and what becomes of a press that was not a drag.
//
// **Turning a page by hand is a drag and nothing else** (ADR-0024), so the tap zones this
// module used to hold are gone, and with them every question about where a press landed. What
// is left of a press here is one bit — was it a tap — and one answer: whose it is.
//
// What it no longer owns is section-edge crossing. Under epub.js, walking to the next spine
// item at the end of a vertical section was ours to do, and doing it needed the container's
// scroll geometry — which is why `RenditionPort` existed at all. frond's `next()` and
// `previous()` continue into the neighbouring section themselves, so that whole seam
// collapsed into the two methods below.

import type { PageProgressionDirection } from "@yurenju/frond/epub";
import type { TurnDirection, TurnEdge } from "@yurenju/frond/renderer";
import { incomingEdge, isTap } from "./touch";

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
 * stylesheet, so they lay out `horizontal-tb` inside a 直排 book. On that one page the tap
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
 * dividers. Letting it settle the answer would lock an undeclared 直排 book backwards for the
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
 * The two actions a page turn needs. frond's `Renderer` satisfies this as it stands, which
 * is the point — there is no adapter left, only a narrow view of the real thing.
 *
 * It stays an interface rather than taking a `Renderer` because the turn decisions below
 * are the part worth unit-testing, and a fake with two methods is the whole fixture. Both
 * return void: whether the turn has landed is not something a gesture handler waits for.
 */
export interface Pager {
  next(): void;
  prev(): void;
}

// A completed press: how far it travelled (dx/dy), how long it lasted (ms), and whether it
// landed on a link. Wiring stays in the component; the decision is here.
//
// **No position, and no page size.** Where a press lands decided things while tapping turned
// pages; it decides nothing now (ADR-0024). Nor `hasSelection`: a tap drops whatever the
// browser selected under it either way, and a drag was ruled out at the press.
export interface PointerEnd {
  dx: number;
  dy: number;
  ms: number;
  isLink: boolean;
}

/**
 * A touch that has just begun, in the two facts that decide what to do about it.
 *
 * The gesture is not decidable yet, and does not need to be: the one question asked at this
 * moment is whether the browser should be stopped from acting on this press as a tap of its
 * own, and neither answer depends on how the press ends.
 *
 * **Nor on where it landed**, which is why there is no position here. Every press on the page
 * has something to protect: a tap anywhere raises the chrome, and a drag anywhere turns the
 * page (ADR-0024).
 *
 * There is no `hasSelection` either, unlike the release. It used to be asked, because the
 * mechanism of the day made the document unselectable and so dropped whatever was selected;
 * cancelling the tap's default takes nothing away, so a selection standing at the moment of
 * the press no longer changes the answer.
 */
export interface PointerStart {
  /** `PointerEvent.pointerType` as frond reports it: `'mouse'`, `'touch'`, `'pen'`, … */
  pointerType: string;
  isLink: boolean;
}

/**
 * What became of one completed press.
 *
 * Two bits, and they are not the same question. `tap` says what the gesture was; `unclaimed`
 * says whether anything has a claim on it. A tap on a link is a tap that is spoken for.
 */
export interface PointerResult {
  /** The press neither travelled nor lingered. */
  tap: boolean;
  /**
   * A press nothing else has a claim on: **the caller's to spend.** True for a tap anywhere on
   * the page that was not on a link, whatever pressed it.
   *
   * False for a tap on a link, which belongs to the link, and for anything that was not a tap
   * — a drag turned a page, and a long press was choosing text.
   *
   * **What the caller spends it on is not stated here.** The reader raises the chrome with it;
   * the navigator only reports that this press went unused.
   */
  unclaimed: boolean;
}

export interface Navigator {
  next(): void;
  prev(): void;
  // A physical left/right input (arrow key or edge page button); direction is inverted
  // here, once, for right-to-left books — callers never invert themselves.
  onSide(side: "left" | "right"): void;
  /** Whether the browser should be stopped from acting on this press as a tap of its own. */
  preventsTapDefault(e: PointerStart): boolean;
  onPointerEnd(e: PointerEnd): PointerResult;
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

export function createNavigator(pager: Pager, opts: { rtl: boolean }): Navigator {
  const { rtl } = opts;

  function onSide(side: "left" | "right") {
    const forward = rtl ? side === "left" : side === "right";
    if (forward) pager.next();
    else pager.prev();
  }

  /**
   * Whose press this is: the reader's, or the browser's to make something of.
   *
   * It used to be called "does this tap turn a page", and it asked the same two conditions.
   * What it protects has changed (a tap raises the chrome now, it does not turn), and the
   * conditions have not — which is the point of ADR-0024's claim that `preventTapDefault()`
   * needs no adjusting.
   *
   * ## Only a finger
   *
   * A mouse press has no `touchend` to cancel, so the call would do nothing anyway; asking
   * keeps the two moments honest rather than relying on that.
   *
   * ## Not on a link
   *
   * A tap on a footnote marker goes to the note, and it gets there through the `click` that
   * suppression cancels. This is the condition carrying real weight: without it, every
   * footnote marker in the book stops opening.
   */
  function claimsPress(e: PointerStart): boolean {
    return e.pointerType !== "mouse" && !e.isLink;
  }

  /**
   * ## The half of #36 that cannot be cleaned up afterwards
   *
   * Chrome for Android selects a word out of a plain tap and raises a **search bar** over
   * the book. The selection is ours to undo (`clearSelection()`, and the tap grace window
   * below); the bar is not — it belongs to the browser, and nothing on the page takes it
   * back down. So it has to be stopped before it happens, and frond's `pointerdown` is the
   * only moment early enough (`preventTapDefault()`).
   *
   * **The mechanism was measured, and it is not the one Chrome's documentation names.**
   * Making the text unselectable — the condition that documentation gives — only made the
   * bar rarer on a real phone: 21% of taps against 72% with nothing at all. Cancelling the
   * tap's own default stopped it, 0 in 15 (#40, frond #80). What that changes here is the
   * cost of a wrong answer: the press loses its `click`, so a suppressed press cannot
   * follow a link, while the text under it stays selectable throughout.
   *
   * **The press is suppressed exactly when it is the reader's** — `claimsPress`.
   *
   * That predicate used to be asked alongside a third condition here: the position, because
   * a tap in the middle band turned nothing and so had nothing worth protecting. **Its
   * absence is the fix for the remainder of #36** (#60). Left to act on its own in that band,
   * the browser did — taking a word out of a plain tap. The reader aiming at the edge but
   * landing short got that word and no page turn, which is #36's symptom exactly, surviving
   * in the one place the suppression never reached.
   *
   * **The three-tenths turn band did not bring that condition back**, which is the one thing
   * about ADR-0020 worth checking twice. The old prediction was that a band which turns
   * nothing would need the position asked again — and what came back is not that. A tap above
   * the band raises the chrome, so it has an action to protect, and leaving the browser to
   * act there would take a word out of a plain tap in seven tenths of the page while the
   * reader believed they were calling up the interface.
   *
   * What is deliberately *not* asked is how long the press will last. A long press is a page
   * turn that has not finished yet as far as this moment can tell, and waiting to find out is
   * waiting until after the browser has decided. It costs that long press nothing: selection
   * is no longer collateral.
   */
  function preventsTapDefault(e: PointerStart): boolean {
    return claimsPress(e);
  }

  function onPointerEnd(e: PointerEnd): PointerResult {
    // ## Why a tap does not ask whether something is selected
    //
    // It used to, and that is the bug behind #36: **phone browsers select a word on a plain
    // tap** (Chrome for Android's Touch to Search), so by the time the finger lifts there is
    // a selection — one the reader never made. Reading it as "a selection is in progress"
    // turned every such tap into a no-op.
    //
    // What separates a deliberate selection from that one is the shape of the gesture, not
    // the DOM: choosing text means either holding still for half a second or dragging, and
    // both fail `isTap`. The drag has its own guard, asked at the press rather than here
    // (docs/specs/swipe-to-turn/spec.md): a selection already standing when the finger lands
    // means the reader is adjusting it, and the page does not move.
    if (isTap(e.dx, e.dy, e.ms)) return { tap: true, unclaimed: !e.isLink };

    // Anything else was a drag or a long press. A drag that turned a page did so through
    // `beginTurn`, while the finger was still down; a long press was choosing text. Neither
    // leaves anything for the caller to spend.
    return { tap: false, unclaimed: false };
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

  return {
    next: () => pager.next(),
    prev: () => pager.prev(),
    onSide,
    preventsTapDefault,
    onPointerEnd,
    dragTowards,
    edgeFor,
  };
}
