import { describe, expect, it } from "vitest";
import { matchLocale, parseAcceptLanguage } from "./locale";

describe("matchLocale", () => {
  it("takes the exact tag when the browser names one Tidemarks speaks", () => {
    expect(matchLocale(["ja"])).toBe("ja");
    expect(matchLocale(["en"])).toBe("en");
    expect(matchLocale(["zh-TW"])).toBe("zh-TW");
  });

  it("ignores the region on tags that only have one interface language", () => {
    expect(matchLocale(["ja-JP"])).toBe("ja");
    expect(matchLocale(["en-GB"])).toBe("en");
    expect(matchLocale(["en-US"])).toBe("en");
  });

  it("is case-insensitive, because a stored header need not be canonical", () => {
    expect(matchLocale(["JA-jp"])).toBe("ja");
    expect(matchLocale(["zh-hant-tw"])).toBe("zh-TW");
  });

  it("sends every Chinese tag to zh-TW, simplified included", () => {
    // Traditional is readable to a simplified reader in a way English is not, so the
    // characters being the wrong variant beats the whole interface being the wrong language.
    // Converting the variant is a separate product decision and deliberately not made here.
    for (const tag of ["zh", "zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-CN", "zh-SG", "zh-Hans"]) {
      expect(matchLocale([tag])).toBe("zh-TW");
    }
  });

  it("walks the preference list in order and takes the first one it speaks", () => {
    expect(matchLocale(["ko", "ja", "en"])).toBe("ja");
    expect(matchLocale(["de", "fr", "zh-CN"])).toBe("zh-TW");
  });

  it("falls back to the source language when it speaks none of them", () => {
    expect(matchLocale(["ko", "de"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });

  it("does not mistake a tag that merely starts with the same letters", () => {
    // `jam` is Jamaican Creole and `enm` is Middle English: prefix matching without the
    // separator would answer Japanese and English respectively.
    expect(matchLocale(["jam"])).toBe("en");
    expect(matchLocale(["enm", "ja"])).toBe("ja");
  });
});

describe("parseAcceptLanguage", () => {
  it("reads a plain list in the order it was written", () => {
    expect(parseAcceptLanguage("ja,en-US,zh-TW")).toEqual(["ja", "en-US", "zh-TW"]);
  });

  // Browsers write the list in preference order already, so the two agree in practice — but the
  // header is a wire format and anything may send one, and by the specification q is what
  // decides.
  it("puts the quality values in charge of the order", () => {
    expect(parseAcceptLanguage("en-US;q=0.8,ja;q=0.9")).toEqual(["ja", "en-US"]);
    expect(parseAcceptLanguage("en;q=0.5,ja;q=1.0")).toEqual(["ja", "en"]);
  });

  it("keeps the written order where the qualities tie", () => {
    expect(parseAcceptLanguage("en;q=0.9,ja;q=0.9")).toEqual(["en", "ja"]);
  });

  it("ignores the wildcard, which asks for nothing in particular", () => {
    expect(parseAcceptLanguage("ja,*;q=0.5")).toEqual(["ja"]);
  });

  it("survives whitespace, empty entries and a missing header", () => {
    expect(parseAcceptLanguage(" ja ,, en ")).toEqual(["ja", "en"]);
    expect(parseAcceptLanguage("")).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("feeds matchLocale, which is the only reason it exists", () => {
    expect(matchLocale(parseAcceptLanguage("ja-JP,en;q=0.7"))).toBe("ja");
    expect(matchLocale(parseAcceptLanguage("de,zh-CN;q=0.4"))).toBe("zh-TW");
  });
});
