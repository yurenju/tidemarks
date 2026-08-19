import { describe, it, expect } from "vitest";
import { keyToFraction, pointerToFraction, scrubberGeometry, snapToChapter } from "./scrubber";

describe("pointerToFraction", () => {
  it("maps x across the track width to 0..1 for a horizontal book", () => {
    expect(pointerToFraction(0, 200, false)).toBe(0);
    expect(pointerToFraction(100, 200, false)).toBe(0.5);
    expect(pointerToFraction(200, 200, false)).toBe(1);
  });

  it("mirrors for a right-to-left book: the right edge is the head", () => {
    // A right-to-left book starts at the right, so x=width is 0% and x=0 is 100%.
    expect(pointerToFraction(200, 200, true)).toBe(0);
    expect(pointerToFraction(100, 200, true)).toBe(0.5);
    expect(pointerToFraction(0, 200, true)).toBe(1);
  });

  it("clamps out-of-range x into 0..1", () => {
    expect(pointerToFraction(-40, 200, false)).toBe(0);
    expect(pointerToFraction(260, 200, false)).toBe(1);
    expect(pointerToFraction(-40, 200, true)).toBe(1);
    expect(pointerToFraction(260, 200, true)).toBe(0);
  });
});

describe("scrubberGeometry", () => {
  it("grows the fill from the left (head) for a horizontal book", () => {
    // 25% read, 200px track → thumb at 50px, fill covers the left 50px
    expect(scrubberGeometry(0.25, 200, false)).toEqual({
      thumbX: 50,
      fillStart: 0,
      fillWidth: 50,
    });
  });

  it("grows the fill from the right (head) for a right-to-left book", () => {
    // The head is the right end: the 25% already read grows leftwards from it, and the thumb
    // rides the fill's leading edge.
    expect(scrubberGeometry(0.25, 200, true)).toEqual({
      thumbX: 150,
      fillStart: 150,
      fillWidth: 50,
    });
  });

  it("fills the whole track at 100% from the correct end", () => {
    expect(scrubberGeometry(1, 200, false)).toEqual({ thumbX: 200, fillStart: 0, fillWidth: 200 });
    expect(scrubberGeometry(1, 200, true)).toEqual({ thumbX: 0, fillStart: 0, fillWidth: 200 });
  });

  it("shows an empty fill at 0% with the thumb parked at the head", () => {
    expect(scrubberGeometry(0, 200, false)).toEqual({ thumbX: 0, fillStart: 0, fillWidth: 0 });
    expect(scrubberGeometry(0, 200, true)).toEqual({ thumbX: 200, fillStart: 200, fillWidth: 0 });
  });
});

describe("keyToFraction", () => {
  it("walks the axis one step per arrow press in a left-to-right book", () => {
    expect(keyToFraction("ArrowRight", 0.5, false)).toBeCloseTo(0.51);
    expect(keyToFraction("ArrowLeft", 0.5, false)).toBeCloseTo(0.49);
  });

  it("mirrors left and right for a right-to-left book, because the axis is mirrored", () => {
    // The head is drawn on the right, so → walks towards the front of the book. What the
    // reader can see is which way the thumb goes; the fraction is not on screen.
    expect(keyToFraction("ArrowRight", 0.5, true)).toBeCloseTo(0.49);
    expect(keyToFraction("ArrowLeft", 0.5, true)).toBeCloseTo(0.51);
  });

  it("up is forward and down is back whichever way the book opens", () => {
    // They are not on the axis, so there is nothing for the mirror to act on.
    expect(keyToFraction("ArrowUp", 0.5, true)).toBeCloseTo(0.51);
    expect(keyToFraction("ArrowDown", 0.5, true)).toBeCloseTo(0.49);
  });

  it("Home and End are the two ends of the book, not of the track", () => {
    expect(keyToFraction("Home", 0.5, true)).toBe(0);
    expect(keyToFraction("End", 0.5, true)).toBe(1);
  });

  it("stops at both ends instead of walking past them", () => {
    expect(keyToFraction("ArrowLeft", 0, false)).toBe(0);
    expect(keyToFraction("ArrowRight", 1, false)).toBe(1);
  });

  it("has nothing to say about a key that is not its own", () => {
    // Which is what lets the reader's own arrow-key page turns through when the axis is not
    // the thing being driven.
    expect(keyToFraction("Enter", 0.5, false)).toBeNull();
    expect(keyToFraction("a", 0.5, false)).toBeNull();
  });
});

/**
 * Snapping is for the hand that cannot aim: a fingertip covers about 2% of a phone's axis, so
 * "the start of this chapter" is a target a thumb cannot hit and a mouse can. It is a policy of
 * the coarse branch only (ADR-0023) — with a mouse, 1px is 1px.
 */
describe("snapToChapter", () => {
  // A book of four chapters, the first starting at the cover.
  const starts = [0, 0.25, 0.6, 0.9];

  it("lands on a chapter that is within reach", () => {
    expect(snapToChapter(0.61, starts)).toBe(0.6);
    expect(snapToChapter(0.59, starts)).toBe(0.6);
  });

  it("leaves a position that is not near one alone", () => {
    expect(snapToChapter(0.5, starts)).toBe(0.5);
  });

  it("takes the nearer of two chapters in reach", () => {
    expect(snapToChapter(0.505, [0.5, 0.52])).toBe(0.5);
    expect(snapToChapter(0.515, [0.5, 0.52])).toBe(0.52);
  });

  it("never takes the ends of the book away", () => {
    // The last chapter starting near the end is common, and a reader dragging to the very end
    // means the end. Snapping backwards there would make the last page unreachable by drag.
    expect(snapToChapter(1, starts)).toBe(1);
    expect(snapToChapter(0.995, starts)).toBe(0.995);
    expect(snapToChapter(0, starts)).toBe(0);
  });

  it("has nothing to snap to before the index exists", () => {
    expect(snapToChapter(0.42, [])).toBe(0.42);
  });
});
