// The highlight layer's geometry and colour policy.
//
// frond draws no highlights, and that is a decision rather than a gap (frond ADR-0002):
// which colours, which opacity, whether a tap opens the note — all product decisions. What
// it hands over is the fact, `rectsFor(cfi)`, plus the `layout` event saying when those
// rectangles went stale. This module is the policy that turns the one into the other; the
// component around it stays thin enough to be uninteresting.

/** A `DOMRect`, narrowed to what this module reads (so a test needs no DOM). */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
// The box to clip against is frond's `pageBox()`, and the type is frond's too — this module
// never measures anything itself, it decides what to do with what frond measured.
import { COLUMN_GAP, type PageBox } from "@yurenju/frond/renderer";

export interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box to paint, in container coordinates — left/top because that is what CSS wants. */
export interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One rectangle as frond reports it: the box, what it covers, and where its glyphs sit. */
export interface MarkedRectLike {
  readonly role: "text" | "ruby" | "blank";
  readonly rect: RectLike;
  readonly ink: RectLike;
}

/**
 * How thick the wave is, and how far it stands off the text — ADR-0032.
 *
 * 4px was chosen by looking at a prototype at reading size rather than by arithmetic: at 2px
 * the wave reads as a plain underline, and the wave is the mark this app is named for. It is
 * one value for every book, not a value per book, so there is one tile and one look — and no
 * chance of the three things that have to agree (the tile's own geometry, `mask-size`, and
 * this height) drifting apart, which fails silently by painting nothing.
 *
 * **The stylesheet repeats these two numbers, and now in two files**: in `--wave-h` / `--wave-v`
 * (`styles/tokens.css`) and in their `mask-size` (`styles/book.css`). They have to match; the
 * mask is the only place they can be expressed in CSS and the strip is the only place they can
 * be expressed here.
 */
export const WAVE_THICKNESS = 4;

/**
 * One period of the wave, along the direction it runs.
 *
 * Kept in the same proportion to the thickness as the 8×6 tile it replaces, because that ratio
 * is what makes it read as a wave rather than as a fuzzy line. Exported so a test can hold the
 * CSS to it — the sheet writes both numbers twice more, in each tile's viewBox and in its
 * `mask-size`, and a mask that disagrees with its box paints a chopped wave with no error.
 */
export const WAVELENGTH = 5.333;

/**
 * The gap between the text's ink and the mark, in px.
 *
 * Deliberately smaller than the gap left on the far side (ADR-0032 leaves 1.3px there): a mark
 * equidistant between two lines belongs to neither, and the reader has to work out which line
 * it is about. Nearer means it is about this one.
 */
export const MARK_CLEARANCE = 0.7;

// Which of a range's rectangles are on the page in front of the reader, clipped to it.
//
// frond reports **true** geometry: a position two pages ahead comes back at a large
// coordinate and one behind at a negative one, because pages are made by scrolling a single
// long multi-column layout. Deciding what to do about that is the consumer's ("which
// rectangles to draw is a clipping policy"), and this is that decision: keep the ones that
// intersect the page, and cut them at its edges.
//
// **The page, and not the container the layer is drawn on.** Those two are different boxes:
// the container carries the reader's margin and the page sits inset within it, while two
// adjacent pages are only `COLUMN_GAP` apart. So on a wide screen — where the line-length
// ceiling makes the margin several times that gap — the head of the *next* page falls inside
// the container, and clipping to the container paints its marks in this page's right-hand
// margin, cut in half at the container's edge (#41). Measured at a container of 1273 with a
// 157px margin: the next page begins at 1156, 117px inside the container.
//
// Clipping rather than relying on `overflow: hidden` keeps the answer in one place — the
// same boxes then work for painting and for hit-testing a tap, and a box that is half on
// screen does not become a target across its invisible half. That second half is why the
// margin band matters even though nothing is drawn there: a tap in it would otherwise open
// the note belonging to a mark on the next page.
export function visibleBoxes(rects: readonly RectLike[], page: PageBox): HighlightBox[] {
  const boxes: HighlightBox[] = [];

  for (const rect of rects) {
    const left = Math.max(page.left, rect.x);
    const top = Math.max(page.top, rect.y);
    const right = Math.min(page.left + page.width, rect.x + rect.width);
    const bottom = Math.min(page.top + page.height, rect.y + rect.height);

    // `>` and not `>=`: a rectangle touching the far edge exactly is the first sliver of
    // the next page, and it has no area on this one.
    if (right > left && bottom > top) {
      boxes.push({ left, top, width: right - left, height: bottom - top });
    }
  }

  return boxes;
}

/**
 * The strips of wave to paint for one marked passage — one per line, and none on a line with
 * nothing to mark.
 *
 * The strip **is** the mark: its box is the 4px band the wave fills, not the text it belongs
 * to. That is what lets the placement be a decision here rather than a guess in CSS, and it is
 * the difference between the mark landing beside the glyphs and landing on them.
 *
 * Three things happen per line, and each answers one of ADR-0032's requirements:
 *
 * - **Everything on the line pushes the mark outwards**, including the ruby annotation and a
 *   subscript, so the mark never crosses ink.
 * - **The line's rectangles are merged into one strip.** Not merely aligned: each strip is one
 *   element and a mask restarts at each element's own edge, so several strips on one line show
 *   a jump in the wave at every seam. Measured on a line broken by an `<em>`, the three boxes
 *   started the tile at 3.45, 1.17 and 0.
 * - **The ruby's own rectangle and any blank stretch are not marked**, though they still count
 *   towards the outward push and still answer a tap (`hitBoxes`).
 */
export function markStrips(
  marked: readonly MarkedRectLike[],
  page: PageBox,
  vertical: boolean,
): HighlightBox[] {
  const strips: RectLike[] = [];

  for (const line of lines(marked, vertical)) {
    const paintable = line.filter((one) => one.role === "text");
    if (paintable.length === 0) continue;

    // The outermost ink on the line, taken over everything on it rather than over what gets
    // painted: a ruby annotation is never marked and still decides where the mark goes.
    const outward = Math.max(...line.map((one) => outerEdge(one.ink, vertical)));
    const from = Math.min(...paintable.map((one) => alongStart(one.rect, vertical)));
    const to = Math.max(...paintable.map((one) => alongEnd(one.rect, vertical)));

    strips.push(
      vertical
        ? { x: outward + MARK_CLEARANCE, y: from, width: WAVE_THICKNESS, height: to - from }
        : { x: from, y: outward + MARK_CLEARANCE, width: to - from, height: WAVE_THICKNESS },
    );
  }

  return visibleBoxes(strips, page);
}

/**
 * The passage itself, for filling in — the text and nothing standing beside it.
 *
 * **The same `role === "text"` filter `markStrips` makes, and for the same reason.** A ruby
 * annotation is not the passage the reader marked; it is a gloss written above it, and the
 * blank stretches are the paragraph indent and the ragged end of a line. Filled in along with
 * the text, they make the wash a rectangle a line taller than the words inside it — which on a
 * vertical Japanese book means a column of colour beside every line carrying furigana.
 *
 * Not `hitBoxes`, which wants the opposite: a tap landing on the ruby of a marked word is still
 * a tap on that word. What is being answered here is "which passage", and the answer is drawn.
 */
export function textBoxes(marked: readonly MarkedRectLike[], page: PageBox): HighlightBox[] {
  return visibleBoxes(
    marked.filter((one) => one.role === "text").map((one) => one.rect),
    page,
  );
}

/** Where a tap counts as landing on this passage: every rectangle of it, whatever it covers. */
export function hitBoxes(marked: readonly MarkedRectLike[], page: PageBox): HighlightBox[] {
  return visibleBoxes(
    marked.map((one) => one.rect),
    page,
  );
}

/** How wide a [[Note dot]] is drawn, in px. */
export const NOTE_DOT_SIZE = 6;

/**
 * The square a [[Note dot]] answers a press in, centred on it.
 *
 * Four times the dot, because a fingertip does not find a 6px target. A pair of dots on one line
 * shares one of these rather than splitting it: two 12px halves would each be too small to hit.
 */
export const NOTE_DOT_TARGET = 24;

/** How far apart the centres of two dots on one line sit — less than a dot, so they overlap. */
export const NOTE_DOT_STEP = 4;

/**
 * The furthest a dot's centre stands out from the page's edge.
 *
 * Half the target, so on a wide margin the square reaches exactly to the text and no further. A
 * phone's margin is only 20px, and there the dot sits in the middle of it instead — its square
 * then runs a few px over the text, which is the price of a target a finger can find there.
 */
const NOTE_DOT_REACH = NOTE_DOT_TARGET / 2;

/** A marked passage with a note on it, as the dots need it: who it is, its ink, its rectangles. */
export interface NotedPassage {
  readonly id: string;
  readonly color: string;
  readonly marked: readonly MarkedRectLike[];
}

/** One dot to draw: whose it is, its ink, and its centre in container coordinates. */
export interface NoteDot {
  id: string;
  color: string;
  x: number;
  y: number;
}

/**
 * The dots on one line — one or two — and the square they answer a press in together.
 *
 * `dots[0]` is the passage that is read first, and a press on the square picks it.
 */
export interface NoteDotGroup {
  dots: NoteDot[];
  target: HighlightBox;
}

/**
 * Where the [[Note dot]]s go on the page in front of the reader: one per passage with a note,
 * beside the first line of it, in the margin at the end that line starts from — left of a
 * horizontal line, above a vertical one.
 *
 * **The first line, and only on the page that line is on.** A passage running across a page
 * break is marked where it begins, which is also the page [[Reflect]] stops on when it is picked.
 * A passage whose opening line is on the previous page gets no dot here, though its text does.
 *
 * **Two passages starting on one line share a place.** Their dots are set side by side and
 * overlapping, the one read first at the end the line starts from — to the left on a horizontal
 * line, to the right above a vertical one, since vertical lines run right to left. A third on the
 * same line is not drawn: a row of dots in the margin is a thing to count, not a mark to notice.
 *
 * **In two columns, the second column's margin is the gap before it.** A dot in the page's own
 * margin would sit beside the first column's line at that height, which is a different passage.
 * Only a horizontal book is ever set in two (frond cannot paginate a vertical one in more), so
 * `columns` is about horizontal pages; it is the count `resolveLayout` last answered with.
 *
 * `passages` is taken in book order and the groups come back in it, which is the order they are
 * reached by Tab.
 */
export function noteDots(
  passages: readonly NotedPassage[],
  page: PageBox,
  vertical: boolean,
  columns = 1,
): NoteDotGroup[] {
  const count = vertical ? 1 : Math.max(1, columns);
  const pitch = (page.width + COLUMN_GAP) / count;
  const groups: {
    column: number;
    across: { start: number; end: number };
    members: NotedPassage[];
  }[] = [];

  for (const passage of passages) {
    const first = lines(passage.marked, vertical)[0];
    if (first === undefined) continue;
    const text = first.filter((one) => one.role === "text");
    // Clipped to the page, so a passage that begins on another page has nothing left here.
    const shown = visibleBoxes(
      (text.length > 0 ? text : first).map((one) => one.rect),
      page,
    );
    if (shown.length === 0) continue;

    const across = {
      start: Math.min(...shown.map((box) => (vertical ? box.left : box.top))),
      end: Math.max(
        ...shown.map((box) => (vertical ? box.left + box.width : box.top + box.height)),
      ),
    };
    const column = Math.min(
      count - 1,
      Math.max(0, Math.floor((Math.min(...shown.map((box) => box.left)) - page.left) / pitch)),
    );
    const line = groups.find(
      (group) =>
        group.column === column &&
        Math.min(group.across.end, across.end) - Math.max(group.across.start, across.start) > 0,
    );
    if (line === undefined) groups.push({ column, across, members: [passage] });
    else if (line.members.length < 2) line.members.push(passage);
  }

  return groups.map(({ column, across, members }) => {
    const middle = (across.start + across.end) / 2;
    const edge = page.left + column * pitch;
    const margin = column === 0 ? page.left : COLUMN_GAP;
    const centre = vertical
      ? { x: middle, y: page.top - Math.min(NOTE_DOT_REACH, page.top / 2) }
      : { x: edge - Math.min(NOTE_DOT_REACH, margin / 2), y: middle };
    // Along the margin, the start of the line is left for a horizontal one and right for a
    // vertical one; the first of a pair goes that way.
    const toStart = vertical ? 1 : -1;
    const spread = members.length === 2 ? NOTE_DOT_STEP / 2 : 0;
    return {
      dots: members.map((member, index) => ({
        id: member.id,
        color: member.color,
        x: centre.x + (index === 0 ? toStart : -toStart) * spread,
        y: centre.y,
      })),
      target: {
        left: centre.x - NOTE_DOT_TARGET / 2,
        top: centre.y - NOTE_DOT_TARGET / 2,
        width: NOTE_DOT_TARGET,
        height: NOTE_DOT_TARGET,
      },
    };
  });
}

/** The side a mark is drawn beyond: under a horizontal line, to the right of a vertical one. */
function outerEdge(rect: RectLike, vertical: boolean): number {
  return vertical ? rect.x + rect.width : rect.y + rect.height;
}

/** Where a rectangle begins and ends along the direction the text runs. */
function alongStart(rect: RectLike, vertical: boolean): number {
  return vertical ? rect.y : rect.x;
}

function alongEnd(rect: RectLike, vertical: boolean): number {
  return vertical ? rect.y + rect.height : rect.x + rect.width;
}

/**
 * The rectangles grouped into the lines they were laid out on, in document order.
 *
 * Neither coordinate settles this alone, which is why the rule has three parts.
 *
 * **A ruby annotation joins the line before it, by what it is rather than by where it is.**
 * `<rt>` sits inside the `<ruby>` whose base characters precede it, so document order says so
 * outright — and geometry says the opposite: horizontally the annotation's box is above the
 * line and overlaps the *next* line's by 2px, measured on 18.4px Japanese set solid.
 *
 * For everything else, a rectangle starts a new line when it begins **before** the previous one
 * along the direction the text runs, or when the two do not overlap at all across it. Two
 * consecutive lines of plain prose begin at the same place, so the first half cannot separate
 * them; a superscript sits at a different height on the same line, so the second half must not.
 *
 * The comparison is against the last rectangle that was **not** a ruby annotation. Comparing
 * against the annotation instead breaks the vertical case, where it stands a full column-width
 * away from the characters that continue the same line.
 */
function lines(marked: readonly MarkedRectLike[], vertical: boolean): MarkedRectLike[][] {
  const grouped: MarkedRectLike[][] = [];
  let anchor: RectLike | undefined;

  for (const one of marked) {
    if (one.role === "ruby" && grouped.length > 0) {
      grouped[grouped.length - 1]!.push(one);
      continue;
    }

    if (anchor === undefined || startsLine(one.rect, anchor, vertical)) grouped.push([]);
    grouped[grouped.length - 1]!.push(one);
    anchor = one.rect;
  }

  return grouped;
}

function startsLine(rect: RectLike, anchor: RectLike, vertical: boolean): boolean {
  if (alongStart(rect, vertical) < alongStart(anchor, vertical)) return true;

  const across = vertical
    ? {
        start: rect.x,
        end: rect.x + rect.width,
        wasStart: anchor.x,
        wasEnd: anchor.x + anchor.width,
      }
    : {
        start: rect.y,
        end: rect.y + rect.height,
        wasStart: anchor.y,
        wasEnd: anchor.y + anchor.height,
      };
  const overlap = Math.min(across.end, across.wasEnd) - Math.max(across.start, across.wasStart);
  return overlap <= 0;
}

// Whether a point landed on one of these boxes.
//
// This is how tapping a highlight opens its note. The alternative — letting the overlay
// take pointer events — would mean the layer either swallows taps meant for the page
// (breaking the tap-to-turn zones) or has to pass them back through, and `pointerup`
// already arrives from frond in these very coordinates.
export function boxesContain(
  point: { readonly x: number; readonly y: number },
  boxes: readonly HighlightBox[],
): boolean {
  return boxes.some(
    (box) =>
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height,
  );
}

/**
 * The four inks a reader can mark with.
 *
 * Inks, and not highlighter colours: a marked passage is a wavy line along the edge of the
 * text in one of these — a tidemark, which is what the product is named for — and nothing
 * else. No wash, no block of colour.
 *
 * `indigo` is the default and carries the brand's own blue, so a reader who never opens the
 * setting marks passages in the colour this app is named for. It is deliberately not the blue
 * that means "you can press this": those two are the one pair the palette may never merge
 * (ADR-0022), and they are told apart by shape as much as by hue — a 2px wave under a line of
 * text against a filled control.
 *
 * The labels name pigments rather than colours — 蓼藍 rather than 藍色 — so each one carries
 * the material a scribe would have ground. Translating them is picking that language's name for
 * the same pigment, not describing the hue.
 */
export type MarkName = "indigo" | "ochre" | "moss" | "soot";

export const MARKS: readonly { name: MarkName; label: MessageDescriptor }[] = [
  {
    name: "indigo",
    label: msg({
      message: "Indigo",
      comment:
        "One of four ink colours for marking a passage. A pigment name, not a hue: the dye from the indigo plant (蓼藍).",
    }),
  },
  {
    name: "ochre",
    label: msg({
      message: "Ochre",
      comment: "One of four ink colours for marking a passage. A pigment name: red earth (赭石).",
    }),
  },
  {
    name: "moss",
    label: msg({
      message: "Moss",
      comment:
        "One of four ink colours for marking a passage. A pigment name: the green of moss (苔綠).",
    }),
  },
  {
    name: "soot",
    label: msg({
      message: "Soot",
      comment:
        "One of four ink colours for marking a passage. A pigment name: lampblack ground from pine soot (松煙), the black of an ink stick.",
    }),
  },
];

/** What a mark made without picking a colour is made in. */
export const DEFAULT_MARK: MarkName = "indigo";

/**
 * The four names this app used to write, and the ink each becomes.
 *
 * `color` on an `Annotation` has always held a **name**, never a value — which is why there is
 * no data migration here and none is needed. A row written by an older copy of the app, or by
 * one still running on the reader's other device, says `yellow`, and `yellow` is now the name
 * of nothing. Rather than let those marks fall back to the default and quietly all become the
 * same colour, each is mapped to the ink nearest the pigment it used to be.
 */
const RETIRED_NAMES: Record<string, MarkName> = {
  yellow: "ochre",
  blue: "indigo",
  green: "moss",
  pink: "soot",
};

/**
 * The CSS the ink is drawn from, as a custom-property reference rather than a value.
 *
 * A hex here would be a third place the light and dark palettes have to agree, and it would be
 * read once at render — so a mark drawn before the reader switched themes would keep the other
 * theme's colour until the next layout. Handing back `var(--mark-ochre)` leaves the value in
 * `styles/tokens.css` where both themes are already written down, and the browser re-resolves it.
 *
 * A name from neither table (a newer version of the app synced a fifth ink down) gets the
 * default rather than nothing: an invisible highlight is a passage the reader marked and
 * cannot find.
 */
export function markVar(color: string): string {
  const name = color in RETIRED_NAMES ? RETIRED_NAMES[color] : color;
  const known = MARKS.some((mark) => mark.name === name);
  return `var(--mark-${known ? name : DEFAULT_MARK})`;
}
