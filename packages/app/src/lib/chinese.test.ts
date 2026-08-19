import { describe, expect, it } from "vitest";
import { detectVariant, fontStack } from "./chinese";

describe("detectVariant", () => {
  it("trusts explicit language tags", () => {
    expect(detectVariant("zh-CN", "")).toBe("simplified");
    expect(detectVariant("zh-Hans", "")).toBe("simplified");
    expect(detectVariant("zh-TW", "这是简体")).toBe("traditional");
    expect(detectVariant("zh-Hant", "")).toBe("traditional");
  });

  it('falls back to character counting for bare "zh"', () => {
    expect(detectVariant("zh", "生活就像点菜，饥饿时菜会点得特别多，这就是决策的复杂性")).toBe(
      "simplified",
    );
    expect(detectVariant("zh", "小說是寫給人看的，武俠小說與別的小說一樣，也是寫人")).toBe(
      "traditional",
    );
  });

  it("stays undecided when the sample has no distinguishing characters", () => {
    // CJK text made of characters shared by both variants must not lock in a guess
    expect(detectVariant("zh", "著者：丹尼尔·卡尼曼")).toBeNull();
    expect(detectVariant("zh", "Hello world")).toBeNull();
    expect(detectVariant(undefined, "")).toBeNull();
  });
});

describe("fontStack", () => {
  it("puts Traditional Chinese fonts first for traditional books", () => {
    expect(fontStack("sans", false)).toMatch(/^'Noto Sans CJK TC'/);
    expect(fontStack("serif", false)).toMatch(/^'Noto Serif CJK TC'/);
  });

  it("puts Simplified Chinese fonts first for simplified books", () => {
    expect(fontStack("sans", true)).toMatch(/^'Noto Sans CJK SC'/);
    expect(fontStack("serif", true)).toMatch(/^'Noto Serif CJK SC'/);
    // traditional fonts must not appear before the simplified ones
    expect(fontStack("sans", true).indexOf("SC")).toBeLessThan(
      fontStack("sans", true).indexOf("TC"),
    );
  });
});

describe("fontStack names every release of the typeface", () => {
  // Distro packages — Debian/Ubuntu's fonts-noto-cjk, Fedora's google-noto-*-cjk-fonts —
  // register `Noto Serif CJK TC`, which is a different string from Google Fonts' subsetted
  // `Noto Serif TC`. CSS matches family names exactly, so naming only the latter misses the
  // most common way CJK fonts get installed on Linux and drops the reader all the way
  // through to the platform default (#38).
  const families = (kind: "sans" | "serif", simplified: boolean) =>
    fontStack(kind, simplified).split(", ");

  /** Asserts both are in the stack, so a name going missing cannot pass as "ordered". */
  const comesBefore = (stack: string[], first: string, second: string) => {
    expect(stack).toContain(first);
    expect(stack).toContain(second);
    expect(stack.indexOf(first)).toBeLessThan(stack.indexOf(second));
  };

  it("names the families distro packages register, ahead of the Windows and macOS faces", () => {
    for (const simplified of [false, true]) {
      comesBefore(families("serif", simplified), "'Noto Serif CJK TC'", "'PMingLiU'");
      comesBefore(families("serif", simplified), "'Noto Serif CJK SC'", "'SimSun'");
      comesBefore(families("sans", simplified), "'Noto Sans CJK TC'", "'Microsoft JhengHei'");
      comesBefore(families("sans", simplified), "'Noto Sans CJK SC'", "'Microsoft YaHei'");
    }
  });

  // spine carries this face itself now (ADR-0014), and the `@font-face` it declares uses
  // this same name so that it beats an installed copy of unknown version. It cannot beat a
  // *different* name sitting ahead of it, though — a reader with Google Fonts' subsetted
  // `Noto Serif TC` installed would get that one, which is not the file spine shipped.
  it("leads with the name spine’s own copy registers under", () => {
    for (const simplified of [false, true]) {
      comesBefore(families("serif", simplified), "'Noto Serif CJK TC'", "'Noto Serif TC'");
      comesBefore(families("serif", simplified), "'Noto Serif CJK SC'", "'Noto Serif SC'");
      comesBefore(families("sans", simplified), "'Noto Sans CJK TC'", "'Noto Sans TC'");
      comesBefore(families("sans", simplified), "'Noto Sans CJK SC'", "'Noto Sans SC'");
    }
  });

  it("names Adobe's release of the same design for the sans faces too, not just the serif", () => {
    for (const simplified of [false, true]) {
      comesBefore(families("serif", simplified), "'Source Han Serif TC'", "'PMingLiU'");
      comesBefore(families("sans", simplified), "'Source Han Sans TC'", "'PingFang TC'");
    }
  });

  // An iPhone has none of the Noto or Source Han names and none of the Windows ones, so a
  // stack whose only remaining entry is the generic keyword resolves to PingFang — a sans —
  // whichever kind was asked for. That is a font choice that changes nothing on screen, and
  // the serif stacks used to be exactly that stack.
  it("names a face that exists on iOS and macOS, for both kinds", () => {
    const APPLE_FACES = ["'PingFang TC'", "'PingFang SC'", "'Songti TC'", "'Songti SC'"];
    for (const kind of ["sans", "serif"] as const) {
      for (const simplified of [false, true]) {
        expect(families(kind, simplified).some((f) => APPLE_FACES.includes(f))).toBe(true);
      }
    }
  });

  it("puts the Apple serif faces ahead of the Windows ones, as the sans stacks do", () => {
    for (const simplified of [false, true]) {
      comesBefore(families("serif", simplified), "'Songti TC'", "'PMingLiU'");
      comesBefore(families("serif", simplified), "'Songti SC'", "'SimSun'");
    }
  });
});

describe("fontStack as a generic-family substitute", () => {
  // The stacks are handed to frond as `settings.genericFamilies`, and frond keeps the
  // keyword as the last resort only when the stack does not already end with it — so a
  // stack ending in the generic is what keeps the emitted CSS free of `serif, serif`.
  it("ends with the generic family it stands in for", () => {
    expect(fontStack("serif", false).endsWith("serif")).toBe(true);
    expect(fontStack("sans", false).endsWith("sans-serif")).toBe(true);
  });

  it("puts the variant that matches the book first", () => {
    expect(fontStack("serif", true).indexOf("SC")).toBeLessThan(
      fontStack("serif", true).indexOf("TC"),
    );
    expect(fontStack("serif", false).indexOf("TC")).toBeLessThan(
      fontStack("serif", false).indexOf("SC"),
    );
  });
});
