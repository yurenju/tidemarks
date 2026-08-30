// The check that keeps code in English. Run by `npm run lint`, and so by CI.
//
// Documents are Chinese and code is English (CLAUDE.md, ADR-0045). That boundary was swept clean
// once; what this stops is it silently coming apart again, which it otherwise would, because a
// Chinese comment in a TypeScript file compiles, passes every test and reads perfectly well to
// the person who wrote it.
//
// This half finds the files and prints the report; the judgement is in `language-scan.ts` and is
// tested.
//
//   node scripts/check-language.ts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatFindings, scanFile, type Finding } from "./language-scan.ts";

// Every kind of file CLAUDE.md's table calls English. `.po` is here for the comments lingui
// extracts into it: those are written for translators, and they carry whatever the source said —
// so a Chinese citation in a comment reaches a second reader before anyone notices.
const EXTENSIONS = [
  "ts",
  "tsx",
  "mjs",
  "css",
  "html",
  "json",
  "jsonc",
  "yml",
  "sh",
  "sql",
  "conf",
  "po",
];
const NAMED = ["Dockerfile", ".gitignore", ".dockerignore"];

// ⚠️ Paths come back relative to wherever git was run, and `isExempt` matches from the repository
// root — so this has to be run from the root, which is what `npm run lint` does.
const tracked = execFileSync(
  "git",
  ["ls-files", ...EXTENSIONS.map((e) => `*.${e}`), ...NAMED.map((n) => `*${n}`)],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const findings: Finding[] = tracked.flatMap((path) => scanFile(path, readFileSync(path, "utf8")));

console.log(formatFindings(findings));
process.exit(findings.length === 0 ? 0 : 1);
