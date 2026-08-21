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

import { describe, expect, test } from "vitest";
// `?raw` rather than `node:fs`, and that is the environment talking: `src` is compiled with
// Vite's client types and no Node ones, because everything else in here runs in a browser.
import CSS from "../index.css?raw";

/**
 * Properties set from TypeScript rather than in a stylesheet block, so the stylesheet reads
 * them without ever defining them. Each one is a real contract with a component, which is why
 * they are listed by hand rather than pattern-matched away.
 */
const SET_AT_RUNTIME = new Set([
  // `HighlightLayer` — which of the four inks this mark was made in.
  "--mark",
  // The surface a focus ring's halo is cut out of, named by whatever is not the page.
  "--halo",
  // Base UI publishes these while a finger is on a drawer or panel.
  "--drawer-swipe-movement-x",
  "--drawer-swipe-movement-y",
  // `Scrubber` reads this one back to turn a pointer x into a fraction.
  "--scrubber-inset",
]);

function namesIn(css: string, pattern: RegExp): Set<string> {
  return new Set([...css.matchAll(pattern)].flatMap((match) => match[1] ?? []));
}

const declared = (css: string) => namesIn(css, /^\s*(--[a-z0-9-]+)\s*:/gm);
const referenced = (css: string) => namesIn(css, /var\(\s*(--[a-z0-9-]+)/g);

describe("index.css custom properties", () => {
  test("every var() names a property that exists", () => {
    const dangling = [...referenced(CSS)]
      .filter((name) => !declared(CSS).has(name) && !SET_AT_RUNTIME.has(name))
      .sort();

    expect(dangling).toEqual([]);
  });

  test("the dark theme redefines nothing the light theme has not declared", () => {
    // Both themes have to answer with the same set of names, or a component reads a value in
    // one theme and nothing in the other — the same silent failure, one theme deep.
    const dark = CSS.slice(CSS.indexOf(':root[data-theme="dark"]'));
    const overrides = [...declared(dark)].filter((name) => !name.startsWith("--wave"));

    expect(overrides.filter((name) => !declared(CSS).has(name))).toEqual([]);
  });
});
