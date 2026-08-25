// A range's two ends, each as a position of its own. The join is the whole of it: a range
// stores a shared prefix plus two tails, and gluing a tail back on is a grammar question
// (`/6/4!/4` + `/10` is one document, not two). Ordering those ends against something else is
// compare.test.ts's; this only settles that what comes out is the right position.
import { describe, expect, test } from "vitest";
import { parseCfi, rangeEndpoints, serializeCfi } from "../../../src/epub/index.ts";

function ends(source: string): { start: string; end: string } {
  const { start, end } = rangeEndpoints(parseCfi(source));
  return { start: serializeCfi(start), end: serializeCfi(end) };
}

describe("a range", () => {
  test("joins each tail onto the shared prefix inside its last segment", () => {
    expect(ends("epubcfi(/6/4!/4,/10/1:0,/12/1:8)")).toEqual({
      start: "epubcfi(/6/4!/4/10/1:0)",
      end: "epubcfi(/6/4!/4/12/1:8)",
    });
  });

  test("keeps the indirection the prefix ends on", () => {
    // The join lands after the `!`, so both ends stay inside the section the range names.
    // Appending as a fresh segment instead would move them into a different document.
    expect(ends("epubcfi(/6/8!,/4/2/1:0,/4/2/1:5)")).toEqual({
      start: "epubcfi(/6/8!/4/2/1:0)",
      end: "epubcfi(/6/8!/4/2/1:5)",
    });
  });

  test("survives a range whose ends sit at the same place", () => {
    expect(ends("epubcfi(/6/4!/4/2,/1:3,/1:3)")).toEqual({
      start: "epubcfi(/6/4!/4/2/1:3)",
      end: "epubcfi(/6/4!/4/2/1:3)",
    });
  });
});

describe("a point", () => {
  // A point is a range whose ends coincide — the same reading `compareCfi()` already takes.
  // Callers holding either kind can then ask one question instead of branching first.
  test("is its own start and end", () => {
    expect(ends("epubcfi(/6/4!/4/2/1:7)")).toEqual({
      start: "epubcfi(/6/4!/4/2/1:7)",
      end: "epubcfi(/6/4!/4/2/1:7)",
    });
  });
});
