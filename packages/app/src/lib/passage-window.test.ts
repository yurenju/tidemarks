import { describe, expect, it } from "vitest";
import { passageWindow } from "./passage-window";

// Lines are counted from zero; `markEnd` is the line after the mark's last. Twelve lines is what
// half of an 844px phone holds at the default size, and 28 is a long paragraph's worth.
describe("passageWindow", () => {
  it("leaves a passage that fits uncut", () => {
    expect(passageWindow({ fits: 12, total: 12, markStart: 10, markEnd: 12 })).toBeNull();
  });

  it("cuts from the top when the mark is in the window's first half", () => {
    expect(passageWindow({ fits: 12, total: 28, markStart: 0, markEnd: 1 })).toEqual({
      start: 0,
      above: 0,
      below: 16,
    });
    expect(passageWindow({ fits: 12, total: 28, markStart: 5, markEnd: 6 })).toEqual({
      start: 0,
      above: 0,
      below: 16,
    });
  });

  it("starts the mark halfway down the window, with the passage cut at both ends", () => {
    expect(passageWindow({ fits: 12, total: 28, markStart: 13, markEnd: 15 })).toEqual({
      start: 7,
      above: 7,
      below: 9,
    });
  });

  it("rounds the half of an odd window down", () => {
    expect(passageWindow({ fits: 11, total: 28, markStart: 13, markEnd: 14 })?.start).toBe(8);
  });

  // #262: the case that started it — a short mark three lines from a long paragraph's end, which
  // a cut from the top left out of the window altogether.
  it("stops at the passage's end rather than leaving the window short", () => {
    expect(passageWindow({ fits: 12, total: 28, markStart: 24, markEnd: 26 })).toEqual({
      start: 16,
      above: 16,
      below: 0,
    });
  });

  it("moves a mark too long for the window's lower half up until a line after it shows", () => {
    // Six lines from line 18: halfway would end it past the window, so it starts at line 5 of it.
    expect(passageWindow({ fits: 12, total: 37, markStart: 18, markEnd: 24 })).toEqual({
      start: 13,
      above: 13,
      below: 12,
    });
  });

  it("keeps two lines over a mark longer than the window, and cuts the mark's tail", () => {
    expect(passageWindow({ fits: 12, total: 28, markStart: 9, markEnd: 21 })).toEqual({
      start: 7,
      above: 7,
      below: 9,
    });
  });

  it("cuts a long mark from the top when it starts in the first two lines", () => {
    expect(passageWindow({ fits: 12, total: 28, markStart: 1, markEnd: 20 })?.start).toBe(0);
  });
});
