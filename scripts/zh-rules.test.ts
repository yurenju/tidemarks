// The rules and the diff reader. Nothing above this: `scripts/` has no other layer, and both
// halves fail quietly — a rule that cannot separate right from wrong gets obeyed by rewriting
// the correct sentence, and a misread diff header produces an empty report that looks exactly
// like clean writing.
//
// The two levels are asserted rather than described, because the distinction between them is
// the whole design and it is invisible in the data.

import { describe, expect, test } from "vitest";
import {
  CHECK_RULES,
  FIX_LABEL,
  formatFinding,
  isIgnored,
  lint,
  MUST_RULES,
  parseAddedLines,
  RULES,
  summarise,
  type Rule,
} from "./zh-rules.ts";

function only(rule: Rule, text: string) {
  return lint([{ line: 1, text }], [rule]);
}

describe("the rules themselves", () => {
  test.each(RULES.map((rule) => [rule.id, rule] as const))(
    "%s catches its own bad example",
    (_id, rule) => {
      expect(only(rule, rule.bad)).toHaveLength(1);
    },
  );

  // The definition of the second level, asserted rather than described: a rule belongs there
  // precisely because its pattern also fires on correct Chinese. One that can tell the two
  // apart is a rule that should be moved up, and this is what would notice.
  test.each(CHECK_RULES.map((rule) => [rule.id, rule] as const))(
    "%s cannot tell its good example apart",
    (_id, rule) => {
      expect(only(rule, rule.good)).toHaveLength(1);
    },
  );

  test("ids are unique", () => {
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
  });
});

// The first level is applied without anybody reading the sentence, so a false positive there
// costs more than a missed word: it teaches the reader to ignore the whole report.
describe("the first level leaves ordinary writing alone", () => {
  const correct = [
    "截圖預設只做 chromium 一家，三家都截的只有動到渲染層的改動。",
    "這條規則本來就在檔案裡，這次沒有改到它。",
    "這個改動不簡單，要動到三個檔案。",
    "服務收到關閉訊號的時候，先把手上的請求跑完再斷。",
    "這裡容易出錯，之後會很難收。",
    "這兩欄要怎麼分，依據的是資料屬於誰。",
    "取樣器、trace helper、instrumented logging 都算量測的那一半。",
    // Both of these used to fail. `返回` is what Android's back button is called here, and
    // Japanese kanji share too many characters with Simplified Chinese for a character to
    // decide anything on its own — this repository quotes Japanese on purpose.
    "Android 的返回鍵關的是抽屜而不是整個 app。",
    "`书→書` 對照表換掉就沒有東西可測了，日文的ゴシック体同理。",
  ];

  test.each(correct)("%s", (text) => {
    expect(lint([{ line: 1, text }], MUST_RULES)).toEqual([]);
  });
});

describe("lint", () => {
  test("reports the line a finding is on", () => {
    const findings = lint([
      { line: 7, text: "這句沒有問題。" },
      { line: 9, text: "這個值每次都重設——所以手動改沒有用。" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(9);
    expect(findings[0]?.rule.id).toBe("em-dash");
  });

  test("a line can break more than one rule", () => {
    const findings = lint([{ line: 1, text: "這個 bug 會咬你——而且很痛。" }]);
    expect(findings.map((finding) => finding.rule.id).sort()).toEqual(["bite", "em-dash", "pain"]);
  });

  test("trims the quoted line but keeps the whole of it", () => {
    const findings = lint([{ line: 1, text: "   這個操作很昂貴，要跑三分鐘。   " }]);
    expect(findings[0]?.text).toBe("這個操作很昂貴，要跑三分鐘。");
  });
});

describe("isIgnored", () => {
  test("a document that teaches the rules opts out", () => {
    expect(isIgnored("# 規則\n\n<!-- zh-lint: ignore-file -->\n")).toBe(true);
  });

  test("an ordinary document does not", () => {
    expect(isIgnored("# 說明\n\n這是一份文件。\n")).toBe(false);
  });
});

describe("formatFinding", () => {
  test("a first-level finding says what to write instead, and nothing else", () => {
    const finding = lint([{ line: 3, text: "截圖預設只拍 chromium。" }], MUST_RULES)[0];
    const report = formatFinding("docs/a.md", finding!);
    expect(report).toContain("docs/a.md:3");
    expect(report).toContain("一定要改");
    expect(report).not.toContain("正例");
  });

  // Without the pair of examples the reader has only the matched character, and the correct
  // sentences in the report look exactly like the wrong ones.
  test("a second-level finding carries both examples", () => {
    const finding = lint([{ line: 3, text: "這個 fixture 買到的是什麼。" }], CHECK_RULES)[0];
    const report = formatFinding("docs/a.md", finding!);
    expect(report).toContain("要檢查");
    expect(report).toContain("正例：");
    expect(report).toContain("反例：");
  });

  // The label and the advice used to say the same thing twice: "把動作寫出來：把動作寫出來：…".
  test("the advice does not repeat the label it is printed under", () => {
    for (const rule of RULES) expect(rule.fix.startsWith(FIX_LABEL[rule.fixKind])).toBe(false);
  });

  test("names the three kinds of repair by what they ask for", () => {
    const hook = CHECK_RULES.find((rule) => rule.id === "hook")!;
    expect(formatFinding("a.md", only(hook, hook.bad)[0]!)).toContain("用英文原文");
    const graceful = MUST_RULES.find((rule) => rule.id === "graceful")!;
    expect(formatFinding("a.md", only(graceful, graceful.bad)[0]!)).toContain("把動作寫出來");
  });
});

// Every bug here is a silent one: the report comes back empty and empty reads as clean.
describe("parseAddedLines", () => {
  const diff = (body: string) => parseAddedLines(body.trim().split("\n").join("\n"));

  test("added lines carry the line number the hunk header gives them", () => {
    const [file] = diff(`
diff --git a/a.md b/a.md
--- a/a.md
+++ b/a.md
@@ -3,0 +4,2 @@
+第一行
+第二行
`);
    expect(file?.path).toBe("a.md");
    expect(file?.lines).toEqual([
      { line: 4, text: "第一行" },
      { line: 5, text: "第二行" },
    ]);
  });

  test("a second hunk restarts the count", () => {
    const [file] = diff(`
+++ b/a.md
@@ -1 +1 @@
+甲
@@ -9,0 +20,1 @@
+乙
`);
    expect(file?.lines.map((line) => line.line)).toEqual([1, 20]);
  });

  test("removed lines and the file they came from are not added lines", () => {
    const files = diff(`
--- a/gone.md
+++ /dev/null
@@ -1 +0,0 @@
-沒了
`);
    expect(files).toEqual([]);
  });

  // Both of these used to come back as no findings at all rather than as an error.
  test("a path with a space keeps its name, without git's padding tab", () => {
    const [file] = diff("+++ b/my file.md\t\n@@ -0,0 +1 @@\n+字");
    expect(file?.path).toBe("my file.md");
  });

  test("a Chinese path survives", () => {
    const [file] = diff("+++ b/docs/中文.md\n@@ -0,0 +1 @@\n+字");
    expect(file?.path).toBe("docs/中文.md");
  });
});

describe("summarise", () => {
  test("counts each rule, commonest first", () => {
    const findings = lint([
      { line: 1, text: "一——二" },
      { line: 2, text: "三——四" },
      { line: 3, text: "這個操作很昂貴" },
    ]);
    expect(summarise(findings)).toEqual([
      { id: "em-dash", count: 2 },
      { id: "expensive", count: 1 },
    ]);
  });
});
