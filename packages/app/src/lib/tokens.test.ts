/**
 * The stylesheet's own custom properties, checked for the one mistake nothing else catches.
 *
 * **A `var()` pointing at a property that does not exist is invalid at computed-value time**,
 * and CSS does not fail loudly for it: the whole declaration is thrown away and the property
 * falls back to its initial value. For a shorthand like `border-top: 1px solid var(--gone)`
 * that means `border-style: none` — the rule silently draws nothing.
 *
 * This is the same class of bug the worker suite exists for (CONTEXT.md): it type-checks, it
 * builds, it lints, and it is only visible by looking at the right screen in the right theme.
 * It cost a renamed primitive here — the ink ramp lost its `-700` step and one semantic name
 * still pointed at it, which took the seam out of the highlight toolbar in the light theme
 * only. Two browsers' worth of `hand-held.spec.ts` found it, two minutes into a container run,
 * as a border measuring 0px. This finds it in milliseconds and says which name is dangling.
 *
 * It deliberately does **not** check for unused properties. A type scale is a ramp and may
 * legitimately hold a step nothing is on yet; a name with no definition is never legitimate.
 */

/// <reference types="node" />
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOOK_THEMES, SELECTION_WASH } from "./settings";

// **Read from disk, not through Vite.** `import CSS from "../index.css?raw"` looks tidier and
// hands back an **empty string**: Vitest stubs stylesheet imports unless `css: true`, and
// `?raw` does not escape that. It fails silently — both tests below still pass, against no
// input at all, which is how this file spent one commit asserting nothing.
//
// The triple-slash reference is what lets `node:fs` type-check here. `tsconfig.app.json` gives
// `src` Vite's client types and no Node ones, deliberately, because everything else under it
// runs in a browser; widening the whole project for one test would be the wrong trade.
const ENTRY = new URL("../index.css", import.meta.url);
const read = (url: URL) => readFileSync(fileURLToPath(url), "utf8");

// **Follow `index.css`'s own import list rather than globbing `styles/`.** A glob would read a
// file that nothing imports and report it as checked, which is the one way a stylesheet can be
// wrong that no browser would ever show you. Going through the list means a file only gets
// checked once it is actually part of the sheet.
//
// Concatenating in import order also keeps the second test below honest: it asks what the
// light theme declared *before* the dark block, and that "before" is the cascade's order.
const IMPORTED = [...read(ENTRY).matchAll(/@import\s+["']([^"']+)["']/g)].flatMap(
  (match) => match[1] ?? [],
);
const CSS = IMPORTED.map((path) => read(new URL(path, ENTRY))).join("\n");

/**
 * Properties a component sets from TypeScript, which the stylesheet reads without ever
 * declaring. Each is a real contract with a component, which is why they are listed by hand.
 *
 * **Only names the stylesheet never declares belong here.** `--halo` and `--scrubber-inset`
 * were on this list and should not have been: both are declared in the sheet (`reader.css` and
 * `book.css`) as well as set from a component, so exempting them told the check to skip the two
 * names most worth following — exactly the mistake this file exists to catch, made inside the
 * file that catches it.
 */
const SET_ONLY_AT_RUNTIME = new Set([
  // `HighlightLayer` — which of the four inks this mark was made in.
  "--mark",
  // `SelectionLayer` — how far the wash reaches back from a handle's bead, so its stem can be
  // drawn across the colour rather than stopping at the edge of it. A line's width depends on
  // the type the reader set and on the book's own CSS, so the stylesheet cannot hold it.
  "--handle-span",
  // `SelectionLayer` — how far past the text a bead is held off. It is the wash's lip on that
  // side, which differs by writing mode, and CSS cannot see which one is in force.
  "--handle-reach",
  // Base UI publishes these while a finger is on a drawer or panel.
  "--drawer-swipe-movement-x",
  "--drawer-swipe-movement-y",
]);

function namesIn(css: string, pattern: RegExp): Set<string> {
  return new Set([...css.matchAll(pattern)].flatMap((match) => match[1] ?? []));
}

const declared = (css: string) => namesIn(css, /^\s*(--[a-z0-9-]+)\s*:/gm);
const referenced = (css: string) => namesIn(css, /var\(\s*(--[a-z0-9-]+)/g);

/**
 * The dark theme's `:root` block — that rule alone, brace to matching brace.
 *
 * **Not "everything from here to the end of the file".** That slice was tried and it drags in
 * every component rule below, two of which declare properties of their own (`--halo`,
 * `--scrubber-inset`) — so the check reported them as dark-theme orphans, which they are not.
 *
 * The selector is matched by pattern rather than as a literal string, because an attribute
 * value in CSS may be quoted or bare.
 */
function darkRootBlock(css: string): string {
  const start = css.search(/:root\[data-theme\s*=\s*["']?dark["']?\]\s*\{/);
  if (start < 0) return "";

  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return "";
}

describe("the stylesheet's custom properties", () => {
  // The guard on everything below it. Both of the other tests pass against an empty string —
  // no `var()` dangles when there are none — so a change that quietly stops the sheet being
  // read would leave two green tests asserting nothing. That has happened here once already,
  // when `?raw` returned "". The floor is far under the real figure (~110 KB) and far over
  // anything a broken read could produce.
  test("the whole sheet was read, not just the import list", () => {
    expect(IMPORTED.length).toBeGreaterThan(1);
    expect(CSS.length).toBeGreaterThan(50_000);
  });

  test("every var() names a property that exists", () => {
    const names = declared(CSS);
    const dangling = [...referenced(CSS)]
      .filter((name) => !names.has(name) && !SET_ONLY_AT_RUNTIME.has(name))
      .sort();

    expect(dangling).toEqual([]);
  });

  test("the dark theme overrides nothing the light theme has declared", () => {
    // Both themes have to answer to the same set of names, or a component reads a value in one
    // theme and nothing in the other — the same silent failure, one theme deep.
    const dark = darkRootBlock(CSS);
    expect(dark, "the dark :root block moved or was renamed").not.toBe("");

    const light = declared(CSS.slice(0, CSS.indexOf(dark)));
    const orphans = [...declared(dark)].filter((name) => !light.has(name)).sort();

    expect(orphans).toEqual([]);
  });

  /**
   * The selection wash, first of the values that exist twice, and the only thing standing
   * between its two copies.
   *
   * `::selection` matches inside the document holding the text, and that document is frond's
   * iframe — so the selection colour cannot reach the book as a token and travels as a value
   * instead (`settings.ts`'s `SELECTION_WASH`). That is a copy, and a copy of a colour is a
   * pair of colours waiting to differ: the touch wash we draw ourselves would end up one blue
   * and the desk's native selection another, on the same screen, for no stated reason.
   *
   * Nothing in the type system can catch that, and no other layer looks at both. This does.
   */
  test("the selection wash frond is handed is the one the stylesheet draws", () => {
    const dark = darkRootBlock(CSS);
    const value = (css: string) =>
      /--selection-wash:\s*([^;]+);/.exec(css)?.[1]?.replaceAll(/\s+/g, "");

    expect(value(CSS.slice(0, CSS.indexOf(dark)))).toBe(
      SELECTION_WASH.light.replaceAll(/\s+/g, ""),
    );
    expect(value(dark)).toBe(SELECTION_WASH.dark.replaceAll(/\s+/g, ""));
  });

  /**
   * The other copies, four of them, and the one a reader would see as a rectangle.
   *
   * The book is drawn by frond inside its iframe and everything around it by the stylesheet out
   * here, so the colours the two share cannot share a token — they travel as values
   * (`settings.ts`'s `BOOK_THEMES`). Let the paper differ and the book stops filling the screen:
   * it sits on a mat a shade off itself, which is what the dark theme did until they were made
   * equal. The other three are quieter but the same kind of wrong — a book's ink a step off the
   * interface's, on the same screen, for no stated reason.
   *
   * **Only the four that are meant to be copies.** The dark theme's own ink and link are older
   * than the tokens and deliberately not tokens; `settings.ts` says why, and asserting them here
   * would be writing down a coincidence.
   *
   * ⚠️ **These names are aliases**, so this resolves one hop (`var(--paper-200)` → the
   * primitive) before comparing. One hop is all the sheet uses, and following an arbitrary chain
   * here would be reimplementing the cascade to check four values.
   */
  test("the colours frond is handed are the ones the stylesheet draws", () => {
    const dark = darkRootBlock(CSS);
    const light = CSS.slice(0, CSS.indexOf(dark));

    // The primitives are declared once, in the light `:root`, and never restated — so a name a
    // theme block points at is resolved against that block rather than against the whole sheet,
    // which would find whichever declaration came first.
    const primitives = light;
    const resolve = (block: string, name: string) => {
      const alias = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
      const named = /^var\(\s*(--[\w-]+)\s*\)$/.exec(alias ?? "")?.[1];
      if (named === undefined) return alias;
      return new RegExp(`${named}:\\s*([^;]+);`).exec(primitives)?.[1]?.trim();
    };

    expect(resolve(light, "--text-body")).toBe(BOOK_THEMES.light.foreground);
    expect(resolve(light, "--surface-page")).toBe(BOOK_THEMES.light.background);
    expect(resolve(light, "--tide")).toBe(BOOK_THEMES.light.link);
    expect(resolve(dark, "--surface-page")).toBe(BOOK_THEMES.dark.background);
  });
});
