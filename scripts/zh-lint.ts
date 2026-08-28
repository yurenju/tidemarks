// The Chinese writing check. Run by `/zh-check` before a pull request, and by hand over the
// whole repository when the rules change.
//
// This half finds the lines and prints the report; the rules and the matching are in
// `zh-rules.ts` and are tested. The split is the same one `check-i18n.ts` makes, for the same
// reason: the judgement is the part worth testing, and it cannot be tested while it is tangled
// up with git and the filesystem.
//
// Three ways to run it, and the difference between them is only which lines get read:
//
//   node scripts/zh-lint.ts                 the lines this branch adds, against main
//   node scripts/zh-lint.ts --all           every tracked Markdown file, whole
//   node scripts/zh-lint.ts .scratch/pr.md  those files, whole
//
// The first is the one that runs before every pull request. It reads added lines only, because
// the rules arrived after most of these documents did — checking whole files would bury a
// twenty-line change under a thousand findings that have nothing to do with it.
//
// Exit code is 1 only for first-level findings. Second-level ones cannot fail a run: there are
// hundreds of them across the repository and most are correct Chinese. Making them fail would
// train everybody to pass `--all` and look away. What makes them get read is `/zh-check`, which
// requires a verdict on each.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  formatFinding,
  isIgnored,
  lint,
  parseAddedLines,
  summarise,
  type Finding,
  type LineOfText,
} from "./zh-rules.ts";

/** Where the branch left main. Findings are the lines added since. */
const BASE_BRANCH = "main";

interface Document {
  path: string;
  lines: LineOfText[];
}

/**
 * `core.quotePath=false` on every call: without it git escapes and quotes any path with a
 * non-ASCII character, so `docs/中文.md` arrives as `"docs/\344\270..."` and every check
 * downstream silently skips it. Every document in this repository is Chinese.
 */
function git(...args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isMarkdown(path: string): boolean {
  return path.endsWith(".md");
}

function readWhole(path: string): Document {
  const text = readFileSync(path, "utf8");
  if (isIgnored(text)) return { path, lines: [] };
  return {
    path,
    lines: text.split("\n").map((line, index) => ({ line: index + 1, text: line })),
  };
}

/**
 * The lines this branch adds, by file.
 *
 * `git diff <base>` rather than `<base>..HEAD` so uncommitted work counts too — the check runs
 * before the commit as often as after it. `--unified=0` keeps unchanged context out, which is
 * the whole point: only what this change wrote is this change's problem.
 */
function addedLines(base: string): Document[] {
  const changed = parseAddedLines(git("diff", "--unified=0", base, "--", "*.md"))
    .filter(({ path }) => isMarkdown(path))
    .filter(({ path }) => !isIgnored(readFileSync(path, "utf8")));

  // A file git has never seen is in no diff at all, so a brand new document would be skipped
  // entirely until the commit that adds it — which is exactly the check running too late.
  return [...changed, ...listed("--others", "--exclude-standard")];
}

/** Tracked (or, with flags, untracked) Markdown, whole. `-z` so odd filenames survive. */
function listed(...flags: string[]): Document[] {
  return git("ls-files", "-z", ...flags, "*.md")
    .split("\0")
    .filter((path) => path !== "")
    .map(readWhole);
}

function report(documents: Document[]): number {
  const all: Array<{ path: string; finding: Finding }> = [];
  for (const document of documents) {
    for (const finding of lint(document.lines)) all.push({ path: document.path, finding });
  }

  if (all.length === 0) {
    // The report is a Chinese document: the labels sit beside Chinese sentences and the examples
    // are the point, so this line speaks the same language as the rest of the output.
    console.log("zh-lint：沒有要改的。");
    return 0;
  }

  for (const { path, finding } of all) console.log(`${formatFinding(path, finding)}\n`);

  const must = all.filter(({ finding }) => finding.rule.level === "must");
  const check = all.length - must.length;
  console.log("-".repeat(60));
  for (const { id, count } of summarise(all.map(({ finding }) => finding))) {
    console.log(`  ${String(count).padStart(4)}  ${id}`);
  }
  console.log(`\n${must.length} 一定要改，${check} 要檢查。`);
  if (check > 0) {
    console.log("要檢查的每一條都要給出結論：改了，或者這是正例。跳過不算檢查過。");
  }
  return must.length > 0 ? 1 : 0;
}

function main(): number {
  const args = process.argv.slice(2);

  if (args.includes("--all")) return report(listed());

  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length > 0) {
    const wrong = paths.filter((path) => !isMarkdown(path));
    if (wrong.length > 0) {
      console.error(`not Markdown: ${wrong.join(", ")}`);
      return 1;
    }
    return report(paths.map(readWhole));
  }

  let base: string;
  try {
    base = git("merge-base", "HEAD", BASE_BRANCH).trim();
  } catch {
    console.error(
      `no merge base with ${BASE_BRANCH}. Pass paths, or --all to read every document.`,
    );
    return 1;
  }
  return report(addedLines(base));
}

process.exit(main());
