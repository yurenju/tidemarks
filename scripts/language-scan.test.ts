import { describe, expect, it } from "vitest";
import { isExempt, scanFile } from "./language-scan.ts";

const rules = (path: string, text: string) => scanFile(path, text).map((f) => f.rule);

describe("what it catches", () => {
  it("catches a comment written in Chinese", () => {
    expect(rules("src/a.ts", "// 這一行是中文的註解，不該留在程式碼裡")).toEqual(["chinese-line"]);
  });

  it("catches a glossary term cited the Chinese way", () => {
    expect(rules("src/a.ts", "// The three panels 〈找〉 can raise.")).toEqual(["citation"]);
  });

  it("catches a test named in Chinese", () => {
    expect(rules("src/a.test.ts", 'it("欄數 is taken away", () => {})')).toEqual(["test-name"]);
  });

  it("catches a whole Chinese comment even where the file also holds Chinese data", () => {
    const text = ['const title = "草枕";', "// 這個 fixture 是日文的，所以上面那行留著"].join("\n");
    expect(rules("src/a.ts", text)).toEqual(["chinese-line"]);
  });
});

describe("what it leaves alone", () => {
  it("leaves an English sentence that quotes a book title", () => {
    expect(rules("src/a.ts", "// Measured on 草枕, which is vertical Japanese.")).toEqual([]);
  });

  it("leaves a fixture string, however long", () => {
    expect(rules("src/a.test.ts", 'const sample = "生活就像点菜，饥饿时菜会点得特别多";')).toEqual(
      [],
    );
  });

  it("leaves markup inside a template literal spanning several lines", () => {
    const text = ["const html = `", "  <p>本文がここにあります。</p>", "`;"].join("\n");
    expect(rules("src/a.test.ts", text)).toEqual([]);
  });

  it("leaves a term cited the English way", () => {
    expect(rules("src/a.ts", "// The three panels [[Find]] can raise.")).toEqual([]);
  });

  it("leaves a file with no Chinese in it at all", () => {
    expect(rules("src/a.ts", "export const x = 1;")).toEqual([]);
  });
});

describe("exemptions", () => {
  it("exempts the files whose subject is Chinese", () => {
    expect(isExempt("scripts/zh-rules.ts")).toBe(true);
    expect(isExempt("packages/app/src/lib/chinese.ts")).toBe(true);
  });

  it("exempts a directory by prefix, and only that directory", () => {
    expect(isExempt("prototype/touch-to-search.html")).toBe(true);
    expect(isExempt("packages/app/src/prototype-ish.ts")).toBe(false);
  });

  it("does not exempt a file that merely sits beside an exempt one", () => {
    expect(isExempt("scripts/deploy.ts")).toBe(false);
  });
});
