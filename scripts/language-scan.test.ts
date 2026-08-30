import { describe, expect, it } from "vitest";
import { formatFindings, isExempt, scanFile } from "./language-scan.ts";

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

// The two mechanisms that decide what rule 2 weighs. Both have been wrong once, and both fail the
// same way when they are: the check goes quiet rather than loud.
describe("what gets weighed", () => {
  it("keeps checking after an unmatched backtick", () => {
    // Counting backticks per line latched here: one odd line and every later line was skipped.
    const text = ["// a `backtick that never closes", "// 這一行整句都是中文，該被抓到"].join("\n");
    expect(rules("src/a.ts", text)).toEqual(["chinese-line"]);
  });

  it("keeps checking after a template literal closes", () => {
    const text = [
      "const h = `",
      "  <p>本文がここにあります。</p>",
      "`;",
      "// 這一行是中文註解",
    ].join("\n");
    expect(scanFile("src/a.ts", text).map((f) => f.line)).toEqual([4]);
  });

  it("does not read an apostrophe in a comment as a string delimiter", () => {
    // "the reader's … the book's" looks like a quoted span, and taking it out would drop the
    // Chinese between them. Here the Chinese outweighs the English, so it has to be counted.
    expect(
      rules("src/a.ts", "// the reader's 目錄 與 筆記 兩張面板都在這裡，講的是同一件事"),
    ).toEqual(["chinese-line"]);
  });

  it("does not count English that a comment has put in quotes", () => {
    // Stripping the quoted half would leave the titles alone on the line and read as Chinese.
    expect(
      rules("src/a.ts", '// "the whole English sentence lives in here" 草枕 入境大廳'),
    ).toEqual([]);
  });

  it("leaves a Chinese title mark that is data rather than a citation", () => {
    expect(rules("src/a.ts", 'const t = "陶淵明〈桃花源記〉";')).toEqual([]);
  });
});

describe("the report", () => {
  it("says so plainly when there is nothing to say", () => {
    expect(formatFindings([])).toBe("Code is English throughout.");
  });

  it("names the file, the line, and what to do instead", () => {
    const findings = scanFile("src/a.ts", "// The three panels 〈找〉 can raise.");
    expect(formatFindings(findings)).toContain("src/a.ts:1");
    expect(formatFindings(findings)).toContain("[[Gesture]]");
    expect(formatFindings(findings)).toContain("1 to fix.");
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
