#!/usr/bin/env node
//
// Writes the two novel-length Chinese books into the repository's tests/books/.
//
//   npm run novel -w @yurenju/frond
//   node scripts/generate-novel.ts <directory>
//
// Deterministic like generate-fixtures.ts: running it again leaves no diff in git unless
// scripts/novel/ changed. Imports carry .ts extensions because node runs this directly.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { buildNovel, novelFileName, type NovelDirection } from "./novel/novel.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_OUTPUT = join(REPOSITORY_ROOT, "tests", "books");

const requested = process.argv[2];
const output = requested === undefined ? DEFAULT_OUTPUT : resolve(requested);
await mkdir(output, { recursive: true });

const directions: readonly NovelDirection[] = ["vertical", "horizontal"];
for (const direction of directions) {
  const path = join(output, novelFileName(direction));
  const bytes = buildNovel(direction);
  await writeFile(path, bytes);
  console.log(`${relative(REPOSITORY_ROOT, path)}  ${(bytes.length / 1024).toFixed(0)} KiB`);
}
