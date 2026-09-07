// Where this deployment's public site is, if it has one.
//
// **Absent is the normal case, not a misconfiguration.** The site at tidemarks.io carries Sad
// Coder's terms, refund policy and privacy policy — one seller's documents about one seller's
// service. A self-hosted Tidemarks is somebody else's service, and pointing its readers at those
// pages would tell them the wrong thing about who they are dealing with and what they can get
// refunded. So the links appear only where a site has been named, and every other deployment
// simply has no legal links in its account pane.
//
// Set from the CF_SITE_ORIGIN build variable at build time (`vite.config.ts`), the same route
// `__BUILD__` takes and for the same reason: the service worker can be serving an older bundle,
// so only a value baked into that bundle describes the code actually running. It is a build
// variable rather than a Worker `var` because the value is needed by the React app, and build
// variables are what this repository already uses for per-deployment values (docs/deployment.md).

// Replaced textually by vite's `define`. Absent under vitest.
declare const __SITE_ORIGIN__: string | undefined;

/** The origin, with no trailing slash, or `null` when this deployment has no public site. */
export const SITE_ORIGIN: string | null =
  typeof __SITE_ORIGIN__ === "undefined" || __SITE_ORIGIN__ === "" ? null : __SITE_ORIGIN__;

/**
 * A URL on the public site, or `null` when there is none.
 *
 * Returning `null` rather than a relative path matters: a relative `/legal/terms` on
 * app.tidemarks.io is served the React app by the asset router's single-page-application
 * handling, so the reader would get their own shelf and a 200 instead of a document
 * (`lib/worker-paths.ts` has the story). No link is better than that.
 */
export function siteUrl(path: `/${string}`): string | null {
  return SITE_ORIGIN === null ? null : `${SITE_ORIGIN}${path}`;
}
