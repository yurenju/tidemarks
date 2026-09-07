// Every internal link in the built site resolves to a page that exists.
//
// This is the site's only check, and it is here because of what the site is for: Paddle's domain
// review looks for three legal documents reachable from the navigation, and a mistyped href in
// `Page.astro` would ship silently, pass every build, and be discovered five working days later as
// a rejected review. Astro does not validate links itself (checked against 7.3.1).
//
// Deliberately not a test framework and not a vitest project — one file, run straight after the
// build, in the one place where the built pages exist to compare against.
//
//   node scripts/check-links.ts

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/** Where `/legal/terms` lands on disk, given `build.format: "directory"`. */
function target(href: string): string {
  const path = href.split(/[?#]/)[0]!;
  return join(DIST, path, path.endsWith("/") || path === "" ? "index.html" : "");
}

const broken: string[] = [];

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    // Only site-internal, absolute-from-root links. Anything with a scheme (http:, mailto:) is
    // somebody else's to keep working, and a bare fragment stays on the page it is on.
    if (!href!.startsWith("/")) continue;
    const withSlash = href!.endsWith("/") ? href! : `${href!}/`;
    if (existsSync(target(withSlash)) || existsSync(join(DIST, href!))) continue;
    broken.push(`${relative(DIST, file)} → ${href}`);
  }
}

if (broken.length > 0) {
  console.error(`Broken internal links:\n${broken.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`site: internal links resolve (${htmlFiles(DIST).length} pages)`);
