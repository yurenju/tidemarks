// The judgement half of the language check: given a file's text, which lines break the rule
// that code is written in English (CLAUDE.md, ADR-0045). `check-language.ts` finds the files and
// prints the verdict; this half is pure so that it can be tested, the same split `i18n-audit.ts`
// makes.
//
// The rule cannot be "no Chinese characters in code files", tempting as that is to write. Roughly
// a hundred and thirty files hold Chinese that is *data*: the titles of the books a measurement
// was taken on, the characters whose glyphs differ between regions, the 简繁 table, fixture prose.
// A flat rule would need every one of them exempted, and an exemption list that long stops being
// read.
//
// So three narrower rules, each aimed at a way the boundary actually breaks:
//
//   1. 〈…〉 outside a string. The Chinese title mark cites a glossary term, and a comment citing
//      one is an English sentence with a Chinese word inside it. Code cites [[English]] instead.
//   2. A line with more Chinese than Latin in it. A comment quoting a title stays mostly Latin; a
//      comment written in Chinese does not. What gets counted depends on the kind of line, which
//      is the whole trick — see `weighable` below.
//   3. Chinese inside a test's name. Those are read as a report, and the report is in English.
//
// Rule 2 is the loose one and it is loose on purpose: it catches the obvious shape and promises
// nothing beyond it. A comment written in Chinese cannot get past it; an English sentence quoting
// 草枕 is never mistaken for one.
//
// Two things it cannot see, both left to review:
//
// ⚠️ **A label dropped into an English sentence**, `the reader's 目錄 and 筆記`. Two characters in
// forty of Latin, which is the same shape as a comment quoting 草枕 — and this repository quotes
// book titles constantly. There is no ratio that keeps one and drops the other. Marked citations
// are what rule 1 is for; bare ones get through.
//
// ⚠️ **A name inside a table of cases.** `it.each([["…", 1]])` puts the test's name in a string,
// where rule 3 does not look and rule 2 does not count. `chrome.test.ts` is written that way, and
// nothing cheap separates those strings from fixture prose.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const LATIN = /[A-Za-z]/gu;
const CITATION = /〈[^〉]*〉/u;
const TEST_NAME =
  /\b(?:it|test|describe)(?:\.\w+)*\(\s*[`"'][^`"']*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;

/**
 * Files whose Chinese is the subject rather than the writing, and which no ratio can clear.
 *
 * ⚠️ **Exemption is per file, so a Chinese comment inside one of these is invisible to the
 * check.** Keeping the list this short is what keeps that acceptable: it stays at the files whose
 * whole reason for existing is Chinese text. A list that starts growing is the rule coming loose,
 * not the list being useful.
 */
export const EXEMPT = [
  "scripts/zh-rules.ts", // the strings being matched on are the rules themselves
  "scripts/zh-rules.test.ts",
  "scripts/zh-lint.ts",
  "scripts/language-scan.ts", // this file, which has to name what it is looking for
  "scripts/language-scan.test.ts",
  "packages/app/src/lib/chinese.ts", // the Simplified-to-Traditional table
  "packages/app/src/lib/chinese.test.ts",
  "packages/app/src/lib/locale.ts", // the three language names, each written in itself
  "prototype/", // throwaway pages, never shipped (CLAUDE.md)
];

export interface Finding {
  path: string;
  line: number;
  rule: "citation" | "chinese-line" | "test-name";
  text: string;
}

const ADVICE: Record<Finding["rule"], string> = {
  citation: "cite the glossary in English: 〈手勢〉 becomes [[Gesture]]",
  "chinese-line": "code is written in English (CLAUDE.md, ADR-0045)",
  "test-name": "a test's name is read as a report, and the report is in English",
};

export const isExempt = (path: string): boolean =>
  EXEMPT.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * Template literals emptied out, in place: the backticks and the newlines stay, everything between
 * them goes.
 *
 * Done over the whole file rather than line by line, because a template literal is one string
 * however many lines it covers, and fixture markup is written that way. Counting backticks per
 * line instead would be worse than wrong: one unmatched backtick in a comment — this repository
 * writes `identifiers` constantly — would leave the state stuck for every line after it, and a
 * check that has quietly stopped checking reads exactly like a clean one.
 */
const blankTemplates = (text: string): string =>
  text.replace(/`[^`]*`/gs, (span) => "`" + span.slice(1, -1).replace(/[^\n]/g, " ") + "`");

/**
 * The part of a line whose language is the author's rather than the data's.
 *
 * A comment counts whole. Its quotation marks are apostrophes as often as they are string
 * delimiters ("the reader's 目錄"), and taking a span out on that guess loses the Chinese it was
 * meant to weigh.
 *
 * Any other line has its double-quoted spans taken out first, because that is where fixture prose,
 * catalog entries and book titles live.
 */
const weighable = (line: string): string =>
  COMMENT.test(line) ? line : line.replace(/"[^"]*"/g, "");

export function scanFile(path: string, text: string): Finding[] {
  if (isExempt(path)) return [];
  const findings: Finding[] = [];
  blankTemplates(text)
    .split("\n")
    .forEach((line, i) => {
      if (count(line, CJK) === 0) return;
      const bare = weighable(line);
      const rule = CITATION.test(bare)
        ? "citation"
        : TEST_NAME.test(line)
          ? "test-name"
          : count(bare, CJK) > count(bare, LATIN)
            ? "chinese-line"
            : undefined;
      if (rule) findings.push({ path, line: i + 1, rule, text: line.trim() });
    });
  return findings;
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "Code is English throughout.";
  const lines = findings.map((f) => `${f.path}:${f.line}\n  ${f.text}\n  → ${ADVICE[f.rule]}`);
  return [...lines, "", `${findings.length} to fix.`].join("\n");
}
