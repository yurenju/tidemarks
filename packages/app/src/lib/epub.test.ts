import { describe, expect, it } from "vitest";
import { textFromXhtml } from "./epub";

// Language detection used to sample the rendered page through an epub.js content hook. frond
// renders inside an iframe and does not offer one — reaching in is what that boundary exists
// to stop — so the sample comes from the book's own bytes instead, and this is the pass that
// turns those bytes into prose. It only has to be good enough for `detectVariant` to count Han
// characters, which is why it is a text pass rather than a parse.
describe("textFromXhtml", () => {
  it("keeps the prose and drops the tags", () => {
    expect(textFromXhtml("<p>朝の光</p><p>机の上</p>")).toBe("朝の光 机の上");
  });

  it("drops what a stylesheet says, not just its tags", () => {
    // Without this, CSS selectors and property names pour into the sample — and a stylesheet
    // is full of Latin text that would dilute the count.
    const source = "<head><style>p { font-family: 明體 }</style></head><body><p>朝の光</p></body>";
    expect(textFromXhtml(source)).toBe("朝の光");
  });

  it("drops script content too", () => {
    expect(textFromXhtml("<script>var 這是 = 1</script><p>朝の光</p>")).toBe("朝の光");
  });

  it("does not glue two words together where a tag separated them", () => {
    // Replacing a tag with nothing would read `简体` out of `简<em>体</em>` as one word — fine
    // here, but the same rule would join the last character of one block to the first of the
    // next and invent a character pair that is not in the book.
    expect(textFromXhtml("<p>一</p><p>二</p>")).toBe("一 二");
  });

  it("collapses the whitespace XHTML indentation leaves behind", () => {
    expect(textFromXhtml("<p>\n  朝の光\n</p>\n\n<p>\t机の上</p>")).toBe("朝の光 机の上");
  });

  it("drops entities rather than leaving their source text", () => {
    // `&nbsp;` is not a character to count, and `&#x6f22;` would otherwise contribute the
    // Latin letters of its own spelling.
    expect(textFromXhtml("<p>朝&nbsp;光</p>")).toBe("朝 光");
  });

  it("survives markup it cannot make sense of", () => {
    // A book that will not parse as XML still has to be classifiable — this runs before frond
    // ever tries to render it.
    expect(textFromXhtml("<p>朝の光<p>机の上")).toContain("朝の光");
  });
});
