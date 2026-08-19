import { defineConfig } from "vitest/config";

// The deployment script's pure half: which build variables are required, how the repo's
// self-hosting `wrangler.jsonc` becomes the official account's configuration, and the JSONC
// reader that gets it there.
//
// A project of its own rather than a folder inside the app's, because `scripts/` is not part
// of any package — it is what the root's npm scripts run, and Cloudflare's build form points
// at those.
//
// **This is the only automated check these functions get.** Everything downstream of them
// happens in Cloudflare's build environment, where a mistake shows up as a deployment that
// succeeded against the wrong database.
export default defineConfig({
  test: {
    name: "scripts",
    include: ["scripts/**/*.test.ts"],
  },
});
