import { buildEpub, type EpubSpec, type ResourceSpec } from "../../src/test-fixtures/epub.ts";
import type { GrayscaleImage } from "../../src/test-fixtures/png.ts";
import {
  CHAPTER_TITLES,
  CLAUSES,
  GLOSS,
  LINES,
  NAMES,
  PLACES,
  SPEECH_VERBS,
  TIMES,
  ZHUYIN,
} from "./corpus.ts";
import { encodeJpeg } from "./jpeg.ts";

/**
 * Two novel-length Traditional Chinese books, one vertical and one horizontal, with the
 * same text — so the numbers measured on them differ only by direction and column count.
 *
 * They exist to measure page turns under load (issue #261, page-turn performance on a long
 * Chinese novel with many marks). What makes them a load is how much text there is and how
 * it is shaped, so the shape is set to look like a real novel and everything else is fixed:
 *
 * - **Length.** 23 chapters of about 7,000 characters plus one of about 50,000 — around
 *   210,000 in all. Each chapter is one section, which frond lays out as one document, so
 *   the long one is there to show what a single large document costs.
 * - **Ruby.** About one word in every 900 characters, mostly per-character zhuyin with a
 *   few whole-word glosses — the density of a translated light novel.
 * - **Images.** A small picture at the head of every chapter, ten inline illustrations and
 *   five full-page plates, all greyscale JPEG.
 *
 * The output is deterministic: a seeded generator and hand-written JPEG and ZIP writers, so
 * regenerating leaves no diff unless this file changed.
 */

export type NovelDirection = "vertical" | "horizontal";

const SEED = 0x7e1de5;

const CHAPTER_COUNT = 24;
/** Which chapter (1-based) is the long one. Put mid-book so it is reached by turning, not opened at. */
const LONG_CHAPTER = 13;
const CHAPTER_CHARACTERS = 7_000;
const LONG_CHAPTER_CHARACTERS = 50_000;

const CHARACTERS_PER_RUBY = 900;
const ILLUSTRATION_COUNT = 15;
/** Every third illustration is a full-page plate; the rest sit inline. */
const PLATE_EVERY = 3;

const DIALOGUE_SHARE = 0.42;
const SCENE_BREAK = "＊　＊　＊";

const TITLE = "霧港手記";

const STYLESHEET = `html {
  font-family: serif;
  line-height: 1.8;
}

body {
  margin: 0;
}

h1 {
  font-size: 1.5em;
  line-height: 1.4;
  margin: 1em 0 1.5em;
}

p {
  margin: 0;
  text-indent: 2em;
}

p.break,
p.figure {
  margin: 1em 0;
  text-indent: 0;
  text-align: center;
}

div.head {
  margin: 0 0 1em;
  text-align: center;
}

div.plate {
  break-before: page;
  break-after: page;
  text-align: center;
}

img {
  max-width: 100%;
}
`;

const VERTICAL = `
html {
  writing-mode: vertical-rl;
}
`;

/** mulberry32 — small, fast, and the same sequence on every platform. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** An integer in [low, high], weighted towards the middle the way sentence counts are. */
function around(random: Random, low: number, high: number): number {
  return low + Math.round(((random() + random()) / 2) * (high - low));
}

const PLAIN_CLAUSES = CLAUSES.filter((clause) => !clause.includes("《"));
const RUBY_CLAUSES = CLAUSES.filter((clause) => clause.includes("《"));

function fill(random: Random, clause: string): string {
  return clause
    .replaceAll("{name}", () => pick(random, NAMES))
    .replaceAll("{place}", () => pick(random, PLACES))
    .replaceAll("{time}", () => pick(random, TIMES));
}

/** `《word》` → ruby markup. */
function rubify(text: string): string {
  return text.replace(/《(.+?)》/g, (_, word: string) => {
    const zhuyin = ZHUYIN.get(word);
    if (zhuyin !== undefined) {
      const pairs = [...word].map((character, index) => `${character}<rt>${zhuyin[index]}</rt>`);
      return `<ruby>${pairs.join("")}</ruby>`;
    }
    const gloss = GLOSS.get(word);
    if (gloss === undefined) throw new Error(`no reading for ${word}`);
    return `<ruby>${word}<rt>${gloss}</rt></ruby>`;
  });
}

/** The characters a reader sees, which is what the length targets count. */
function visibleLength(text: string): number {
  return text.replace(/[《》]/g, "").length;
}

function sentenceEnd(random: Random): string {
  const roll = random();
  if (roll < 0.8) return "。";
  if (roll < 0.87) return "……";
  if (roll < 0.94) return "！";
  return "？";
}

/**
 * Draws ruby on a schedule rather than per clause, so the density holds at about one per
 * `CHARACTERS_PER_RUBY` with some jitter.
 */
class RubySchedule {
  readonly #random: Random;
  #next: number;

  constructor(random: Random) {
    this.#random = random;
    this.#next = CHARACTERS_PER_RUBY * (0.5 + random());
  }

  due(written: number): boolean {
    if (written < this.#next) return false;
    this.#next = written + CHARACTERS_PER_RUBY * (0.5 + this.#random());
    return true;
  }
}

function narration(random: Random, rubyDue: boolean): string {
  const sentenceCount = around(random, 1, 6);
  const sentences: string[] = [];
  const rubyAt = rubyDue ? Math.floor(random() * sentenceCount) : -1;
  for (let index = 0; index < sentenceCount; index += 1) {
    const clauses = Array.from({ length: around(random, 1, 4) }, () =>
      fill(random, pick(random, PLAIN_CLAUSES)),
    );
    if (index === rubyAt) clauses.splice(0, 1, fill(random, pick(random, RUBY_CLAUSES)));
    // Now and then two sentences share a semicolon instead of a full stop.
    const end = index < sentenceCount - 1 && random() < 0.08 ? "；" : sentenceEnd(random);
    sentences.push(clauses.join("，") + end);
  }
  return sentences.join("");
}

function dialogue(random: Random): string {
  const line = () => pick(random, LINES);
  const end = () => (random() < 0.75 ? "。" : random() < 0.5 ? "？" : "……");
  const speaker = pick(random, NAMES);
  const verb = pick(random, SPEECH_VERBS);
  switch (Math.floor(random() * 4)) {
    case 0:
      return `「${line()}${end()}」${speaker}${verb}。`;
    case 1:
      return `${speaker}${verb}：「${line()}${end()}」`;
    case 2:
      return `「${line()}，」${speaker}${verb}，「${line()}${end()}」`;
    default:
      return `「${line()}${end()}」`;
  }
}

interface Illustration {
  readonly kind: "plate" | "figure";
  readonly path: string;
}

function chapterBody(
  random: Random,
  chapter: number,
  target: number,
  illustration: Illustration | undefined,
): string {
  const lines = [
    `    <div class="head"><img src="${headPath(chapter)}" alt=""/></div>`,
    `    <h1>第${chineseNumeral(chapter)}章　${CHAPTER_TITLES[chapter - 1]}</h1>`,
  ];
  const ruby = new RubySchedule(random);
  const breaks = [target / 3, (target * 2) / 3].filter(() => random() < 0.6);
  const illustrationAt = illustration === undefined ? Infinity : target / 2;
  let written = 0;

  while (written < target) {
    const text =
      random() < DIALOGUE_SHARE ? dialogue(random) : narration(random, ruby.due(written));
    lines.push(`    <p>${rubify(text)}</p>`);
    written += visibleLength(text);

    if (breaks.length > 0 && written >= breaks[0]!) {
      breaks.shift();
      lines.push(`    <p class="break">${SCENE_BREAK}</p>`);
    }
    if (illustration !== undefined && written >= illustrationAt) {
      lines.push(
        illustration.kind === "plate"
          ? `    <div class="plate"><img src="${illustration.path}" alt=""/></div>`
          : `    <p class="figure"><img src="${illustration.path}" alt=""/></p>`,
      );
      illustration = undefined;
    }
  }
  return lines.join("\n");
}

function chineseNumeral(value: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensPart = tens === 0 ? "" : tens === 1 ? "十" : `${digits[tens]}十`;
  return tensPart + digits[ones];
}

function headPath(chapter: number): string {
  return `images/head-${String(chapter).padStart(2, "0")}.jpg`;
}

/** Spreads the illustrations evenly through the book, one per chapter at most. */
function illustrationsByChapter(): Map<number, Illustration> {
  const placed = new Map<number, Illustration>();
  let plates = 0;
  let figures = 0;
  for (let index = 0; index < ILLUSTRATION_COUNT; index += 1) {
    const chapter = 1 + Math.floor(((index + 0.5) * CHAPTER_COUNT) / ILLUSTRATION_COUNT);
    const kind = index % PLATE_EVERY === 0 ? "plate" : "figure";
    const number = kind === "plate" ? (plates += 1) : (figures += 1);
    placed.set(chapter, { kind, path: `images/${kind}-${String(number).padStart(2, "0")}.jpg` });
  }
  return placed;
}

/**
 * A greyscale picture with roughly the texture of a pencil illustration: a soft gradient,
 * a few dark shapes, hatching and grain. The point is a JPEG of realistic size and decode
 * cost, not a picture of anything.
 */
function picture(seed: number, width: number, height: number): GrayscaleImage {
  const random = seeded(seed);
  const shapes = Array.from({ length: 7 }, () => ({
    x: random() * width,
    y: random() * height,
    radius: (0.08 + random() * 0.25) * Math.min(width, height),
    depth: 40 + random() * 90,
  }));
  const hatchAngle = random() * Math.PI;
  const hatchX = Math.cos(hatchAngle);
  const hatchY = Math.sin(hatchAngle);
  return {
    width,
    height,
    sample: (x, y) => {
      let value = 235 - (y / height) * 45;
      let shade = 0;
      for (const shape of shapes) {
        const distance = Math.hypot(x - shape.x, y - shape.y) / shape.radius;
        if (distance < 1.6) shade = Math.max(shade, shape.depth * Math.exp(-distance * distance));
      }
      value -= shade;
      // Hatching only inside the shaded areas, the way a pencil fills shadow.
      if (shade > 30 && Math.floor((x * hatchX + y * hatchY) / 3) % 3 === 0) value -= 35;
      const grain = (Math.imul(x * 374761393 + y * 668265263, 1274126177 ^ seed) >>> 24) % 13;
      return Math.max(0, Math.min(255, Math.round(value - grain)));
    },
  };
}

function jpeg(path: string, seed: number, width: number, height: number): ResourceSpec {
  return { path, mediaType: "image/jpeg", contents: encodeJpeg(picture(seed, width, height)) };
}

interface Content {
  readonly sections: EpubSpec["readingOrder"];
  readonly resources: readonly ResourceSpec[];
  readonly cover: ResourceSpec;
}

let memo: Content | undefined;

/** The text and pictures, shared by both directions so they are identical byte for byte. */
function content(): Content {
  if (memo !== undefined) return memo;
  const random = seeded(SEED);
  const illustrations = illustrationsByChapter();

  const sections = Array.from({ length: CHAPTER_COUNT }, (_, index) => {
    const chapter = index + 1;
    const target = chapter === LONG_CHAPTER ? LONG_CHAPTER_CHARACTERS : CHAPTER_CHARACTERS;
    return {
      path: `chapter-${String(chapter).padStart(2, "0")}.xhtml`,
      title: `第${chineseNumeral(chapter)}章　${CHAPTER_TITLES[index]}`,
      body: chapterBody(random, chapter, target, illustrations.get(chapter)),
    };
  });

  const resources = [
    ...Array.from({ length: CHAPTER_COUNT }, (_, index) =>
      jpeg(headPath(index + 1), 100 + index, 600, 160),
    ),
    ...[...illustrations.values()].map((illustration, index) =>
      illustration.kind === "plate"
        ? jpeg(illustration.path, 200 + index, 600, 900)
        : jpeg(illustration.path, 200 + index, 600, 400),
    ),
  ];

  memo = { sections, resources, cover: jpeg("images/cover.jpg", 1, 600, 900) };
  return memo;
}

export function novelFileName(direction: NovelDirection): string {
  return `novel-length-${direction}-chinese.epub`;
}

export function buildNovel(direction: NovelDirection): Uint8Array {
  const { sections, resources, cover } = content();
  const vertical = direction === "vertical";
  return buildEpub({
    title: `${TITLE}（${vertical ? "直排" : "橫排"}）`,
    language: "zh-Hant",
    identifier: `urn:uuid:tidemarks-${novelFileName(direction).replace(".epub", "")}`,
    stylesheet: vertical ? STYLESHEET + VERTICAL : STYLESHEET,
    pageProgressionDirection: vertical ? "rtl" : "ltr",
    readingOrder: sections,
    cover: { ...cover, declaredBy: ["cover-image-property"] },
    resources,
  });
}
