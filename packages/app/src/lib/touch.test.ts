// The thresholds a finger is judged against: tap, drag, flick, how far the page follows and how
// far it may be pulled past the end. Numbers only — which page a drag is asking for is
// navigator.test.ts, and the same gestures in three engines are
// packages/app/tests/browser/reader/drag.spec.ts and real-touch.spec.ts.
import { describe, expect, it } from "vitest";
import { commitsTurn, dampen, incomingEdge, isTap, startsDrag, travelled } from "./touch";

describe("isTap", () => {
  it("a quick press that stayed put is a tap", () => {
    expect(isTap(2, -3, 90)).toBe(true);
  });

  it("a press that travelled is a drag, not a tap", () => {
    expect(isTap(40, 0, 90)).toBe(false);
    expect(isTap(0, 40, 90)).toBe(false);
  });

  it("a press held still for half a second is a long press, not a tap", () => {
    // Which is where both phone platforms start selecting text — the reader is choosing a
    // passage, and reading that as "put the interface up" is not what they asked for.
    expect(isTap(1, 1, 600)).toBe(false);
  });
});

describe("startsDrag", () => {
  it("a finger that has travelled sideways past the slop is turning a page", () => {
    expect(startsDrag(11, 0)).toBe(true);
    expect(startsDrag(-11, 0)).toBe(true);
  });

  it("inside the slop nothing moves — a tap wobbles", () => {
    expect(startsDrag(9, 0)).toBe(false);
    expect(startsDrag(-9, 3)).toBe(false);
  });

  it("a mostly-vertical drag is not a page turn", () => {
    // Pages move sideways whichever way the book is written (docs/specs/swipe-to-turn/spec.md),
    // so a finger going down the page is asking for something else.
    expect(startsDrag(20, 40)).toBe(false);
  });

  it("how long the finger has been down does not come into it", () => {
    // There is no time limit in this decision on purpose: a reader who presses, hesitates and
    // then swipes gets the same page turn as one who swipes at once. Selection is ruled out by
    // whether anything is selected, not by a clock nobody can feel.
    expect(startsDrag(30, 0)).toBe(true);
  });
});

describe("travelled", () => {
  it("counts from where the drag began, not from where the finger went down", () => {
    // Otherwise the page jumps by the slop the instant it is crossed.
    expect(travelled(10)).toBe(0);
    expect(travelled(30)).toBe(20);
    expect(travelled(-30)).toBe(-20);
  });

  it("inside the slop there is no travel in either direction", () => {
    expect(travelled(4)).toBe(0);
    expect(travelled(-4)).toBe(0);
  });
});

describe("incomingEdge", () => {
  it("the page comes in from the side the finger is heading away from", () => {
    // Purely geometric, and deliberately free of the book's direction: dragging left pulls the
    // page left, so whatever arrives arrives from the right. Which page that *is* — next or
    // previous — is the one the book's direction decides (`Navigator.dragTowards`).
    expect(incomingEdge(-40)).toBe("right");
    expect(incomingEdge(40)).toBe("left");
  });
});

describe("commitsTurn", () => {
  const extent = 600;

  it("a drag past a third of the page turns it", () => {
    expect(commitsTurn({ distance: 201, extent, velocity: 0 })).toBe(true);
    expect(commitsTurn({ distance: 199, extent, velocity: 0 })).toBe(false);
  });

  it("a flick turns it however short it was", () => {
    // The gesture a thumb makes on a phone: 30px and gone. Distance alone would refuse it, and
    // refusing it is the whole of "I swiped and nothing happened".
    expect(commitsTurn({ distance: 30, extent, velocity: 1.2 })).toBe(true);
  });

  it("a slow drag that ended short goes back", () => {
    expect(commitsTurn({ distance: 30, extent, velocity: 0.05 })).toBe(false);
  });

  it("the two thresholds scale with the page, not with the pixel", () => {
    // A third of a phone is not a third of a tablet, and the reader means the same thing on
    // both.
    expect(commitsTurn({ distance: 201, extent: 1200, velocity: 0 })).toBe(false);
    expect(commitsTurn({ distance: 401, extent: 1200, velocity: 0 })).toBe(true);
  });
});

describe("dampen", () => {
  const extent = 600;

  it("follows the finger at first, so the page is not dead under it", () => {
    expect(dampen(10, extent)).toBeGreaterThan(8);
    expect(dampen(10, extent)).toBeLessThanOrEqual(10);
  });

  it("never opens further than a quarter of the page, however hard it is pulled", () => {
    // 3000px is already several screens of pulling, and it stops a whisker short of the limit.
    expect(dampen(3000, extent)).toBeLessThan(extent * 0.25);
    expect(dampen(3000, extent)).toBeGreaterThan(extent * 0.24);
  });

  it("resists more the further it goes — that is what says 'this is the end'", () => {
    const first = dampen(50, extent) - dampen(0, extent);
    const later = dampen(200, extent) - dampen(150, extent);
    expect(later).toBeLessThan(first);
  });
});
