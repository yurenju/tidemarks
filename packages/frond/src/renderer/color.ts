/**
 * Colour arithmetic, and the one question it exists to answer: **what does a colour the
 * book declared become on the reader's background?**
 *
 * It is kept out of `css.ts` because that module locates declarations in text and never
 * looks inside a value, while this one only ever looks at one value and knows nothing
 * about CSS syntax around it. The rule itself is ADR-0014's; only the arithmetic is here.
 *
 * ## Why a parser rather than asking the browser
 *
 * The engine would answer exactly, for every syntax it supports, by way of
 * `getComputedStyle` on a probe element. Two reasons not to: this layer is `src/`, which
 * has to stay usable without a document (ADR-0005 splits the DOM half from the parsing
 * half, and `tests/node/` runs this one without a browser), and a probe element resolves
 * `currentColor` and `var()` against **its own** surroundings rather than the book's, so
 * the values that most need to be left alone would come back as plausible colours.
 *
 * What is not recognised is not a failure mode: every entry point here returns `undefined`
 * for a value it cannot read, and every caller takes that as "leave the book's declaration
 * exactly as it is".
 */

/** A colour in sRGB. Channels are 0–255 and `alpha` is 0–1, the ranges CSS itself uses. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

/**
 * The reader's theme in the form the rewrite needs.
 *
 * The background is parsed because every decision below is made against it; the foreground
 * is carried verbatim because it is only ever emitted, never measured. Keeping the
 * consumer's own spelling means the injected CSS says what they wrote.
 */
export interface ColorTheme {
  readonly foreground: string;
  readonly background: Rgb;
}

/**
 * The theme, or `undefined` when frond cannot read the reader's background.
 *
 * `undefined` is not an error: it is the signal to fall back to replacing the book's
 * colours wholesale, which is what frond did for every theme before ADR-0014. Without a
 * background there is nothing to measure contrast against, and the safe side of that is
 * "flatten everything" rather than "leave a black paragraph on a black page".
 */
export function colorTheme(foreground: string, background: string): ColorTheme | undefined {
  const parsed = parseColor(background);
  if (parsed === undefined || parsed.alpha === 0) return undefined;
  return { foreground, background: { ...parsed, alpha: 1 } };
}

/**
 * The WCAG contrast ratio between two opaque colours, 1 to 21.
 *
 * Alpha is ignored here rather than composited: the caller has already decided what the
 * reader actually sees (`adaptColor` composites first), and a ratio between two
 * translucent colours has no meaning without knowing what is behind them.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * What the book's declared colour becomes under the reader's theme. `undefined` means
 * leave the declaration exactly as the book wrote it.
 *
 * The order of the four cases is the rule, and each one is load-bearing (ADR-0014 carries
 * the measurements behind them):
 *
 * 1. **A value frond cannot read** is left alone. `inherit` and `currentColor` follow
 *    whatever the rewrite did upstream anyway; `transparent` is a book hiding text on
 *    purpose, and replacing it would dig that text back out; `var(--x)` would need a whole
 *    custom-property cascade to resolve, and resolving it wrongly is worse than not
 *    resolving it.
 * 2. **A colour that already reads is left alone.** This is the case the whole change
 *    exists for: 190 of 951 declarations across 34 books are chapter headings, small
 *    capitals and captions that the book chose and that are perfectly legible on a dark
 *    page. 4.5 is WCAG's ratio for body text, and it is the bar rather than 3 because
 *    **frond cannot tell a heading from a paragraph** — nothing in CSS says which is
 *    which, so the stricter of the two is the honest choice.
 * 3. **A near-black neutral becomes the reader's ink.** That is the book's body ink, and
 *    the reader's theme exists to take it over. The two thresholds are measured, not
 *    chosen: in the sample no colour at all sits between lightness 0.225 and 0.290, and
 *    the 361 declarations below that gap are all black, `#333`, `#231815` and the like.
 *    **Only the dark end has a threshold**, and that asymmetry is deliberate: a near-white
 *    only ever fails against a light page, and Tidemarks sets no theme at all in light mode,
 *    so the mirrored constant would be answering a case nobody has measured. On a light
 *    theme a book's white text therefore comes out a mid grey by case 4 rather than the
 *    reader's ink. Readable, and the day a light theme exists this is the line to revisit.
 * 4. **Everything else keeps its hue and saturation and only has its lightness moved**,
 *    just far enough to clear the bar. A book's `#0000FF` sesame dots stay blue; replacing
 *    them with the reader's ink would trade "cannot see it" for "cannot tell it apart".
 *
 * A translucent value is composited against the reader's background first, because that is
 * the colour the reader actually sees. The replacement is emitted opaque: alpha's only job
 * was to soften the colour against the paper, and that paper is now the reader's.
 */
export function adaptColor(value: string, theme: ColorTheme): string | undefined {
  const declared = parseColor(value);
  if (declared === undefined || declared.alpha === 0) return undefined;

  const seen = composite(declared, theme.background);
  if (contrastRatio(seen, theme.background) >= MIN_CONTRAST) return undefined;

  if (chroma(seen) < NEUTRAL_CHROMA && lightness(seen) < BOOK_INK_LIGHTNESS) {
    return theme.foreground;
  }

  return formatHex(lift(seen, theme.background));
}

/**
 * WCAG's ratio for body text. See `adaptColor` for why this rather than the 3 that applies
 * to large text.
 */
const MIN_CONTRAST = 4.5;

/**
 * How much hue a colour needs before it counts as a colour rather than an ink.
 *
 * `(max - min) / 255` rather than HSL saturation: saturation is a ratio, so it goes to
 * extremes at both ends of the lightness scale, and `#1a1a2e` — a black with a hint of
 * blue, and unmistakably an ink — comes out at 0.28 saturation against 0.078 here.
 */
const NEUTRAL_CHROMA = 0.15;

/** Below this lightness a neutral is the book's body ink rather than a deliberately dimmed grey (ADR-0014's measured gap). */
const BOOK_INK_LIGHTNESS = 0.25;

/**
 * Moves a colour's lightness until it clears the bar, and no further.
 *
 * **No further** is the whole of it: a colour that nearly reads should nearly not move.
 * The book's `#ff0000` sits at 4.30 against the reader's page and comes out `#ff2222`,
 * which nobody can tell apart from what the book wrote; any fixed target lightness would
 * drag it somewhere else entirely for the sake of the 0.2 it was short.
 *
 * The cost, stated plainly: **lightness is the thing being decided, so two colours that
 * differed only in lightness and both failed come out identical.** A book's `#000080` and
 * `#0000ff` both land on the same lifted blue. What survives is hue and saturation, and
 * every colour that already read is untouched.
 *
 * It walks in 1/256 steps rather than searching, because contrast is not monotonic along
 * the path when the colour starts on the far side of the background's own luminance — the
 * ratio dips to 1 as it crosses and rises again. Stepping finds the first lightness that
 * clears the bar whichever side it started on, and 256 steps of this arithmetic is nothing
 * next to parsing the stylesheet it came from.
 */
function lift(color: Rgb, background: Rgb): Rgb {
  const { hue, saturation, lightness: from } = toHsl(color);

  // Towards white or towards black, whichever end the reader's background is further from.
  const towards =
    contrastRatio(fromHsl(hue, saturation, 1), background) >=
    contrastRatio(fromHsl(hue, saturation, 0), background)
      ? 1
      : 0;

  for (let step = 1; step <= LIFT_STEPS; step += 1) {
    const candidate = fromHsl(hue, saturation, from + ((towards - from) * step) / LIFT_STEPS);
    if (contrastRatio(candidate, background) >= MIN_CONTRAST) return candidate;
  }

  // Unreachable for any background frond will meet in practice (white and black cannot both
  // fail against the same colour), but a mid grey background is a legal theme, and coming
  // back with the best available beats coming back with the original.
  return fromHsl(hue, saturation, towards);
}

const LIFT_STEPS = 256;

/** What a translucent colour actually looks like on the reader's page. */
function composite(color: Rgb, background: Rgb): Rgb {
  const mix = (over: number, under: number): number =>
    Math.round(over * color.alpha + under * (1 - color.alpha));
  return {
    r: mix(color.r, background.r),
    g: mix(color.g, background.g),
    b: mix(color.b, background.b),
    alpha: 1,
  };
}

/** How much hue a colour carries, 0 (a grey) to 1 (a primary). */
function chroma(color: Rgb): number {
  return (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / 255;
}

/** HSL's lightness, 0 (black) to 1 (white). */
function lightness(color: Rgb): number {
  return (Math.max(color.r, color.g, color.b) + Math.min(color.r, color.g, color.b)) / 2 / 255;
}

/** WCAG's relative luminance, which is what a contrast ratio is made of. */
function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

interface Hsl {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

function toHsl(color: Rgb): Hsl {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const l = (max + min) / 2;

  if (span === 0) return { hue: 0, saturation: 0, lightness: l };

  const s = span / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;

  return { hue: (((h * 60) % 360) + 360) % 360, saturation: s, lightness: l };
}

function fromHsl(hue: number, saturation: number, lightness: number): Rgb {
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    alpha: 1,
  };
}

function formatHex(color: Rgb): string {
  const pair = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
}

/**
 * A CSS colour value, or `undefined` for anything frond does not recognise.
 *
 * Hex, `rgb()`, `hsl()` and the named colours are covered because that is what books
 * write. `transparent` is deliberately **not** in the table: it parses as a colour in CSS,
 * but a book writing it is hiding text, and every caller here treats "not a colour" as
 * "leave it alone", which is the right answer for hidden text.
 *
 * The CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`), `currentColor` and
 * anything functional beyond the two above (`var()`, `color-mix()`, `oklch()`) fall out of
 * the same door for the same reason.
 */
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim().toLowerCase();

  const named = NAMED_COLORS.get(text);
  if (named !== undefined) {
    return { r: (named >> 16) & 0xff, g: (named >> 8) & 0xff, b: named & 0xff, alpha: 1 };
  }

  if (text.startsWith("#")) return parseHex(text.slice(1));

  const call = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (call === null) return undefined;

  const parts = splitComponents(call[2]!);
  if (parts === undefined) return undefined;

  const alpha = parseAlpha(parts.alpha);
  if (alpha === undefined) return undefined;

  return call[1]!.startsWith("hsl")
    ? parseHslComponents(parts.values, alpha)
    : parseRgbComponents(parts.values, alpha);
}

function parseHex(digits: string): Rgb | undefined {
  if (!/^[0-9a-f]+$/.test(digits)) return undefined;
  if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
    return undefined;
  }

  const short = digits.length < 6;
  const at = (index: number): number =>
    short
      ? parseInt(digits[index]! + digits[index]!, 16)
      : parseInt(digits.slice(index * 2, index * 2 + 2), 16);

  const hasAlpha = digits.length === 4 || digits.length === 8;
  return { r: at(0), g: at(1), b: at(2), alpha: hasAlpha ? at(3) / 255 : 1 };
}

/**
 * Takes the inside of `rgb(…)` apart into components and an alpha.
 *
 * Both notations have to work: the legacy `rgb(1, 2, 3, 0.5)` and the modern
 * `rgb(1 2 3 / 0.5)`. Commas and whitespace are the same separator here because no value
 * this recognises can contain either.
 */
function splitComponents(
  inside: string,
): { values: readonly string[]; alpha: string | undefined } | undefined {
  const [head, tail, ...rest] = inside.split("/");
  if (head === undefined || rest.length > 0) return undefined;

  const values = head
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token !== "");

  if (tail !== undefined) return { values, alpha: tail.trim() };
  if (values.length === 4) return { values: values.slice(0, 3), alpha: values[3] };
  return { values, alpha: undefined };
}

function parseRgbComponents(values: readonly string[], alpha: number): Rgb | undefined {
  if (values.length !== 3) return undefined;
  const channels = values.map((token) =>
    token.endsWith("%") ? scaled(number(token.slice(0, -1)), 255 / 100) : number(token),
  );
  if (channels.some((channel) => channel === undefined)) return undefined;

  const [r, g, b] = channels as number[];
  return { r: clampChannel(r!), g: clampChannel(g!), b: clampChannel(b!), alpha };
}

function parseHslComponents(values: readonly string[], alpha: number): Rgb | undefined {
  if (values.length !== 3) return undefined;

  const hue = parseHue(values[0]!);
  const saturation = percentage(values[1]!);
  const lightness = percentage(values[2]!);
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;

  return { ...fromHsl(hue, saturation, lightness), alpha };
}

/** Degrees, in any of the four angle units. A bare number is degrees, as CSS says. */
function parseHue(token: string): number | undefined {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/.exec(token);
  if (match === null) return undefined;

  const amount = Number(match[1]);
  const turns =
    match[2] === "grad"
      ? amount / 400
      : match[2] === "rad"
        ? amount / (2 * Math.PI)
        : match[2] === "turn"
          ? amount
          : amount / 360;

  return (((turns % 1) + 1) % 1) * 360;
}

/** `50%` and a bare `50` both mean half, which is what CSS says for these two components. */
function percentage(token: string): number | undefined {
  const amount = number(token.endsWith("%") ? token.slice(0, -1) : token);
  return amount === undefined ? undefined : Math.min(1, Math.max(0, amount / 100));
}

function parseAlpha(token: string | undefined): number | undefined {
  if (token === undefined) return 1;
  const amount = token.endsWith("%") ? scaled(number(token.slice(0, -1)), 1 / 100) : number(token);
  return amount === undefined ? undefined : Math.min(1, Math.max(0, amount));
}

/** `Number` on its own accepts an empty string, `Infinity` and hex — this does not. */
function number(token: string): number | undefined {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token) ? Number(token) : undefined;
}

function scaled(amount: number | undefined, factor: number): number | undefined {
  return amount === undefined ? undefined : amount * factor;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Every CSS named colour, packed as `0xRRGGBB`.
 *
 * The whole list rather than the sixteen a book is likely to write: it is data that will
 * never change again, and a partial table would mean `color: red` behaving one way and
 * `color: firebrick` another, with nothing on screen to say why. The values were read back
 * out of all three engines rather than typed from a reference (they agree exactly).
 *
 * `transparent` is not here on purpose — see `parseColor`.
 */
const NAMED_COLORS = new Map<string, number>(
  Object.entries({
    aliceblue: 0xf0f8ff,
    antiquewhite: 0xfaebd7,
    aqua: 0x00ffff,
    aquamarine: 0x7fffd4,
    azure: 0xf0ffff,
    beige: 0xf5f5dc,
    bisque: 0xffe4c4,
    black: 0x000000,
    blanchedalmond: 0xffebcd,
    blue: 0x0000ff,
    blueviolet: 0x8a2be2,
    brown: 0xa52a2a,
    burlywood: 0xdeb887,
    cadetblue: 0x5f9ea0,
    chartreuse: 0x7fff00,
    chocolate: 0xd2691e,
    coral: 0xff7f50,
    cornflowerblue: 0x6495ed,
    cornsilk: 0xfff8dc,
    crimson: 0xdc143c,
    cyan: 0x00ffff,
    darkblue: 0x00008b,
    darkcyan: 0x008b8b,
    darkgoldenrod: 0xb8860b,
    darkgray: 0xa9a9a9,
    darkgreen: 0x006400,
    darkgrey: 0xa9a9a9,
    darkkhaki: 0xbdb76b,
    darkmagenta: 0x8b008b,
    darkolivegreen: 0x556b2f,
    darkorange: 0xff8c00,
    darkorchid: 0x9932cc,
    darkred: 0x8b0000,
    darksalmon: 0xe9967a,
    darkseagreen: 0x8fbc8f,
    darkslateblue: 0x483d8b,
    darkslategray: 0x2f4f4f,
    darkslategrey: 0x2f4f4f,
    darkturquoise: 0x00ced1,
    darkviolet: 0x9400d3,
    deeppink: 0xff1493,
    deepskyblue: 0x00bfff,
    dimgray: 0x696969,
    dimgrey: 0x696969,
    dodgerblue: 0x1e90ff,
    firebrick: 0xb22222,
    floralwhite: 0xfffaf0,
    forestgreen: 0x228b22,
    fuchsia: 0xff00ff,
    gainsboro: 0xdcdcdc,
    ghostwhite: 0xf8f8ff,
    gold: 0xffd700,
    goldenrod: 0xdaa520,
    gray: 0x808080,
    green: 0x008000,
    greenyellow: 0xadff2f,
    grey: 0x808080,
    honeydew: 0xf0fff0,
    hotpink: 0xff69b4,
    indianred: 0xcd5c5c,
    indigo: 0x4b0082,
    ivory: 0xfffff0,
    khaki: 0xf0e68c,
    lavender: 0xe6e6fa,
    lavenderblush: 0xfff0f5,
    lawngreen: 0x7cfc00,
    lemonchiffon: 0xfffacd,
    lightblue: 0xadd8e6,
    lightcoral: 0xf08080,
    lightcyan: 0xe0ffff,
    lightgoldenrodyellow: 0xfafad2,
    lightgray: 0xd3d3d3,
    lightgreen: 0x90ee90,
    lightgrey: 0xd3d3d3,
    lightpink: 0xffb6c1,
    lightsalmon: 0xffa07a,
    lightseagreen: 0x20b2aa,
    lightskyblue: 0x87cefa,
    lightslategray: 0x778899,
    lightslategrey: 0x778899,
    lightsteelblue: 0xb0c4de,
    lightyellow: 0xffffe0,
    lime: 0x00ff00,
    limegreen: 0x32cd32,
    linen: 0xfaf0e6,
    magenta: 0xff00ff,
    maroon: 0x800000,
    mediumaquamarine: 0x66cdaa,
    mediumblue: 0x0000cd,
    mediumorchid: 0xba55d3,
    mediumpurple: 0x9370db,
    mediumseagreen: 0x3cb371,
    mediumslateblue: 0x7b68ee,
    mediumspringgreen: 0x00fa9a,
    mediumturquoise: 0x48d1cc,
    mediumvioletred: 0xc71585,
    midnightblue: 0x191970,
    mintcream: 0xf5fffa,
    mistyrose: 0xffe4e1,
    moccasin: 0xffe4b5,
    navajowhite: 0xffdead,
    navy: 0x000080,
    oldlace: 0xfdf5e6,
    olive: 0x808000,
    olivedrab: 0x6b8e23,
    orange: 0xffa500,
    orangered: 0xff4500,
    orchid: 0xda70d6,
    palegoldenrod: 0xeee8aa,
    palegreen: 0x98fb98,
    paleturquoise: 0xafeeee,
    palevioletred: 0xdb7093,
    papayawhip: 0xffefd5,
    peachpuff: 0xffdab9,
    peru: 0xcd853f,
    pink: 0xffc0cb,
    plum: 0xdda0dd,
    powderblue: 0xb0e0e6,
    purple: 0x800080,
    rebeccapurple: 0x663399,
    red: 0xff0000,
    rosybrown: 0xbc8f8f,
    royalblue: 0x4169e1,
    saddlebrown: 0x8b4513,
    salmon: 0xfa8072,
    sandybrown: 0xf4a460,
    seagreen: 0x2e8b57,
    seashell: 0xfff5ee,
    sienna: 0xa0522d,
    silver: 0xc0c0c0,
    skyblue: 0x87ceeb,
    slateblue: 0x6a5acd,
    slategray: 0x708090,
    slategrey: 0x708090,
    snow: 0xfffafa,
    springgreen: 0x00ff7f,
    steelblue: 0x4682b4,
    tan: 0xd2b48c,
    teal: 0x008080,
    thistle: 0xd8bfd8,
    tomato: 0xff6347,
    turquoise: 0x40e0d0,
    violet: 0xee82ee,
    wheat: 0xf5deb3,
    white: 0xffffff,
    whitesmoke: 0xf5f5f5,
    yellow: 0xffff00,
    yellowgreen: 0x9acd32,
  }),
);
