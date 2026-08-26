// The two edges of a visit: when going back to a marked passage stops counting as reading, and
// when reading resumes. Both are asked with CFIs frond has just produced, so what is exercised
// here is the rule rather than the parsing — the cases that matter are the boundaries of the
// page and the moment the reader passes their own progress.
//
// **The rule is exhausted here.** `tests/browser/reader/visit.spec.ts` is the layer above, and
// it holds two wires this one cannot reach: that the position written on every `relocate` is
// really held back, and that the page the decision is taken against is the live one rather than
// the stored `pageRange`. Anything that is a question about the rule itself belongs here.
import { describe, expect, it } from "vitest";
import { entersVisit, leavesVisit } from "./visit";

// A page of a made-up book, running from `/4/2` to `/4/8`, with the reader's point inside it.
const PAGE = "epubcfi(/6/4!/4,/2/1:0,/8/1:40)";
const POINT = "epubcfi(/6/4!/4/2/1:10)";

describe("entersVisit", () => {
  it("enters when the passage is somewhere else in the book", () => {
    expect(entersVisit(PAGE, "epubcfi(/6/2!/2/2/1:0)")).toBe(true);
    expect(entersVisit(PAGE, "epubcfi(/6/4!/12/2/1:0)")).toBe(true);
  });

  it("stays out when the passage is on the page already on screen", () => {
    // The reader opened the notes panel while reading and tapped a mark they can see. Nothing
    // has been left behind, so there is no progress to defend and no banner to raise.
    expect(entersVisit(PAGE, "epubcfi(/6/4!/4/6/1:2)")).toBe(false);
  });

  it("counts the page's own edges as on the page", () => {
    expect(entersVisit(PAGE, "epubcfi(/6/4!/4/2/1:0)")).toBe(false);
    expect(entersVisit(PAGE, "epubcfi(/6/4!/4/8/1:40)")).toBe(false);
  });

  it("enters on a passage that starts just past the page's far edge", () => {
    expect(entersVisit(PAGE, "epubcfi(/6/4!/4/8/1:41)")).toBe(true);
  });

  it("asks where a passage begins, not where it ends", () => {
    // A mark can run over the fold. It begins on this page, so the reader is looking at it.
    expect(entersVisit(PAGE, "epubcfi(/6/4!/4,/8/1:30,/10/1:4)")).toBe(false);
  });

  it("stays out when there is no page to compare against", () => {
    // `pageRange` is null on a full-page image and on rows written before the field existed.
    // Staying out is the quiet answer, the same one `lib/elsewhere.ts` gives: a mode the
    // reader never asked for should not be entered on a guess.
    expect(entersVisit(null, POINT)).toBe(false);
  });

  it("stays out when either side cannot be parsed", () => {
    expect(entersVisit("not a cfi", POINT)).toBe(false);
    expect(entersVisit(PAGE, "not a cfi")).toBe(false);
  });
});

describe("leavesVisit", () => {
  const kept = { cfi: POINT, pageRange: PAGE };

  it("leaves once the reader has read past what they had reached", () => {
    expect(leavesVisit(kept, { cfi: "epubcfi(/6/4!/12/2/1:0)", pageRange: null })).toBe(true);
  });

  it("stays while the reader is behind it", () => {
    expect(leavesVisit(kept, { cfi: "epubcfi(/6/2!/2/2/1:0)", pageRange: null })).toBe(false);
  });

  it("leaves when the page on screen is the one they had reached", () => {
    // Back home the long way — the scrubber, or turning forward page by page. The point need
    // not match: arriving anywhere on that page is arriving.
    const back = { cfi: "epubcfi(/6/4!/4/2/1:0)", pageRange: PAGE };
    expect(leavesVisit(kept, back)).toBe(true);
  });

  it("leaves on the exact point as readily as past it", () => {
    expect(leavesVisit(kept, { cfi: POINT, pageRange: null })).toBe(true);
  });

  it("stays when a page that is not theirs happens to be on screen", () => {
    const elsewhere = {
      cfi: "epubcfi(/6/2!/2/2/1:0)",
      pageRange: "epubcfi(/6/2!/2,/2/1:0,/4/1:9)",
    };
    expect(leavesVisit(kept, elsewhere)).toBe(false);
  });

  it("stays when a position cannot be parsed", () => {
    // Freezing the progress is the safe half of this: the banner's 'Stay here' is still there,
    // and leaving on a guess would write the visited page over what the reader had reached —
    // which is the whole thing this mode exists to prevent.
    expect(leavesVisit(kept, { cfi: "not a cfi", pageRange: null })).toBe(false);
    expect(
      leavesVisit({ cfi: "not a cfi", pageRange: null }, { cfi: POINT, pageRange: null }),
    ).toBe(false);
  });
});
