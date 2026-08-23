// Turns the `<text>` in the source logos into `<path>` outlines and writes the files the repo
// actually uses.
//
// Run it when the design in `source/` changes; this repo does not depend on fontkit, so:
//
//   npm i --no-save fontkit && node docs/brand/source/outline.mjs
//
// Why outlines at all: a favicon, a manifest icon and a README image are each loaded as a
// standalone image, and a standalone image cannot reach the page's @font-face. The letters
// would fall back to whatever serif the viewer happens to have — Georgia on a Mac, something
// else on Linux, and on the same page as the wordmark drawn in real Spectral.
//
// The layout here has to match what a browser does with the source file, and the one place
// they could disagree is letter-spacing: CSS adds it after *every* character, the last one
// included, which shifts a centred run by half a step. Following CSS puts both runs at
// x = 18.75, and 18.75 is 0.1875F — the left inset the spec states. That agreement is the
// check that this is laid out the way the design was drawn.
//
// It writes `components/Wordmark.tsx` as well — not the whole file, only the three `d`
// attributes in it. That component is the fourth copy of this geometry and the only one that
// is hand-written code, so leaving it to a human step would mean a design change that lands
// everywhere except the screen it is most seen on.

import * as fontkit from "fontkit";
import { readFileSync, writeFileSync } from "node:fs";

const FONT = "docs/brand/source/fonts/spectral-latin-400-normal.woff2";
const SIZE = 100;
const LETTER_SPACING = -1.5;

const font = fontkit.openSync(FONT);
const scale = SIZE / font.unitsPerEm;

// `anchorX` is the `<text x>` of a `text-anchor="middle"` run; `baselineY` its `<text y>`.
function outline(text, anchorX, baselineY) {
  const run = font.layout(text);
  const width =
    run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale + text.length * LETTER_SPACING;
  let pen = anchorX - width / 2;
  const parts = [];
  for (const [i, glyph] of run.glyphs.entries()) {
    // Font units are y-up and the SVG is y-down, hence the negative y scale.
    parts.push(glyph.path.scale(scale, -scale).translate(pen, baselineY).toSVG());
    pen += run.positions[i].xAdvance * scale + LETTER_SPACING;
  }
  return { originX: anchorX - width / 2, width, d: parts.join(" ") };
}

// The block and the tide line, per word. The mark's `<text>` anchor is 35.70 rather than the
// 35.67 and 35.68 the two source files happen to carry — those are two roundings of the same
// number, and only 35.70 puts the stem at 18.75 like the wordmark does.
const wave = (n, step) =>
  `q${(-step / 2).toFixed(3)} 5.6 ${(-step).toFixed(3)} 0` +
  ` t${(-step).toFixed(3)} 0`.repeat(n - 1);
const MARK = {
  width: 71.35,
  block: `M0 95 V6.25 A6.25 6.25 0 0 1 6.25 0 H65.10 A6.25 6.25 0 0 1 71.35 6.25 V102.7 ${wave(9, 7.928)} Z`,
  tide: `M0 102.7 ${wave(9, 7.928).replaceAll("-", "")}`,
  text: outline("t", 35.7, 77.71),
};
const WORDMARK = {
  width: 466.1,
  block: `M0 95 V6.25 A6.25 6.25 0 0 1 6.25 0 H459.85 A6.25 6.25 0 0 1 466.10 6.25 V102.7 ${wave(59, 7.9)} Z`,
  tide: `M0 102.7 ${wave(59, 7.9).replaceAll("-", "")}`,
  text: outline("tidemarks", 233.05, 86.8),
};

// The brand sheet's own literals. They are also in `styles/tokens.css` under names, and the
// two cannot reference each other: these files are read as images, with no page to ask. If a
// token here ever moves, `docs/brand/README.md` has the table that pairs them up.
const LIGHT = { block: "#EDE5D6", tide: "#1B2E4D", letters: "#14171C", page: "#F4EEE2" };
const DARK = { block: "#2C3F55", tide: "#A9C4DE", letters: "#F2F1E9", page: "#16202B" };

const body = (logo, colours) =>
  `  <path d="${logo.block}" fill="${colours.block}"/>\n` +
  `  <path d="${logo.tide}" fill="none" stroke="${colours.tide}" stroke-width="2.2"/>\n` +
  `  <path d="${logo.text.d}" fill="${colours.letters}"/>`;

function standalone(logo, colours) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${logo.width} 107.60" ` +
    `width="${logo.width}" height="107.60" role="img" aria-label="tidemarks">\n` +
    `  <title>tidemarks</title>\n${body(logo, colours)}\n</svg>\n`
  );
}

// The favicon is the one file that has to answer for both themes on its own: a tab icon is
// loaded as an image, so it never sees the page's `data-theme`, and the system preference is
// the only signal it gets.
function favicon() {
  const scaleTo32 = 0.2231;
  const inset = (32 - MARK.width * scaleTo32) / 2;
  const paint = (colours, selector) =>
    `${selector} .page { fill: ${colours.page} }\n` +
    `${selector} .block { fill: ${colours.block} }\n` +
    `${selector} .tide { stroke: ${colours.tide} }\n` +
    `${selector} .letters { fill: ${colours.letters} }`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="tidemarks">\n` +
    `  <title>tidemarks</title>\n` +
    `  <style>\n` +
    `    ${paint(LIGHT, ":root").replaceAll("\n", "\n    ")}\n` +
    `    @media (prefers-color-scheme: dark) {\n      ${paint(DARK, ":root").replaceAll("\n", "\n      ")}\n    }\n` +
    `  </style>\n` +
    `  <rect class="page" width="32" height="32" rx="6"/>\n` +
    `  <g transform="translate(${inset.toFixed(2)} 4) scale(${scaleTo32})">\n` +
    `    <path class="block" d="${MARK.block}"/>\n` +
    `    <path class="tide" d="${MARK.tide}" fill="none" stroke-width="2.2"/>\n` +
    `    <path class="letters" d="${MARK.text.d}"/>\n` +
    `  </g>\n</svg>\n`
  );
}

const files = {
  "docs/brand/tidemarks-mark.svg": standalone(MARK, LIGHT),
  "docs/brand/tidemarks-mark-dark.svg": standalone(MARK, DARK),
  "docs/brand/tidemarks-wordmark.svg": standalone(WORDMARK, LIGHT),
  "docs/brand/tidemarks-wordmark-dark.svg": standalone(WORDMARK, DARK),
  "packages/app/public/favicon.svg": favicon(),
};
for (const [path, contents] of Object.entries(files)) {
  writeFileSync(path, contents);
  console.log(`wrote ${path}`);
}

// The component, edited rather than written: everything around the three paths is code that a
// person maintains. Each `d` is found by the class beside it, so the three cannot swap places.
const COMPONENT = "packages/app/src/components/Wordmark.tsx";
let tsx = readFileSync(COMPONENT, "utf8");
for (const [cls, d] of [
  ["wordmark-block", WORDMARK.block],
  ["wordmark-tide", WORDMARK.tide],
  ["wordmark-letters", WORDMARK.text.d],
]) {
  // Whitespace-tolerant, because prettier decides for itself whether the two attributes share
  // a line with the tag or get one each.
  const at = new RegExp(`(className="${cls}"\\s+d=")[^"]*`);
  if (!at.test(tsx)) throw new Error(`${COMPONENT} has no path for ${cls}`);
  tsx = tsx.replace(at, `$1${d}`);
}
writeFileSync(COMPONENT, tsx);
console.log(`wrote ${COMPONENT} (three path attributes)`);

for (const [name, logo] of Object.entries({ mark: MARK, wordmark: WORDMARK })) {
  console.log(`${name} stem at x=${logo.text.originX.toFixed(3)}`);
}
