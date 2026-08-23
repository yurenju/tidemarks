// One list of paths, checked against the two places it has to agree with: what wrangler runs
// the Worker first for, and what the service worker must not answer from cache. Drift is silent
// on both sides — an HTML page with a 200 on it where JSON was expected, or a request that
// never leaves the browser at all.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_OWNED_PATHS, workerNavigationDenylist } from "../src/lib/worker-paths";

// Here rather than beside the module because it reads `wrangler.jsonc` off disk, and this is
// the test project that has Node's types.

/** `wrangler.jsonc` with its comments removed, which is the only thing standing between us and JSON. */
function wranglerConfig(): { assets: { run_worker_first: string[] } } {
  // Resolved against this file: the runner starts at the repository root, one level above this
  // package, so a bare filename would look for it there.
  const path = resolve(import.meta.dirname, "../wrangler.jsonc");
  const source = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(source);
}

describe("the paths the Worker owns", () => {
  it("are exactly what wrangler runs the Worker first for", () => {
    // Drift here does not fail loudly: the asset router answers instead, and because
    // `not_found_handling` is `single-page-application` the reply is index.html with a 200 on
    // it. An MCP client sees HTML where JSON should be; a person sees the bookshelf.
    expect(wranglerConfig().assets.run_worker_first).toEqual([...WORKER_OWNED_PATHS]);
  });

  it("are all kept away from the service worker’s navigation fallback", () => {
    // The half that was missing. A navigation the denylist does not cover is answered from the
    // cache with index.html and never leaves the browser, so the Worker cannot be reached at
    // all — no request, no log, nothing to debug from the server side.
    // **With their query strings.** Workbox matches these against `pathname + search`, so a
    // pattern anchored on `$` covers the bare path and misses every real request — which is
    // how the first attempt at this fix passed its tests and changed nothing in a browser.
    const denylist = workerNavigationDenylist();
    const navigable = [
      "/authorize",
      "/authorize?response_type=code&client_id=abc&scope=tidemarks:read",
      "/mcp",
      "/oauth/token",
      "/api/sync?since=0",
      "/.well-known/oauth-protected-resource/mcp",
    ];
    for (const path of navigable) {
      expect(denylist.some((pattern) => pattern.test(path))).toBe(true);
    }
  });

  it("leave the app’s own routes alone", () => {
    // Deny too much and the SPA stops working offline, which is the whole point of the PWA.
    const denylist = workerNavigationDenylist();
    for (const path of ["/", "/index.html", "/authorized-devices", "/authorize-me?x=1"]) {
      expect(denylist.some((pattern) => pattern.test(path))).toBe(false);
    }
  });

  it("does not let a prefix entry swallow a sibling that only shares its letters", () => {
    // `/^\/auth\//` and `/authorize` is the exact pair that broke: the prefix looks like it
    // covers it and does not, so the path fell through both lists at once.
    const authPrefix = workerNavigationDenylist()[1]!;
    expect(authPrefix.test("/auth/login/options")).toBe(true);
    expect(authPrefix.test("/authorize")).toBe(false);
  });
});
