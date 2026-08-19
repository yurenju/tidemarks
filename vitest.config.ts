import { defineConfig } from "vitest/config";

// Every Vitest project in the monorepo, collected here so `npm test` at the root is one
// command with one summary.
//
// The configs themselves live with the code they cover: a package owns its tests, so a package
// that ever gets lifted back out of here takes them along in one directory. This file only says
// which ones exist.
//
// **Listed rather than globbed.** A glob would silently cover a new config the day someone
// adds one, and "which suites ran" is exactly the thing that should not change without a diff.
//
// The third runner is Playwright, which each package configures for itself
// (`packages/*/playwright.config.ts`); `scripts/test-in-container.sh` runs those.
export default defineConfig({
  test: {
    projects: [
      "./packages/app/vitest.node.config.ts",
      "./packages/app/vitest.worker.config.ts",
      "./packages/frond/vitest.config.ts",
      "./vitest.scripts.config.ts",
    ],
  },
});
