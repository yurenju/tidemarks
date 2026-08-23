// Which downloaded faces the interface itself may be set in: both weights of a family or none
// of it, and never the sans whatever the reader chose for their books. Getting the faces onto
// the device is web-font-store.test.ts.
import { describe, expect, it } from "vitest";
import { uiFontFaces } from "./ui-font";

const SERIF_REGULAR = "Noto Serif CJK TC/400";
const SERIF_BOLD = "Noto Serif CJK TC/700";
const SANS_REGULAR = "Noto Sans CJK TC/400";
const SANS_BOLD = "Noto Sans CJK TC/700";

describe("uiFontFaces", () => {
  it("takes nothing on a device that has downloaded nothing", () => {
    expect(uiFontFaces([])).toEqual([]);
  });

  it("takes both serif weights once both are here", () => {
    const faces = uiFontFaces([SERIF_REGULAR, SERIF_BOLD]);
    expect(faces.map((face) => face.weight)).toEqual([400, 700]);
    expect(faces.every((face) => face.family === "Noto Serif CJK TC")).toBe(true);
  });

  // Half a family is worse than none: the headings would be a synthesised weight sitting
  // beside a real one, and the two do not read as the same typeface.
  it("takes nothing when only the Regular is here", () => {
    expect(uiFontFaces([SERIF_REGULAR])).toEqual([]);
  });

  // The reader picked 黑體 for their books. That says nothing about the chrome, which is set
  // in a serif whatever the book is set in.
  it("never takes the sans, even when the whole family is here", () => {
    expect(uiFontFaces([SANS_REGULAR, SANS_BOLD])).toEqual([]);
  });

  it("takes only the serif when the device holds both families", () => {
    const faces = uiFontFaces([SANS_REGULAR, SANS_BOLD, SERIF_REGULAR, SERIF_BOLD]);
    expect(faces.map((face) => face.kind)).toEqual(["serif", "serif"]);
  });
});
