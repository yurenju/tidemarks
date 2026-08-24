// Whether a book is Chinese enough to be worth a 19 MB face, and which faces follow: the count
// that decides it, the family names, the weight descriptors, what a device already carries. No
// layer above repeats this — the download itself is web-font-store.test.ts.
import { describe, expect, it } from "vitest";
import { detectScript } from "./line-length";
import {
  WEB_FONTS,
  carriedFontKinds,
  faceWeightDescriptors,
  fontLanguageFor,
  needsWebFont,
  staleFontKeys,
  webFontKey,
  webFontsFor,
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
  // 19 MB on the reader’s connection: those characters render from the platform's own face
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
  // other way — nothing counted must not start a 19 MB download.
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

  // One file per kind now that the face is variable, where it used to be Regular and Bold
  // fetched in that order. There is no half-arrived state left to sequence.
  it("fetches one file for the kind, not one per weight", () => {
    expect(webFontsFor("serif")).toHaveLength(1);
    expect(webFontsFor("sans")).toHaveLength(1);
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

  // The family is the whole key now: one variable file answers for every weight, so there is
  // no second thing about a face to tell apart.
  it("keys a face by family, which is what a stored copy is looked up by", () => {
    const keys = WEB_FONTS.map(webFontKey);
    expect(new Set(keys).size).toBe(WEB_FONTS.length);
    expect(keys).toEqual(["Noto Serif CJK TC", "Noto Sans CJK TC"]);
  });
});

describe("faceWeightDescriptors", () => {
  // Two single-value ranges, and single-value is load-bearing. A range that *contains* the
  // requested weight passes it through unclamped, so a bold face declared `800 900` draws a
  // book's `font-weight: 900` at 900 and the two-weight rule breaks in its topmost cell.
  it("pins the face to the reader's two weights, one value each", () => {
    expect(faceWeightDescriptors("serif", true)).toEqual(["300 300", "800 800"]);
    expect(faceWeightDescriptors("sans", true)).toEqual(["300 300", "600 600"]);
  });

  // The book's own weights are the answer when the reader kept the book's fonts, so the face
  // answers for the whole axis and draws whatever was asked for.
  it("declares the whole axis when the book's own weights are to stand", () => {
    expect(faceWeightDescriptors("serif", false)).toEqual(["200 900"]);
    expect(faceWeightDescriptors("sans", false)).toEqual(["100 900"]);
  });

  // Noto Serif CJK's wght axis starts at 200 and Noto Sans CJK's at 100. Declaring a range
  // the file does not hold would be clamped to the file's own anyway, but saying it wrongly
  // is a claim nobody could check against the bytes.
  it("declares no weight the file cannot draw", () => {
    expect(faceWeightDescriptors("serif", false)[0]!.startsWith("200")).toBe(true);
    expect(faceWeightDescriptors("sans", false)[0]!.startsWith("100")).toBe(true);
  });
});

describe("carriedFontKinds", () => {
  it("says a kind is carried when its file is stored", () => {
    expect(carriedFontKinds(["Noto Serif CJK TC"])).toEqual({ serif: true, sans: false });
    expect(carriedFontKinds(["Noto Serif CJK TC", "Noto Sans CJK TC"])).toEqual({
      serif: true,
      sans: true,
    });
  });

  it("reads an empty device as carrying nothing", () => {
    expect(carriedFontKinds([])).toEqual({ serif: false, sans: false });
  });

  // The keys the two static faces were stored under. A device that has them holds bytes for
  // a face this build no longer ships, and reading them as "carried" would leave the reader
  // looking at the old Regular for good.
  it("does not read a superseded key as the face being carried", () => {
    expect(carriedFontKinds(["Noto Serif CJK TC/400", "Noto Serif CJK TC/700"])).toEqual({
      serif: false,
      sans: false,
    });
  });
});

describe("staleFontKeys", () => {
  // 33 MB of a face nobody will read again. `web-font.ts` used to ignore these, which was
  // right while the keys it did not recognise were only ever an older build's — now there is
  // a known pair of them on every device that ever picked a face.
  it("names the keys this build no longer ships", () => {
    expect(
      staleFontKeys(["Noto Serif CJK TC/400", "Noto Serif CJK TC", "Noto Sans CJK TC"]),
    ).toEqual(["Noto Serif CJK TC/400"]);
  });

  it("names nothing on a device holding only today's faces", () => {
    expect(staleFontKeys(WEB_FONTS.map(webFontKey))).toEqual([]);
  });

  it("names nothing on an empty device", () => {
    expect(staleFontKeys([])).toEqual([]);
  });
});
