import { describe, it, expect, vi } from "vitest";
import { createDirection, createNavigator } from "./navigator";
import type { Pager } from "./navigator";

// Two methods is the whole fake now. The section-crossing cases this file used to carry —
// "at the end of a vertical section, walk to the next spine item" and the scroll-state
// arithmetic underneath them — are gone because frond's next()/previous() cross sections
// themselves. What is left is the part that was always ours: which direction is forward, and
// when not to turn at all.
function fakePager(): Pager {
  return { next: vi.fn(), prev: vi.fn() };
}

describe("Turn direction — one answer per book, not per section", () => {
  it("takes the direction the book declares", () => {
    expect(createDirection("rtl").rtl).toBe(true);
    expect(createDirection("ltr").rtl).toBe(false);
  });

  it("falls back to the first section that lays out vertically, when the book declares nothing", () => {
    // EPUB 2 has no such attribute at all, so this is the ordinary case for older books.
    const direction = createDirection(undefined);
    expect(direction.settled).toBe(false);
    expect(direction.rtl).toBe(false);

    expect(direction.observeSection("vertical-rl")).toBe(true);
    expect(direction.rtl).toBe(true);
    expect(direction.settled).toBe(true);
  });

  it("a horizontal section settles nothing, so a later vertical one can still speak", () => {
    // The section that lays out first is not the book's first: the reader is put back where
    // they stopped (`start: { cfi }`). Letting a full-page image divider settle the direction
    // would lock an undeclared 直排 book backwards for the whole session, with nothing left
    // that could correct it.
    const direction = createDirection(undefined);

    expect(direction.observeSection("horizontal-tb")).toBe(false);
    expect(direction.settled).toBe(false);
    expect(direction.rtl).toBe(false);

    expect(direction.observeSection("vertical-rl")).toBe(true);
    expect(direction.rtl).toBe(true);
  });

  it("a horizontal section later in the book does not flip a right-to-left one", () => {
    // The bug this pins: a part divider that is one full-page image, with no link to the
    // book's stylesheet, lays out `horizontal-tb` in the middle of a 直排 book. Deriving
    // the direction from it swapped the tap zones — the reader tapped forward where they
    // always had and went back a page, then forward onto the divider again, with no way
    // through.
    const direction = createDirection("rtl");

    expect(direction.observeSection("horizontal-tb")).toBe(false);
    expect(direction.rtl).toBe(true);
  });

  it("nor one that settled from its own first section", () => {
    const direction = createDirection(undefined);
    direction.observeSection("vertical-rl");

    expect(direction.observeSection("horizontal-tb")).toBe(false);
    expect(direction.rtl).toBe(true);
  });
});

describe("Navigator direction inversion (single source of truth)", () => {
  it("horizontal book: left = prev, right = next", () => {
    const pager = fakePager();
    const nav = createNavigator(pager, { rtl: false });
    nav.onSide("left");
    expect(pager.prev).toHaveBeenCalledOnce();
    nav.onSide("right");
    expect(pager.next).toHaveBeenCalledOnce();
  });

  it("vertical book opens right-to-left: left = next, right = prev", () => {
    const pager = fakePager();
    const nav = createNavigator(pager, { rtl: true });
    nav.onSide("left");
    expect(pager.next).toHaveBeenCalledOnce();
    nav.onSide("right");
    expect(pager.prev).toHaveBeenCalledOnce();
  });

  it("next() and prev() are the un-inverted pair, for callers that already know", () => {
    // The Scrubber and the notes sheet jump; only physical input needs inverting.
    const pager = fakePager();
    const nav = createNavigator(pager, { rtl: true });
    nav.next();
    expect(pager.next).toHaveBeenCalledOnce();
    nav.prev();
    expect(pager.prev).toHaveBeenCalledOnce();
  });
});

describe("Navigator drag direction (the one place the book's direction is applied)", () => {
  it("a leftward drag on a horizontal book asks for the next page, and it comes in from the right", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.dragTowards(-40)).toEqual({ towards: "next", from: "right" });
  });

  it("a rightward drag on the same book asks for the previous one, from the left", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.dragTowards(40)).toEqual({ towards: "prev", from: "left" });
  });

  it("a right-opening book swaps which page it is, and not which side it comes from", () => {
    // The half that trips people: the edge is geometry (the page follows the finger, so it
    // arrives from behind the finger) and only the identity of the page is the book's to
    // decide. Inverting both would bring the next page in from the side it is leaving towards.
    const nav = createNavigator(fakePager(), { rtl: true });
    expect(nav.dragTowards(-40)).toEqual({ towards: "prev", from: "right" });
    expect(nav.dragTowards(40)).toEqual({ towards: "next", from: "left" });
  });
});

describe("Navigator commanded turns (a button or a key, with no finger to take the edge from)", () => {
  it("a left-opening book brings its next page in from the right", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.edgeFor("next")).toBe("right");
    expect(nav.edgeFor("prev")).toBe("left");
  });

  it("and a right-opening book brings it in from the left", () => {
    const nav = createNavigator(fakePager(), { rtl: true });
    expect(nav.edgeFor("next")).toBe("left");
    expect(nav.edgeFor("prev")).toBe("right");
  });

  it("agrees with the drag that reaches the same page, because it is the same turn", () => {
    // The two routes decide the edge from different facts — the finger's direction, the book's
    // direction — and a reader who turns forward by hand and then by button must not see the
    // page arrive from two different sides. In a left-opening book the forward drag is leftward.
    for (const rtl of [false, true]) {
      const nav = createNavigator(fakePager(), { rtl });
      const forward = nav.dragTowards(rtl ? 40 : -40);
      expect(forward.towards).toBe("next");
      expect(nav.edgeFor("next")).toBe(forward.from);
    }
  });
});

describe("Navigator pointer end (what is left of a press that was not a drag)", () => {
  it("a tap is the caller's to spend, wherever it landed", () => {
    // No zones any more (ADR-0024): tapping does not turn pages, so where the finger came down
    // decides nothing. What the caller spends it on is the chrome.
    const pager = fakePager();
    const nav = createNavigator(pager, { rtl: false });

    expect(nav.onPointerEnd({ dx: 2, dy: 2, ms: 90, isLink: false })).toEqual({
      tap: true,
      unclaimed: true,
    });
    expect(pager.next).not.toHaveBeenCalled();
    expect(pager.prev).not.toHaveBeenCalled();
  });

  it("a tap on a link belongs to the link", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.onPointerEnd({ dx: 2, dy: 2, ms: 90, isLink: true })).toEqual({
      tap: true,
      unclaimed: false,
    });
  });

  it("a press that travelled is not a tap, and the release has nothing left to decide", () => {
    // It was a drag, and the page it turned was turned while the finger was still down
    // (`beginTurn`). What must not happen here is a second turn on top of it.
    const pager = fakePager();
    const nav = createNavigator(pager, { rtl: false });

    expect(nav.onPointerEnd({ dx: -90, dy: 0, ms: 200, isLink: false })).toEqual({
      tap: false,
      unclaimed: false,
    });
    expect(pager.next).not.toHaveBeenCalled();
    expect(pager.prev).not.toHaveBeenCalled();
  });

  it("a press held past the long-press threshold is not a tap either", () => {
    // Half a second of holding still is where both phone platforms start selecting text. The
    // reader is choosing a passage, not asking for the interface — which is why this one is
    // not unclaimed.
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.onPointerEnd({ dx: 1, dy: 1, ms: 900, isLink: false })).toEqual({
      tap: false,
      unclaimed: false,
    });
  });
});

describe("Navigator press start (whose tap this is)", () => {
  // The press has only landed; the gesture is still unknown. The one question at this
  // moment is whether the browser should be stopped from acting on it as a tap of its own —
  // Chrome for Android otherwise selects a word out of a plain tap and raises a search bar
  // over the book, and that bar cannot be taken back down afterwards (#36).
  const press = {
    pointerType: "touch",
    isLink: false,
  };

  it("a finger landing on the page loses the browser's tap, wherever it landed", () => {
    // Where used to be the third condition, back when the middle band turned nothing and so
    // had nothing to protect. Both halves turn a page now, so every press has something.
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.preventsTapDefault(press)).toBe(true);
  });

  it("a mouse is left alone: its click turns no page, and it has no tap to cancel", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.preventsTapDefault({ ...press, pointerType: "mouse" })).toBe(false);
  });

  it("a stylus is a finger here too", () => {
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.preventsTapDefault({ ...press, pointerType: "pen" })).toBe(true);
  });

  it("a press on a link is left alone, or the footnote under it stops opening", () => {
    // The condition carrying the most weight, and more so now that it is one of only two:
    // cancelling the tap takes its `click` away, and the click is how frond recognises a
    // link. Answering true here would leave every footnote marker in the book dead.
    const nav = createNavigator(fakePager(), { rtl: false });
    expect(nav.preventsTapDefault({ ...press, isLink: true })).toBe(false);
  });
});
