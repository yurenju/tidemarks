// Which way is forward: the direction a book declares or reveals, which page a left/right input
// asks for, and which edge a page arrives from. Arithmetic only — how a run of pointer events
// adds up to one of these is gesture.test.ts, and the same turns made by a real finger are
// packages/app/tests/browser/reader/drag.spec.ts and tap.spec.ts.
import { describe, it, expect } from "vitest";
import { createDirection, createNavigator } from "./navigator";

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
    // would lock an undeclared vertical book backwards for the whole session, with nothing left
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
    // book's stylesheet, lays out `horizontal-tb` in the middle of a vertical book. Deriving
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
  // It answers rather than acts: the turn itself is played out by whoever asked, which is what
  // lets one place decide that any turn also puts the chrome away (`lib/gesture.ts`).
  it("horizontal book: left = prev, right = next", () => {
    const nav = createNavigator({ rtl: false });
    expect(nav.onSide("left")).toBe("prev");
    expect(nav.onSide("right")).toBe("next");
  });

  it("vertical book opens right-to-left: left = next, right = prev", () => {
    const nav = createNavigator({ rtl: true });
    expect(nav.onSide("left")).toBe("next");
    expect(nav.onSide("right")).toBe("prev");
  });
});

describe("Navigator drag direction (the one place the book's direction is applied)", () => {
  it("a leftward drag on a horizontal book asks for the next page, and it comes in from the right", () => {
    const nav = createNavigator({ rtl: false });
    expect(nav.dragTowards(-40)).toEqual({ towards: "next", from: "right" });
  });

  it("a rightward drag on the same book asks for the previous one, from the left", () => {
    const nav = createNavigator({ rtl: false });
    expect(nav.dragTowards(40)).toEqual({ towards: "prev", from: "left" });
  });

  it("a right-opening book swaps which page it is, and not which side it comes from", () => {
    // The half that trips people: the edge is geometry (the page follows the finger, so it
    // arrives from behind the finger) and only the identity of the page is the book's to
    // decide. Inverting both would bring the next page in from the side it is leaving towards.
    const nav = createNavigator({ rtl: true });
    expect(nav.dragTowards(-40)).toEqual({ towards: "prev", from: "right" });
    expect(nav.dragTowards(40)).toEqual({ towards: "next", from: "left" });
  });
});

describe("Navigator commanded turns (a button or a key, with no finger to take the edge from)", () => {
  it("a left-opening book brings its next page in from the right", () => {
    const nav = createNavigator({ rtl: false });
    expect(nav.edgeFor("next")).toBe("right");
    expect(nav.edgeFor("prev")).toBe("left");
  });

  it("and a right-opening book brings it in from the left", () => {
    const nav = createNavigator({ rtl: true });
    expect(nav.edgeFor("next")).toBe("left");
    expect(nav.edgeFor("prev")).toBe("right");
  });

  it("agrees with the drag that reaches the same page, because it is the same turn", () => {
    // The two routes decide the edge from different facts — the finger's direction, the book's
    // direction — and a reader who turns forward by hand and then by button must not see the
    // page arrive from two different sides. In a left-opening book the forward drag is leftward.
    for (const rtl of [false, true]) {
      const nav = createNavigator({ rtl });
      const forward = nav.dragTowards(rtl ? 40 : -40);
      expect(forward.towards).toBe("next");
      expect(nav.edgeFor("next")).toBe(forward.from);
    }
  });
});
