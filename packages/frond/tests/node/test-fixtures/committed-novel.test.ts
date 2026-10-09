// Whether the novel-length books in tests/books/ still agree with their generator — the
// same question committed-fixtures.test.ts answers for the ailment fixtures, and for the
// same reason: the books are committed, so the generator and the bytes are two sources of
// truth, and only this test runs the generator to compare them.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { sha256 } from "../support/hash.ts";
import { buildNovel, novelFileName } from "../../../scripts/novel/novel.ts";

const BOOKS_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "books",
);

describe("the novel-length books in the repo", () => {
  test.for(["vertical", "horizontal"] as const)(
    "the %s one matches what the generator produces",
    async (direction) => {
      const fileName = novelFileName(direction);
      const committed = await readFile(join(BOOKS_DIRECTORY, fileName));
      expect(
        sha256(committed),
        `${fileName} does not match the generator. If scripts/novel/ changed, run ` +
          `\`npm run novel -w @yurenju/frond\` to regenerate. If it did not, the engine's floating ` +
          `point moved under the generator (see the header of scripts/novel/jpeg.ts) — keep the ` +
          `committed books and look at what changed in Node.`,
      ).toBe(sha256(buildNovel(direction)));
    },
  );
});
