// What the shelf does to a marked passage before setting it as one paragraph. The card that shows
// the result is packages/app/tests/browser/library/marks.spec.ts.
import { describe, expect, it } from "vitest";
import { tidy } from "./passage";

describe("tidy", () => {
  it("closes up the gap a paragraph break leaves between two ideographs", () => {
    expect(tidy("再度置身這間醫院。　　當我陷入昏迷時")).toBe("再度置身這間醫院。當我陷入昏迷時");
  });

  it("takes the layout off both ends", () => {
    expect(tidy("\n   她後來才明白。 \n ")).toBe("她後來才明白。");
  });

  // The rule has to be able to tell these two apart, and this is the pair that says so: the same
  // single space is layout in one and language in the other.
  it("leaves every space between Latin words alone", () => {
    const line = "Every map is a wish about where the roads should have gone.";
    expect(tidy(line)).toBe(line);
  });

  it("collapses a run inside Latin to one space rather than to none", () => {
    expect(tidy("Nothing was ever settled\n   by argument.")).toBe(
      "Nothing was ever settled by argument.",
    );
  });

  it("keeps the spaces around a Latin word quoted inside a Chinese sentence", () => {
    expect(tidy("他讀了 Bachelard 的書。")).toBe("他讀了 Bachelard 的書。");
  });

  it("counts full-width punctuation as wide, so a break after 」 closes up", () => {
    expect(tidy("「這樣。」　　他說。")).toBe("「這樣。」他說。");
  });

  it("hands back an empty passage rather than throwing on one", () => {
    expect(tidy("   \n  ")).toBe("");
  });
});
