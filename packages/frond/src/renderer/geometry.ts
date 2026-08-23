/**
 * The arithmetic of pagination. **This module does not touch the DOM** — its inputs are
 * measured sizes and its outputs are the column configuration and page positions.
 *
 * Lifting it into pure functions is not cosmetic; it is what gives defects like
 * "several pages stacked in one screen" something to hold them. Every cause of that
 * defect lies in the arithmetic (a column width applied to the wrong axis, fractional
 * pixels accumulating, the rounding direction of a page count), and arithmetic is the
 * most expensive and least reproducible thing to chase inside a browser — left in
 * `section-view.ts`, answering one boundary condition would mean opening three
 * browsers.
 *
 * ## Columns overflow along the inline axis, and `column-width` measures the inline size
 *
 * This is the foundation of the whole module, and it is measured in all three
 * (`tests/browser/renderer/multicol-geometry.spec.ts`):
 *
 * | Writing mode | Inline axis | `column-width` measures | Which axis pages advance along |
 * | --- | --- | --- | --- |
 * | `horizontal-tb` | horizontal | width | x |
 * | `vertical-rl` | vertical (characters run top to bottom) | **height** | **y** |
 *
 * The rule spine walked into — "a vertical column width has to equal exactly one viewer
 * height" — is the second row, but that sentence gives only the conclusion; answering
 * which number to change after the viewport changes shape takes this table.
 *
 * ## The whole-pixel discipline is applied to the container, not to the column width
 *
 * spine's patch rounds `column-width` down (`Math.floor`), whereas what actually needs
 * rounding is the **container's inline size**. The reason is that `column-width` is
 * only a suggestion in the spec: once the column count is settled, the width actually
 * used is always derived back from the container size. So with the column width rounded
 * and the container still fractional, the page stride (`stride`) is still fractional,
 * and after a few dozen page turns the accumulated error becomes two half-pages stacked
 * in one screen.
 *
 * Both are rounded here — rounding the container is the one that treats the cause, and
 * rounding the column width keeps the two numbers consistent in the single-column case.
 */

/** The book's writing mode. frond v1's vertical mode is always `vertical-rl` (CONTEXT.md). */
export type WritingMode = "horizontal-tb" | "vertical-rl";

/** Which axis pages advance along. */
export type PageAxis = "x" | "y";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** How many columns the reader wants. `"auto"` is only meaningful horizontally (ADR-0003). */
export type ColumnChoice = 1 | 2 | "auto";

/**
 * The margin around the layout.
 *
 * A scalar means all four sides equally. The object form **splits by axis according to
 * the writing mode**, not into top/right/bottom/left:
 *
 * | | Inline axis (`inline`) | Block axis (`block`) |
 * | --- | --- | --- |
 * | `horizontal-tb` | left and right | top and bottom |
 * | `vertical-rl` | **top and bottom** | **left and right** |
 *
 * Splitting by axis rather than by physical side is right because what the reader is
 * really adjusting is the **line length**. Adjusting left and right in a horizontal book
 * and top and bottom in a vertical one looks like two different things, but both are
 * "make the lines a bit shorter" — both fall on the inline axis. Expressed as physical
 * sides, the same preference would have to be written into a different field on
 * switching to a vertical book, and every consumer would have to do that conversion
 * itself (which is what spine does today:
 * `vertical ? '${m}px 16px' : '16px ${m}px'`).
 */
export type Margin = number | { readonly block: number; readonly inline: number };

/** The inset on each of the four physical sides, in px. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Landing the margin on the four physical sides.
 *
 * In vertical mode the inline axis is vertical (characters run top to bottom), so
 * `inline` supplies top and bottom — the opposite of horizontal. Getting this case
 * wrong does not raise an error; the symptom is "adjusting the margin on a vertical book
 * does not change the line length, it widens the gutter between pages".
 */
export function marginInsets(margin: Margin, writingMode: WritingMode): Insets {
  if (typeof margin === "number") {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }

  const { block, inline } = margin;
  return writingMode === "vertical-rl"
    ? { top: inline, right: block, bottom: inline, left: block }
    : { top: block, right: inline, bottom: block, left: inline };
}

export interface ColumnRequest {
  readonly writingMode: WritingMode;
  /** The available layout size, with the reader's margin already subtracted. */
  readonly viewport: Viewport;
  readonly columns: 1 | 2;
  /** The column gap. It is also the invisible gutter between two adjacent pages. */
  readonly gap: number;
}

/**
 * A document's column configuration and page geometry.
 *
 * `stride` is the one quantity worth remembering here: **the distance between adjacent
 * pages along the pagination axis**. It is not equal to `inlineSize` — a `columnGap`
 * separates one column from the next, and that gutter falls between two pages where the
 * reader never sees it. Turning a page is moving the scroll position by one `stride`.
 */
export interface PageMetrics {
  readonly axis: PageAxis;
  /** The container's size along the inline axis, which is the visible length of one page. A whole number. */
  readonly inlineSize: number;
  /** The container's size along the block axis. A whole number. */
  readonly blockSize: number;
  readonly columnWidth: number;
  readonly columnGap: number;
  readonly columnCount: number;
  readonly stride: number;
}

/**
 * The tolerance for fractional pixels.
 *
 * Used when rounding the page count: the total content length is measured, and at
 * fractional DPI the last page frequently exceeds it by a fraction of a pixel, so a bare
 * `ceil` conjures an extra page out of nothing — and that page is empty.
 *
 * spine's `SCROLL_EPSILON = 4` treats the same class of ailment, but it applies to the
 * **page-turn boundary test** (`scrollTop` falls short and so never crosses a section
 * boundary). frond does not need that one: page positions are computed as whole
 * multiples of `stride`, and "have we reached the end" asks the page number rather than
 * the scroll coordinate, so that boundary never goes through a floating-point comparison
 * at all (`section-view.ts`).
 */
const SUBPIXEL_TOLERANCE = 1;

/**
 * The threshold for two columns. Narrower than this, `"auto"` gives one column — two
 * columns would leave under 20 Latin characters each, and lines that short are harder to
 * read, not easier.
 */
const TWO_COLUMN_MIN_INLINE_SIZE = 700;

/**
 * The column gap frond lays out with.
 *
 * With one column it falls entirely off screen — it is the invisible gutter between two
 * adjacent pages; with two it is the separator inside the page. 40px is chosen because two
 * columns of text too close together make the eye jump lines, and the same value sets the
 * distance between two pages in single-column mode, a stretch the reader never sees. So it
 * does not have to be a reader setting, and a fixed value will do.
 *
 * ## Why it is on the public face
 *
 * A consumer deciding how much of the container the text may have does this arithmetic
 * **backwards**: "lines of at most N ems, in two columns" needs
 * `N × fontSize × 2 + COLUMN_GAP`, and the leftover is the margin. That is the shape of
 * every line-length ceiling, and there is no way to write it without this number.
 *
 * Unexported, the only thing left to a consumer is copying the digits — and a copy does
 * not break when the original changes. It goes on computing a slightly wrong line length,
 * with nothing to say so.
 */
export const COLUMN_GAP = 40;

/**
 * Which edge of the container the incoming page comes in from during a turn.
 *
 * **The consumer names it**, and frond does not derive it from the book. A right-to-left book
 * brings the next page in from the left; but so does an interface that has decided a leftward
 * swipe means forward on a left-to-right book, and which of those is right is policy
 * (ADR-0002).
 *
 * It is stated as an edge rather than as an axis plus a sign because that is the sentence the
 * consumer can check against the screen: "the next page comes in from the left."
 */
export type TurnEdge = "left" | "right" | "top" | "bottom";

/** Where the two pages of a turn sit, as offsets from where the current page rests. */
export interface TurnPlacement {
  readonly current: { readonly x: number; readonly y: number };
  readonly incoming: { readonly x: number; readonly y: number };
}

/**
 * The two pages' offsets when a turn is `distance` px along.
 *
 * The pair moves as one sheet: they start exactly `extent` apart and stay exactly `extent`
 * apart, so the seam between them never opens and never overlaps. At `distance === extent` the
 * incoming page is where the current one began, which is what makes committing a turn a matter
 * of swapping which view is which rather than of moving anything.
 *
 * **This is not the in-document `stride`.** A page turn inside one document moves the scroll
 * position by `stride`, which includes the column gap the reader never sees. A turn in progress
 * moves two separate documents past the container, so what it travels is the container's own
 * extent — the pages' own margins are what the reader sees between them.
 */
export function turnPlacement(edge: TurnEdge, distance: number, extent: number): TurnPlacement {
  const moved = Math.min(Math.max(distance, 0), extent);
  const towards = edge === "left" || edge === "top" ? 1 : -1;
  // Spelt out rather than `moved * towards` so that a turn that has not started yet reports 0
  // and not -0. The two are the same number to arithmetic and different values to a test.
  const offset = moved === 0 ? 0 : moved * towards;
  const away = offset - extent * towards;

  return edge === "left" || edge === "right"
    ? { current: { x: offset, y: 0 }, incoming: { x: away, y: 0 } }
    : { current: { x: 0, y: offset }, incoming: { x: 0, y: away } };
}

export function pageAxisFor(writingMode: WritingMode): PageAxis {
  return writingMode === "vertical-rl" ? "y" : "x";
}

/** The available length along the inline axis: width when horizontal, height when vertical. */
export function inlineExtentOf(writingMode: WritingMode, viewport: Viewport): number {
  return writingMode === "vertical-rl" ? viewport.height : viewport.width;
}

/** The available length along the block axis — the complement of `inlineExtentOf`. */
export function blockExtentOf(writingMode: WritingMode, viewport: Viewport): number {
  return writingMode === "vertical-rl" ? viewport.width : viewport.height;
}

/**
 * Landing the reader's requested column count on an actual column count.
 *
 * **Vertical is always single-column**, whatever the reader asked for — ADR-0003
 * explicitly lists this as a deliberate simplifying assumption, since multi-column
 * vertical raises the complexity of the pagination geometry markedly. A reader setting
 * columns to 2 on a vertical book is not an error, it is a preference that does not
 * apply right now; it still renders single-column, without throwing.
 */
export function resolveColumns(
  writingMode: WritingMode,
  choice: ColumnChoice,
  viewport: Viewport,
): 1 | 2 {
  if (writingMode === "vertical-rl") return 1;
  if (choice !== "auto") return choice;
  return inlineExtentOf(writingMode, viewport) >= TWO_COLUMN_MIN_INLINE_SIZE ? 2 : 1;
}

export function pageMetrics(request: ColumnRequest): PageMetrics {
  const { writingMode, viewport, columns, gap } = request;

  const inlineSize = Math.max(1, Math.floor(inlineExtentOf(writingMode, viewport)));
  const blockSize = Math.max(1, Math.floor(blockExtentOf(writingMode, viewport)));

  // The column width is derived back from the container, not the other way round — see
  // the file header, "the whole-pixel discipline is applied to the container".
  const columnWidth = Math.max(1, Math.floor((inlineSize - gap * (columns - 1)) / columns));

  return {
    axis: pageAxisFor(writingMode),
    inlineSize,
    blockSize,
    columnWidth,
    columnGap: gap,
    columnCount: columns,
    // The next page's first column starts at `inlineSize + gap`: after a page is filled
    // there is still a column gap. The value is the same for one column and for two —
    // with two, the gutter inside the page is also gap, which brings it back to the same
    // expression.
    stride: inlineSize + gap,
  };
}

/**
 * Where the page sits inside the container, in the container's own coordinates.
 *
 * **The page is not the container**, and the difference is the reader's margin: the frame is
 * inset within the container, so a consumer clipping to the container is clipping to a box
 * wider than the page by that margin on each side. Two adjacent pages are only `columnGap`
 * apart — 40px, and the margin on a wide screen is several times that — so the head of the
 * next page lands **inside the container** whenever the margin is wider than the gap, at
 * `left + width + columnGap`. Measured at a container of 1273 with a margin of 157: the next
 * page starts at 1156, which is 117px inside the container's own right edge.
 *
 * That is why this is a fact frond owes the consumer rather than one it can work out for
 * itself. Only frond turns a `Margin` into insets by writing mode and floors the sizes to
 * whole pixels, and a consumer re-deriving either would be re-deriving it slightly wrong.
 */
export interface PageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The page's box, from the two things that decide it: where the frame is, and how big.
 *
 * The size is read back off `metrics` rather than off the viewport it came from, so that this
 * box and the column arithmetic agree to the pixel — both then carry the same flooring.
 */
export function pageBoxFor(metrics: PageMetrics, insets: Insets): PageBox {
  const horizontal = metrics.axis === "x";

  return {
    left: insets.left,
    top: insets.top,
    // `inlineSize` measures along the inline axis, which is vertical in a vertical book
    // (the file header's table) — so which of the two it is depends on the writing mode.
    width: horizontal ? metrics.inlineSize : metrics.blockSize,
    height: horizontal ? metrics.blockSize : metrics.inlineSize,
  };
}

/**
 * Converting the total content length into a page count.
 *
 * @param scrollExtent the document's total length along the pagination axis (`scrollWidth` or `scrollHeight`)
 */
export function pageCountFor(metrics: PageMetrics, scrollExtent: number): number {
  return Math.max(1, Math.ceil((scrollExtent - SUBPIXEL_TOLERANCE) / metrics.stride));
}

/** The scroll position of page `page` (counting from 0) along the pagination axis. */
export function pageOffsetFor(metrics: PageMetrics, page: number): number {
  return page * metrics.stride;
}

/**
 * Which page a **scroll position** falls on.
 *
 * Rounds to the nearest whole number: scroll positions are always whole multiples of
 * `stride` (frond sets them itself), it is just that at fractional DPI the browser
 * adjusts them by a fraction of a pixel. Truncating would report page 2 for "just turned
 * to page 3".
 */
export function pageAt(metrics: PageMetrics, offset: number): number {
  return Math.max(0, Math.round(offset / metrics.stride));
}

/**
 * The furthest the document can actually be scrolled along the pagination axis.
 *
 * **It is not `pageOffsetFor(pageCount - 1)`**, and the gap between the two is what this
 * whole family of functions exists to bridge. Page positions are whole multiples of
 * `stride`, but the browser will not scroll past `scrollExtent - clientExtent`, and a last
 * page whose content stops short of filling the screen leaves those two apart.
 *
 * @param scrollExtent the document's total length along the pagination axis (`scrollWidth` or `scrollHeight`)
 * @param clientExtent the visible length along the same axis (`clientWidth` or `clientHeight`)
 */
export function maxScrollOffsetFor(scrollExtent: number, clientExtent: number): number {
  return Math.max(0, scrollExtent - clientExtent);
}

/**
 * Which page a scroll position falls on **when the document may not be able to scroll far
 * enough to bring that page to the head of the screen**.
 *
 * ## The page that cannot be scrolled to
 *
 * Two columns, and a section whose last page holds one column of text and nothing in the
 * second. The content reaches into that page, so it counts (`pageCountFor`, and
 * `lastPageWithContent` agrees) — but the document only extends half a page past the
 * previous one, and the browser stops scrolling at `scrollExtent - clientExtent`. Asked to
 * put the last page at the head of the screen, it lands **half a stride short**.
 *
 * `pageAt` alone then answers with the page before it, because that is genuinely the
 * nearest whole multiple of `stride`. Which makes "am I on the last page" false forever:
 * the consumer turns forward, the position does not move, and the section never ends
 * (#96). Rounding decides it, so it survives on one machine and fails on the next —
 * at integer DPI the clamped position lands a hair over the halfway mark and rounds up,
 * and at 1.5 it lands a hair under and rounds down.
 *
 * **Reaching the end of the scroll is therefore the answer, not evidence towards it.** The
 * whole of the content is on screen at that position, including whatever sits in the page
 * that could not be reached, so the reader is on the last page by the only definition that
 * matters to them.
 */
export function pageAtScroll(
  metrics: PageMetrics,
  offset: number,
  maxOffset: number,
  pageCount: number,
): number {
  const last = Math.max(0, pageCount - 1);
  if (offset >= maxOffset - SUBPIXEL_TOLERANCE) return last;
  return Math.min(pageAt(metrics, offset), last);
}

/**
 * Which page **a position inside the content** falls on.
 *
 * The difference from `pageAt` is the rounding direction, and that difference is not a
 * detail: a content position falls **anywhere within** a page, not on a whole multiple of
 * `stride`. Rounding to nearest would count the back half of a page as the next page —
 * the symptom being "jumping back to that page with a CFI lands on the following page",
 * and only when the position happens to sit late in the page, so it looks random.
 *
 * The tolerance is added in the positive direction so that a character sitting exactly at
 * the head of a page, but measured a fraction of a pixel short, counts on this page rather
 * than the previous one.
 */
export function pageContaining(metrics: PageMetrics, offset: number): number {
  return Math.max(0, Math.floor((offset + SUBPIXEL_TOLERANCE) / metrics.stride));
}
