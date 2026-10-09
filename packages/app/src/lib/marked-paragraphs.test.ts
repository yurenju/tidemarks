// The paragraphs set above a note on the phone's one-note page. Where a paragraph ends is frond's
// (packages/frond/tests/node/cfi/content-document.test.ts); what is here is the cut around the
// mark and the answer for a mark the section cannot place.
import { describe, expect, it } from "vitest";
import { ContentDocument, serializeCfi } from "@yurenju/frond/epub";
import { paragraphsOf } from "./marked-paragraphs";

function section(body: string): ContentDocument {
  return ContentDocument.parse(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    2,
  );
}

const markOf = (document: ContentDocument, start: number, end: number) =>
  serializeCfi(document.cfiForCharacters(start, end)!);

describe("paragraphsOf", () => {
  it("sets the mark between the rest of its paragraph", () => {
    const document = section("<p>Alice was beginning to get very tired.</p><p>Next.</p>");
    expect(paragraphsOf(document, markOf(document, 6, 9))).toEqual([
      { before: "Alice ", marked: "was", after: " beginning to get very tired." },
    ]);
  });

  it("gives every paragraph a mark runs across, and the mark's share of each", () => {
    const document = section("<p>一段。</p><p>第二段。</p><p>三。</p>");
    // Three paragraphs; the mark runs from the second character of the first into the second.
    expect(paragraphsOf(document, markOf(document, 1, 5))).toEqual([
      { before: "一", marked: "段。", after: "" },
      { before: "", marked: "第二", after: "段。" },
    ]);
  });

  it("closes up the XHTML's line breaks, at a seam as well as inside a run", () => {
    const document = section("<p>醫院。\n　當我陷入昏迷時</p>");
    expect(paragraphsOf(document, markOf(document, 5, 7))).toEqual([
      { before: "醫院。", marked: "當我", after: "陷入昏迷時" },
    ]);
  });

  it("is nothing for a mark another section holds", () => {
    const document = section("<p>本文</p>");
    expect(paragraphsOf(document, "epubcfi(/6/8!/4/2,/1:0,/1:1)")).toBeNull();
  });

  it("is nothing for a CFI that will not parse", () => {
    expect(paragraphsOf(section("<p>本文</p>"), "not a cfi")).toBeNull();
  });
});

describe("paragraphsOf, over ruby", () => {
  it("leaves the readings out, inside the mark and around it", () => {
    const document = section(
      "<p><ruby>山路<rp>(</rp><rt>やまみち</rt><rp>)</rp></ruby>を<ruby>登<rt>のぼ</rt></ruby>りながら</p>",
    );
    // 山路(やまみち)を登のぼりながら — the mark is を登のぼり, from offset 8 to 13.
    expect(paragraphsOf(document, markOf(document, 8, 13))).toEqual([
      { before: "山路", marked: "を登り", after: "ながら" },
    ]);
  });
});
