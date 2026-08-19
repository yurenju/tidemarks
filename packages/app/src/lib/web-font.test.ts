import { describe, expect, it } from "vitest";
import { detectScript } from "./line-length";
import {
  WEB_FONTS,
  carriedFontKinds,
  fontLanguageFor,
  needsWebFont,
  webFontKey,
  webFontsFor,
  weightRange,
} from "./web-font";

describe("needsWebFont", () => {
  it("says yes for a book set in Han characters", () => {
    expect(needsWebFont("小說是寫給人看的，武俠小說與別的小說一樣，也是寫人。".repeat(10))).toBe(
      true,
    );
    expect(
      needsWebFont("生活就像点菜，饥饿时菜会点得特别多，这就是决策的复杂性。".repeat(10)),
    ).toBe(true);
  });

  it("says no for a book with no Han characters at all", () => {
    expect(
      needsWebFont("Alice was beginning to get very tired of sitting by her sister.".repeat(20)),
    ).toBe(false);
    expect(needsWebFont("")).toBe(false);
  });

  // A Latin book quoting Han characters — a linguistics text, a travel memoir — is not worth
  // 16 MB on the reader's connection: those characters render from the platform's own face
  // as they always have. Forty of them scattered through a chapter is still quoting.
  it("says no when Han characters are only quoted in passing", () => {
    const quoting = "Latin prose carries on. 漢字。".repeat(20);
    expect(needsWebFont(quoting)).toBe(false);
  });

  // Han unification means a Japanese book is mostly the same code points as a Chinese one,
  // so counting Han alone would call it Chinese and shape it with `ZHT` — which is exactly
  // the glyph variant a Japanese reader would notice was wrong (#55). The kana say otherwise.
  it("says no for a Japanese book, however much Han it contains", () => {
    const japanese = "山路を登りながら、こう考えた。智に働けば角が立つ。".repeat(30);
    expect(japanese.length).toBeGreaterThan(500);
    expect(needsWebFont(japanese)).toBe(false);
  });

  it("says no for a Korean book too, for the same reason", () => {
    expect(needsWebFont("한국어 문장입니다 漢字 文章.".repeat(40))).toBe(false);
  });

  // The other way round: a Chinese book quoting a Japanese title is still a Chinese book.
  it("says yes for a Chinese book that quotes a little Japanese", () => {
    const chinese = "武俠小說與別的小說一樣，也是寫人的。".repeat(20);
    expect(needsWebFont(`${chinese}（『草枕』のこと）`)).toBe(true);
  });

  // The other side of the same threshold, so it is pinned from both directions: a book can
  // be short — a novella, or one opening on a title page — and still be a Chinese book.
  it("says yes for a short book that is nonetheless set in Chinese", () => {
    expect(needsWebFont("武俠小說與別的小說一樣，也是寫人的。".repeat(8))).toBe(true);
  });

  // The whole reason this is a second judgement rather than a reuse of `detectScript`: that
  // one answers "how wide is a character", and answers `'cjk'` when it counted nothing at
  // all, because a line too short is the safe failure there. Here the safe failure runs the
  // other way — nothing counted must not start a 16 MB download.
  it("disagrees with detectScript exactly where the safe default differs", () => {
    for (const sample of ["", "   ", "01234567890 ......"]) {
      expect(detectScript(sample)).toBe("cjk");
      expect(needsWebFont(sample)).toBe(false);
    }
  });
});

describe("fontLanguageFor", () => {
  // The tags are OpenType language system tags, which is what `font-language-override`
  // takes. A pan-CJK face carries all five and switches glyphs on `locl`, so this is the
  // whole of what decides whether 直 and 骨 come out Traditional or Simplified.
  it("names the OpenType language system, not a BCP 47 tag", () => {
    expect(fontLanguageFor(true)).toBe("ZHS");
    expect(fontLanguageFor(false)).toBe("ZHT");
  });
});

describe("webFontsFor", () => {
  it("fetches the serif face when the reader picked 明體", () => {
    expect(webFontsFor("serif").every((f) => f.kind === "serif")).toBe(true);
  });

  it("fetches the sans face when the reader picked 黑體", () => {
    expect(webFontsFor("sans").every((f) => f.kind === "sans")).toBe(true);
  });

  // 'publisher' leaves the book's own `font-family` declarations standing, and a book naming
  // no face at all delegates to `serif` far more often than to `sans-serif`. Fetching both
  // would double the cost to cover the rarer half.
  it("fetches the serif face when the reader kept the book’s own fonts", () => {
    expect(webFontsFor("publisher").every((f) => f.kind === "serif")).toBe(true);
  });

  // Regular is the body text; Bold is the headings inside it. Fetching them the other way
  // round would leave a reader looking at 16 MB of progress before a single paragraph
  // changed face. Both kinds carry a real Bold.
  it("fetches Regular before Bold, for either face", () => {
    expect(webFontsFor("serif").map((f) => f.weight)).toEqual([400, 700]);
    expect(webFontsFor("sans").map((f) => f.weight)).toEqual([400, 700]);
  });
});

describe("WEB_FONTS", () => {
  // The family name is the one the platform's own copy would register under, so an
  // `@font-face` under that name wins over an installed copy of unknown version rather than
  // sitting beside it.
  it("names the faces by the name the typeface actually ships under", () => {
    expect(WEB_FONTS.map((f) => f.family)).toContain("Noto Serif CJK TC");
    expect(WEB_FONTS.map((f) => f.family)).toContain("Noto Sans CJK TC");
  });

  it("serves every face from spine’s own origin, never a third party", () => {
    for (const font of WEB_FONTS) expect(font.path).toMatch(/^\/fonts\/[\w-]+\.woff2$/);
  });

  // Family alone is not a key: each face ships at two weights under one name, and a store
  // keyed on the name would hand the Bold bytes back for a Regular request.
  it("keys a face by family and weight, which is what a stored copy is looked up by", () => {
    const keys = WEB_FONTS.map(webFontKey);
    expect(new Set(keys).size).toBe(WEB_FONTS.length);
    expect(keys).toContain("Noto Serif CJK TC/400");
    expect(keys).toContain("Noto Serif CJK TC/700");
    expect(keys).toContain("Noto Sans CJK TC/400");
    expect(keys).toContain("Noto Sans CJK TC/700");
  });
});

describe("weightRange", () => {
  // The whole point of the range: 500 is where CSS searches downwards first, so two faces
  // declared at 400 and 700 alone draw a book's `font-weight: 500` emphasis in the same
  // Regular as the body text around it.
  it("gives 500 to the Bold rather than letting it fall back to the Regular", () => {
    expect(weightRange(700)).toBe("500 900");
    expect(weightRange(400)).toBe("100 400");
  });

  it("covers the whole scale between the two faces, leaving no weight unmatched", () => {
    const bounds = WEB_FONTS.filter((f) => f.kind === "serif").map((f) => weightRange(f.weight));
    expect(bounds).toEqual(["100 400", "500 900"]);
  });
});

describe("carriedFontKinds", () => {
  it("says a kind is carried only when every weight of it is stored", () => {
    expect(carriedFontKinds(["Noto Serif CJK TC/400"])).toEqual({ serif: false, sans: false });
    expect(carriedFontKinds(["Noto Serif CJK TC/400", "Noto Serif CJK TC/700"])).toEqual({
      serif: true,
      sans: false,
    });
  });

  it("reads an empty device as carrying nothing", () => {
    expect(carriedFontKinds([])).toEqual({ serif: false, sans: false });
  });

  it("ignores keys that belong to no face this build ships", () => {
    expect(carriedFontKinds(["Some Old Face/400", ...WEB_FONTS.map(webFontKey)])).toEqual({
      serif: true,
      sans: true,
    });
  });
});
