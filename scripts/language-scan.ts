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
//   1. 〈…〉 in a code file. The Chinese title mark cites a glossary term, and a comment citing one
//      is an English sentence with a Chinese word inside it. Code cites [[English]] instead.
//   2. A line with more Chinese than Latin **outside its string literals**. An English sentence
//      quoting a title stays mostly Latin; a comment written in Chinese does not. Quoted spans
//      come out first, because that is where fixture prose and book titles legitimately live.
//   3. Chinese inside a test's name. Those are read as a report, and the report is in English.
//
// Rule 2 is the loose one and it is loose on purpose: it is a floor, not a fence. A comment in
// Chinese trips it; a sentence quoting 草枕 does not.

const CJK = /[㐀-鿿぀-ヿ豈-﫿]/gu;
const LATIN = /[A-Za-z]/gu;
const CITATION = /〈[^〉]*〉/u;
const TEST_NAME = /\b(?:it|test|describe)(?:\.\w+)*\(\s*[`"'][^`"']*[㐀-鿿぀-ヿ]/u;

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

/** What is left of a line once its string literals are taken out: the code and the comments. */
const outsideStrings = (line: string): string => line.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");

export function scanFile(path: string, text: string): Finding[] {
  if (isExempt(path)) return [];
  const findings: Finding[] = [];
  // A template literal spanning several lines is one string, and the lines in the middle of it
  // have no quote on them to strip. Fixture markup is written that way, so the ratio has to know
  // when it is inside one.
  let inTemplate = false;
  text.split("\n").forEach((line, i) => {
    const opensOrCloses = count(line, /`/gu) % 2 === 1;
    const wasInTemplate = inTemplate;
    if (opensOrCloses) inTemplate = !inTemplate;
    if (count(line, CJK) === 0) return;
    const bare = wasInTemplate ? "" : outsideStrings(line);
    const rule = CITATION.test(line)
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
