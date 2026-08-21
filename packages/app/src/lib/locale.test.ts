import { describe, expect, test } from "vitest";
import { matchLocale } from "./locale";

describe("matchLocale", () => {
  test("takes the exact tag when the browser names one Tidemarks speaks", () => {
    expect(matchLocale(["ja"])).toBe("ja");
    expect(matchLocale(["en"])).toBe("en");
    expect(matchLocale(["zh-TW"])).toBe("zh-TW");
  });

  test("ignores the region on tags that only have one interface language", () => {
    expect(matchLocale(["ja-JP"])).toBe("ja");
    expect(matchLocale(["en-GB"])).toBe("en");
    expect(matchLocale(["en-US"])).toBe("en");
  });

  test("is case-insensitive, because a stored header need not be canonical", () => {
    expect(matchLocale(["JA-jp"])).toBe("ja");
    expect(matchLocale(["zh-hant-tw"])).toBe("zh-TW");
  });

  test("sends every Chinese tag to zh-TW, simplified included", () => {
    // Traditional is readable to a simplified reader in a way English is not, so the
    // characters being the wrong variant beats the whole interface being the wrong language.
    // Converting the variant is a separate product decision and deliberately not made here.
    for (const tag of ["zh", "zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-CN", "zh-SG", "zh-Hans"]) {
      expect(matchLocale([tag])).toBe("zh-TW");
    }
  });

  test("walks the preference list in order and takes the first one it speaks", () => {
    expect(matchLocale(["ko", "ja", "en"])).toBe("ja");
    expect(matchLocale(["de", "fr", "zh-CN"])).toBe("zh-TW");
  });

  test("falls back to the source language when it speaks none of them", () => {
    expect(matchLocale(["ko", "de"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });

  test("does not mistake a tag that merely starts with the same letters", () => {
    // `jam` is Jamaican Creole and `enm` is Middle English: prefix matching without the
    // separator would answer Japanese and English respectively.
    expect(matchLocale(["jam"])).toBe("en");
    expect(matchLocale(["enm", "ja"])).toBe("ja");
  });
});
