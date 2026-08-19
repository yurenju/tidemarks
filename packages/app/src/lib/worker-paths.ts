// The paths the Worker answers, and nothing else does.
//
// Two places have to agree with this list, and they are in different files, different formats
// and different build systems — which is why it lives here instead of being written out twice:
//
// - `wrangler.jsonc`'s `assets.run_worker_first`, or the asset router answers first and
//   `not_found_handling: single-page-application` hands back index.html
// - the service worker's `navigateFallbackDenylist` (`vite.config.ts`), or a **navigation** to
//   one of these is served index.html straight from the cache and never reaches the network
//
// The second one cost a day. `/authorize` was in `run_worker_first` and not in the denylist, so
// the OAuth consent screen worked from curl and was invisible in a browser — and only in a
// browser that had loaded spine before, because that is the one with a service worker
// registered. Which is every reader's browser.
export const WORKER_OWNED_PATHS = [
  "/api/*",
  "/auth/*",
  "/mcp",
  "/authorize",
  "/oauth/*",
  "/.well-known/*",
] as const;

/**
 * The same list as regular expressions, for the service worker's navigation denylist.
 *
 * **Workbox tests these against `pathname + search`, not `pathname`** (`NavigationRoute.js`).
 * So an exact path ends at `(\?|$)` rather than at `$`: anchoring on `$` alone matches
 * `/authorize` and misses `/authorize?response_type=…`, which is every real request. That
 * mistake passes a unit test written with bare paths and changes nothing in a browser.
 *
 * A prefix entry still ends at `/`, so `/auth/*` covers `/auth/login/options` and does not
 * reach `/authorize` — the pair that made this module necessary.
 */
export function workerNavigationDenylist(): RegExp[] {
  return WORKER_OWNED_PATHS.map((path) =>
    path.endsWith("/*")
      ? new RegExp(`^${escapeForRegExp(path.slice(0, -2))}/`)
      : new RegExp(`^${escapeForRegExp(path)}(\\?|$)`),
  );
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
