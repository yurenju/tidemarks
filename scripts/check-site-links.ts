// Every internal link in the built site resolves to a page that exists.
//
// This is the site's only check, and it is here because of what the site is for: Paddle's domain
// review looks for three legal documents reachable from the navigation, and a mistyped href in
// `Page.astro` would ship silently, pass every build, and be discovered five working days later as
// a rejected review. Astro does not validate links itself (checked against 7.3.1).
//
// It lives here rather than inside the package for the same reason everything in `scripts/` does:
// this directory is what the root's npm scripts run, so `tsconfig.scripts.json` type-checks it and
// the `scripts` vitest project can reach its pure half. A copy under `packages/site/` would have
// had neither.
//
//   node scripts/check-site-links.ts

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = new URL("../packages/site/dist/", import.meta.url).pathname;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/**
 * Where a link lands on disk, given `build.format: "directory"`: `/legal/terms/` is
 * `legal/terms/index.html`. Query and fragment are cut first — `/pricing#plans` is still
 * `/pricing`.
 */
export function pageFile(dist: string, href: string): string {
  const path = href.split(/[?#]/)[0]!;
  return join(dist, path, "index.html");
}

const pages = htmlFiles(DIST);
const broken: string[] = [];

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    // Only site-internal, absolute-from-root links. Anything with a scheme (http:, mailto:) is
    // somebody else's to keep working, and a bare fragment stays on the page it is on.
    if (!href!.startsWith("/")) continue;
    const withSlash = href!.endsWith("/") ? href! : `${href!}/`;
    // Either a page (a directory with an index.html) or a file served as it stands, such as
    // /favicon.svg.
    if (existsSync(pageFile(DIST, withSlash)) || existsSync(join(DIST, href!))) continue;
    broken.push(`${relative(DIST, file)} → ${href}`);
  }
}

if (broken.length > 0) {
  console.error(`Broken internal links:\n${broken.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`site: internal links resolve (${pages.length} pages)`);
