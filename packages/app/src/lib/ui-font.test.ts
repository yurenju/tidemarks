// Which downloaded faces the interface itself may be set in: the serif if it is here, and
// never the sans whatever the reader chose for their books. Getting the faces onto the device
// is web-font-store.test.ts.
import { describe, expect, it } from "vitest";
import { uiFontFaces } from "./ui-font";

const SERIF = "Noto Serif CJK TC";
const SANS = "Noto Sans CJK TC";
// The keys the two static faces were stored under, before one variable file replaced them.
const SERIF_REGULAR = "Noto Serif CJK TC/400";
const SERIF_BOLD = "Noto Serif CJK TC/700";

describe("uiFontFaces", () => {
  it("takes nothing on a device that has downloaded nothing", () => {
    expect(uiFontFaces([])).toEqual([]);
  });

  it("takes the serif once it is here", () => {
    const faces = uiFontFaces([SERIF]);
    expect(faces.map((face) => face.family)).toEqual([SERIF]);
  });

  // The reader picked [[Sans]] for their books. That says nothing about the chrome, which is set
  // in a serif whatever the book is set in.
  it("never takes the sans, even when it is here", () => {
    expect(uiFontFaces([SANS])).toEqual([]);
  });

  it("takes only the serif when the device holds both families", () => {
    expect(uiFontFaces([SANS, SERIF]).map((face) => face.kind)).toEqual(["serif"]);
  });

  // A device that downloaded a face before this build holds the two static ones. Their bytes
  // are a face the chrome can no longer name, so reading them as "the serif is here" would
  // register an `@font-face` against nothing.
  it("takes nothing from the superseded static keys", () => {
    expect(uiFontFaces([SERIF_REGULAR, SERIF_BOLD])).toEqual([]);
  });
});
