/**
 * One section's view: an iframe, plus the measurement and scrolling of the document
 * inside it.
 *
 * One iframe per section (ADR-0006). There is barely a choice here — EPUB stylesheets
 * make heavy use of global selectors such as `body`, `p` and `*`, and Shadow DOM cannot
 * hold back pollution at that level; and pagination needs a real document to carry
 * `writing-mode` and multi-column.
 *
 * ## The margin is outside the iframe, not in the book's CSS
 *
 * The reader's margin is achieved by **insetting the iframe within its container**,
 * rather than injecting padding into the book. The difference is more than an
 * implementation preference: padding on the multi-column container makes the first column
 * start at a different place from the rest, so "one page turn = one page stride" no longer
 * holds (foliate has to track an extra `contentStart` for this). Insetting the iframe
 * leaves the document entirely unaware the margin exists — the stride is a clean whole
 * number, and the book's cascade never has to fight frond over `body`'s padding (spine
 * hung a MutationObserver that is never released to fight for that one slot).
 */

import {
  COLUMN_GAP,
  marginInsets,
  maxScrollOffsetFor,
  pageAtScroll,
  pageBoxFor,
  pageContaining,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  type Insets,
  type PageBox,
  type PageMetrics,
  type WritingMode,
} from "./geometry.ts";
import type { RendererKeyEvent, RendererPointerDownEvent, RendererPointerEvent } from "./events.ts";
import { blankRuns, inkWithin, minimumLineHeight, type FontInk } from "./ink.ts";
import { LAYOUT_STYLE_ID, layoutStylesheet } from "./layout.ts";
import { isElement, isTextLike } from "./node-type.ts";
import { withLayout, type ReaderSettings, type ResolveLayout } from "./settings.ts";
import type { SectionDocument } from "./document-source.ts";
import { textNodesIn } from "./text-index.ts";
import { readWritingMode } from "./writing-mode.ts";

/**
 * Where the settings a layout runs under come from: what the reader set, and the
 * consumer's chance to answer the layout ones from facts that do not exist until the
 * document is on screen (`settings.ts`'s `ResolveLayout`).
 *
 * The two travel as one value rather than as two parameters so that they cannot come
 * apart. Every path that lays out has to consult the resolver — a path that quietly used
 * the reader's settings alone would lay that section out to a different margin from its
 * neighbours, and nothing would report it.
 */
export interface SettingsSource {
  readonly reader: ReaderSettings;
  /** Absent means the reader's settings stand as they are. */
  readonly resolveLayout: ResolveLayout | undefined;
}

/**
 * What a rectangle covers, so a consumer marking a passage can decide whether to mark it.
 *
 * The rectangles come from walking to the text, and the walk knows things the geometry cannot
 * say: that this stretch is a ruby annotation rather than the words being annotated, or that
 * it is the two ideographic spaces a Chinese paragraph opens with. Both are inside the range
 * the reader selected and neither is somewhere a mark belongs, but nothing about a `DOMRect`
 * distinguishes them — which left the consumer to guess, and there is nothing to guess from.
 *
 * frond names them and stops there. Whether an annotation gets its own line, and whether a
 * blank stretch is still worth hit-testing, are the consumer's calls (ADR-0002).
 */
export type RectRole = "text" | "ruby" | "blank";

/** One rectangle of a range, with what it covers and where its glyphs actually sit. */
export interface MarkedRect {
  readonly role: RectRole;
  /** The box the DOM reports: the font's content area, internal leading and all. */
  readonly rect: DOMRect;
  /**
   * The same box shrunk to the glyphs' own extents, along the block axis.
   *
   * Equal to `rect` under vertical writing, for a replaced element, and for any font whose
   * metrics cannot be read — see `measurePart`.
   */
  readonly ink: DOMRect;
}

/** The settings this layout actually runs under. */
function settleSettings(
  source: SettingsSource,
  writingMode: WritingMode,
  host: HTMLElement,
): ReaderSettings {
  if (source.resolveLayout === undefined) return source.reader;

  const viewport = { width: host.clientWidth, height: host.clientHeight };
  return withLayout(source.reader, source.resolveLayout({ writingMode, viewport }));
}

export interface SectionViewHooks {
  /** The reader activated a link in the content. frond only prevents the default; the consumer decides whether to navigate (ADR-0002). */
  readonly onLinkActivate: (href: string) => void;
  /** The selection inside the iframe changed. */
  readonly onSelectionChange: () => void;
  /**
   * A pointer went down inside the iframe. Coordinates are already converted to the
   * container's coordinate system.
   *
   * Separate from the release because only the press can still decide what the browser
   * makes of it — `RendererPointerDownEvent.preventTapDefault()`.
   */
  readonly onPointerDown: (event: RendererPointerDownEvent) => void;
  /** A pointer moved inside the iframe. Coordinates are already converted, including the offset a turn in progress has put this frame at. */
  readonly onPointerMove: (event: RendererPointerEvent) => void;
  /** A pointer went up inside the iframe. */
  readonly onPointerUp: (event: RendererPointerEvent) => void;
  /** The system took the pointer away. No release follows it. */
  readonly onPointerCancel: (event: RendererPointerEvent) => void;
  /** A key inside the iframe. The outer page receives nothing while focus is in the iframe, so it has to come out through here. */
  readonly onKey: (kind: "keydown" | "keyup", event: RendererKeyEvent) => void;
}

/**
 * The writing mode could not be read.
 *
 * This is an **explicit failure** rather than a fallback to horizontal: Firefox returns an
 * empty string when it cannot be read (`docs/browser-quirks.md`), and an implementation
 * treating the empty string as horizontal has the symptom "vertical books occasionally lay
 * out entirely horizontally".
 */
export class WritingModeUnreadableError extends Error {
  constructor(path: string) {
    super(`${path}'s writing mode could not be read — the computed style is an empty string`);
    this.name = "WritingModeUnreadableError";
  }
}

export class SectionView {
  readonly document: Document;
  readonly writingMode: WritingMode;

  private readonly frame: HTMLIFrameElement;
  private readonly source: SectionDocument;
  private readonly host: HTMLElement;
  private metrics: PageMetrics;
  /** The reader's margin after landing on the four physical sides. Both coordinate conversion and iframe positioning need it. */
  private insets: Insets;

  /**
   * The gap the consumer asked to be left between one line's ink and the next, in px, and
   * whether the reader has already asked for a line height of their own.
   *
   * Kept because the floor is applied from `applyLayout`, which runs again on every resize,
   * while the settings are settled elsewhere.
   */
  private inkFloor: { readonly gap: number; readonly readerSet: boolean } | undefined;

  /**
   * The line height **the book itself asks for**, as a ratio, or `null` where it names none.
   *
   * Measured once, on the first layout, and never again — because after that the answer would
   * include frond's own floor. Reading it fresh each time is self-cancelling: the second pass
   * sees the raised value, concludes there is already enough room, drops the rule, and the
   * third pass raises it again. A resize is enough to set that off, and the symptom is a mark
   * back across the glyphs on a book that was fine a moment earlier.
   */
  private ownLineHeight: number | null | undefined;

  /** Per view, not per process: two books can both be set in `16px serif` and carry different bytes. */
  private readonly inkByFont = new Map<string, FontInk>();

  private measuring: CanvasRenderingContext2D | null | undefined;
  /** The text nodes flattened into document order. Measuring positions binary-searches it, so it is computed once. */
  private textNodes: readonly Text[];
  /**
   * The container's size when this layout was measured.
   *
   * Kept so that a resize notification can be told from a notification that merely
   * repeats the size already laid out at (`renderer.ts`'s ResizeObserver).
   */
  private measuredAt: { readonly width: number; readonly height: number };
  /**
   * How far this frame has been moved from where it rests, while a turn is in progress.
   *
   * Kept as a number rather than read back off the style, because it is needed on the hot path:
   * every `pointermove` inside a frame that has moved reports coordinates counted from the
   * frame's new corner, and this is what puts them back into the container's system.
   */
  private offset: { x: number; y: number } = { x: 0, y: 0 };
  /** The press that just went down asked for the browser's own action to be cancelled, and its touch has not arrived yet. */
  private tapDefaultRequested = false;
  /** The touches whose `touchend` is to be cancelled, by `Touch.identifier` — one entry per finger that asked. */
  private readonly cancelledTouches = new Set<number>();

  private constructor(
    frame: HTMLIFrameElement,
    source: SectionDocument,
    host: HTMLElement,
    document: Document,
    writingMode: WritingMode,
    metrics: PageMetrics,
    insets: Insets,
  ) {
    this.frame = frame;
    this.source = source;
    this.host = host;
    this.document = document;
    this.writingMode = writingMode;
    this.metrics = metrics;
    this.insets = insets;
    this.measuredAt = hostSize(host);
    this.textNodes = textNodesIn(document);
  }

  /** The container's size this layout was measured against. */
  get laidOutAt(): { readonly width: number; readonly height: number } {
    return this.measuredAt;
  }

  static async mount(
    host: HTMLElement,
    source: SectionDocument,
    settings: SettingsSource,
    hooks: SectionViewHooks,
    path: string,
  ): Promise<SectionView> {
    const frame = host.ownerDocument.createElement("iframe");

    // `allow-scripts` is forced on us by WebKit, not because the book's scripts should run:
    // without it, WebKit does not even deliver events to listeners the parent attached to
    // contentDocument (bug 218086, reproduced in all three in #7). The book's scripts were
    // already removed while the document was still text (`document-source.ts`), so this
    // sandbox value does not let code inside the book run.
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
    frame.setAttribute("title", "");
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.position = "absolute";
    frame.style.background = "transparent";
    // Hidden until the section is laid out and the anchor has landed — `reveal()`, called
    // from the renderer. See the note on `reveal()` for what the reader sees without this.
    //
    // `visibility` rather than `display: none`: a `display: none` iframe has no box, so
    // `metricsFor` would measure a zero-sized frame and the whole layout would be built
    // from it. A hidden-but-laid-out frame measures, loads its fonts and paginates exactly
    // as a visible one does; it is only not painted.
    frame.style.visibility = "hidden";
    host.append(frame);

    // Size it with a symmetric margin before loading. An axis-split margin needs the
    // writing mode to map onto physical sides, and that cannot be read until the document
    // has laid out — so the real size is measured again below, after the mode is read. A
    // scalar margin computes the same both times, so that path has no second reflow.
    //
    // The reader's own margin, not the resolver's: this sizing happens before the fact the
    // resolver answers from exists. Nothing has been laid out at this point either, so what
    // it decides is how large a frame the document loads into, not where a single line
    // falls.
    sizeFrame(frame, host, marginInsets(settings.reader.margin, "horizontal-tb"));

    await new Promise<void>((resolve, reject) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.addEventListener("error", () => reject(new Error(`${path}'s iframe failed to load`)), {
        once: true,
      });
      frame.src = source.url;
    });

    const document = frame.contentDocument;
    if (document === null) {
      throw new Error(`${path}'s contentDocument was unavailable after loading`);
    }

    // Measure only once the fonts have loaded. Pagination is a function of the fonts: the
    // line and page breaks measured before they arrive are provisional, and that set of
    // numbers gets written into the page count and the positions. foliate also uses this
    // in place of the unreliable `ResizeObserver` on Firefox (`docs/browser-quirks.md`
    // table 1, #3).
    await document.fonts.ready;

    const reading = readWritingMode(document);
    if (reading.kind === "unreadable") throw new WritingModeUnreadableError(path);

    // **This is the moment the layout settings are settled**, and it is the last one before
    // anything is laid out: the writing mode has just been read, and not a line has been
    // broken yet. A consumer whose margin is a function of the writing mode gets its answer
    // in for this layout — so there is no second one, and nothing to move the reader away
    // from the position `attach()` is about to restore.
    const settled = settleSettings(settings, reading.writingMode, host);

    // Size it once more **before** measuring geometry: `metricsFor` reads the iframe's
    // client size, and only now is it known which two sides an axis-split margin subtracts.
    const insets = marginInsets(settled.margin, reading.writingMode);
    sizeFrame(frame, host, insets);

    const view = new SectionView(
      frame,
      source,
      host,
      document,
      reading.writingMode,
      metricsFor(frame, settled, reading.writingMode),
      insets,
    );
    view.inkFloor = inkFloorFrom(settled);
    view.applyLayout();
    view.attachHooks(hooks);

    return view;
  }

  /**
   * Shows the frame. Called once, by the renderer, after the anchor has landed.
   *
   * ## What the reader sees when the frame is painted before this
   *
   * A document loads into the iframe long before it is paginated: the layout stylesheet is
   * empty until the writing mode has been read, and reading it comes after
   * `document.fonts.ready`. Painted during that gap, the section is an **ordinary
   * scrolling document** — lines the full width of the frame, images at their natural
   * size, a native scrollbar down the side (in the platform's own colours, not the
   * reader's theme), scrolled to the top of the section rather than to the position that
   * is about to be restored.
   *
   * The gap is as long as the fonts take. Measured in spine with a 16.7 MB CJK face
   * already on the device: **680 ms**, on every open of the book, because applying the
   * face rebuilds the section (`renderer.ts`'s `applySettings`).
   *
   * The reveal is the renderer's to call rather than something `mount()` does at the end,
   * because pagination is not the last step that moves the content: `applyAnchor` scrolls
   * to the page the reader was on. Revealing before it would trade a flash of unpaginated
   * text for a flash of page 1.
   */
  reveal(): void {
    this.frame.style.visibility = "visible";
  }

  /** Takes the frame off the screen again, without tearing it down. What a peek frame does between turns. */
  conceal(): void {
    this.frame.style.visibility = "hidden";
  }

  /**
   * Moves the frame away from where it rests, for a turn in progress.
   *
   * A transform rather than the `left`/`top` the margin uses: those are what the frame's
   * resting place is written in, and a turn has to be able to end by putting the number back to
   * zero without having to remember what it was.
   */
  place(x: number, y: number): void {
    this.offset = { x, y };
    this.frame.style.transform = x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px)`;
  }

  /**
   * Puts this frame on a compositor layer of its own, for as long as it is being moved.
   *
   * ## What it buys
   *
   * Without it the frame is painted into the page's own layer, and moving it repaints every
   * pixel it covers **on every frame of the drag** — a full-screen repaint per `pointermove`.
   * Measured over seven turns in Chromium: **298 paints, and 60 with this**.
   *
   * That cost is fill rate, not script, so a frame-rate measurement does not find it: a machine
   * fast enough to repaint a full screen inside 16.7ms drops no frames while doing it. It is a
   * phone that pays, and paint flashing in devtools that shows it.
   *
   * ## Why it is raised and lowered rather than left on
   *
   * **WebKit's hit-testing goes wrong while it stands.** With `will-change` declared at mount,
   * five of frond's own input tests fail there — a tap at real coordinates stops reaching the
   * document inside the frame, which on a phone is a book that cannot be tapped or turned. A
   * turn is the only time the frame moves, and during one the pointer is already captured by
   * the frame the press began in, so the window where hit-testing matters and the window where
   * the layer stands do not overlap.
   *
   * It is also what `will-change` is for: the standard says to declare it shortly before the
   * change and to take it away afterwards, because a layer costs memory for as long as it
   * stands — and frond holds three frames, not one.
   */
  promote(promoted: boolean): void {
    this.frame.style.willChange = promoted ? "transform" : "";
  }

  /**
   * Whether this frame is the one the reader is pointing at.
   *
   * A peek frame is visible during a turn and is **not** the one the gesture belongs to: a
   * finger that travels over it must keep reporting to the frame the press began in. Setting
   * this is also what keeps `data-frond-page` meaning "the page on screen", which is how a
   * consumer's own tests find the book among three frames.
   */
  setCurrent(current: boolean): void {
    this.frame.style.pointerEvents = current ? "" : "none";
    if (current) {
      this.frame.setAttribute(CURRENT_FRAME_ATTRIBUTE, "");
      this.frame.removeAttribute(PEEK_FRAME_ATTRIBUTE);
      return;
    }
    this.frame.removeAttribute(CURRENT_FRAME_ATTRIBUTE);
    this.frame.setAttribute(PEEK_FRAME_ATTRIBUTE, "");
  }

  /**
   * Whether the reader's keyboard is pointed at this frame.
   *
   * Read from the outer document rather than from this frame's own `activeElement`: every frame
   * has one at all times (the body, when nothing else holds it), so asking inside would say yes
   * for all three. From outside there is only ever one answer.
   */
  holdsFocus(): boolean {
    return this.frame.ownerDocument.activeElement === this.frame;
  }

  /**
   * Points the keyboard at this frame.
   *
   * `preventScroll`, because the container is what would move: the frame is one viewport large
   * and sits at the reader's margin, so scrolling it into view shifts the whole book by that
   * margin.
   */
  takeFocus(): void {
    this.frame.focus({ preventScroll: true });
  }

  /**
   * Stops the document being selectable for the duration of a turn, and puts it back after.
   *
   * A drag and a text selection are the same gesture until one of them is ruled out, and the
   * platform rules by its own clock: press and hold about half a second and it selects a word,
   * whatever the page is doing. With the page already following the finger, that word is not
   * something the reader asked for.
   *
   * `!important` on the inline style, because a book may declare `user-select` itself and the
   * cascade would otherwise decide this. It is **not an intervention** (ADR-0003): it lasts as
   * long as the reader's finger is down, and the book's own declaration is untouched underneath
   * it.
   *
   * ⚠️ **Whether this stops a long press that has already begun is not settled.** The
   * documentation on the neighbouring question was measured to be wrong once already
   * (`docs/browser-quirks.md` #4, frond #80), so the consumer keeps its own way of undoing a
   * selection that arrives anyway.
   */
  suppressSelection(suppressed: boolean): void {
    const root = this.document.documentElement;
    for (const property of ["user-select", "-webkit-user-select"]) {
      if (suppressed) root.style.setProperty(property, "none", "important");
      else root.style.removeProperty(property);
    }
  }

  /**
   * How many pages this section has.
   *
   * ## Why the scroll extent alone will not do
   *
   * The scroll extent counts **a tail consisting only of margin** as a page. Vertical mode
   * walks into this particularly easily: when the book writes `p { margin: 0 0 1em }` (the
   * norm in real books), that `margin-bottom` is a physical margin, and under `vertical-rl`
   * it falls on the **pagination axis** — so the last paragraph's bottom margin can push
   * the scroll extent into the next column, and that column has not a single character in
   * it.
   *
   * A reader turning to that page sees blank white, and "blank page" is one of the entries
   * on the closed defect list (`docs/agents/pull-requests.md`). Worse, it breaks the
   * identity of the position round trip: that page can report a page number but not a CFI
   * of its own (the nearest position is on the previous page), so "CFI → jump → CFI" does
   * not match on the last page.
   *
   * So the page count is the smaller of the two: the one from the scroll extent, and **the
   * page the content actually extends to**.
   */
  get pageCount(): number {
    const byScroll = pageCountFor(this.metrics, this.scrollExtent);
    const lastWithContent = this.lastPageWithContent();

    return lastWithContent === undefined
      ? byScroll
      : Math.max(1, Math.min(byScroll, lastWithContent + 1));
  }

  /**
   * Which page it is currently on, counting from 0.
   *
   * The scroll position alone does not answer this — a last page the document cannot
   * scroll far enough to reach is still the page the reader is looking at. See
   * `pageAtScroll`.
   */
  get page(): number {
    return pageAtScroll(this.metrics, this.scrollOffset, this.maxScrollOffset, this.pageCount);
  }

  /**
   * Scrolls to a page, **as far as the document will go**.
   *
   * Without the clamp the browser applies its own, which lands in the same place; what
   * would differ is what frond then believes about where it is. Doing it here keeps the
   * position frond asked for and the position it reads back the same number, which is what
   * `page` is answering against.
   */
  goToPage(page: number): void {
    const clamped = Math.min(Math.max(0, page), this.pageCount - 1);
    const offset = Math.min(pageOffsetFor(this.metrics, clamped), this.maxScrollOffset);
    const root = this.document.documentElement;

    if (this.metrics.axis === "y") root.scrollTop = offset;
    else root.scrollLeft = offset;
  }

  /**
   * Re-measures after the layout changed (the container size, the reader's margin or
   * column count).
   *
   * **The document is not reloaded**: only the content of `<style id="frond-layout">`
   * changes, the DOM is untouched, and so `Range`s pointing at nodes are still valid after
   * reflow — recovering a position therefore does not have to go through a CFI string round
   * trip.
   */
  relayout(settings: SettingsSource): void {
    // Settled again rather than carried over from the mount: the viewport is one of the
    // facts, and this is the path a resize arrives on. A consumer whose line length has a
    // ceiling wants a different margin at a different container size, and a cached answer
    // would hold the first one for as long as the section stays mounted.
    const settled = settleSettings(settings, this.writingMode, this.host);

    this.insets = marginInsets(settled.margin, this.writingMode);
    sizeFrame(this.frame, this.host, this.insets);
    this.metrics = metricsFor(this.frame, settled, this.writingMode);
    this.measuredAt = hostSize(this.host);
    this.inkFloor = inkFloorFrom(settled);
    this.applyLayout();
  }

  /** Where a `Range` falls along the pagination axis (with the scroll offset added back). */
  offsetOf(range: Range): number {
    const rect = firstVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.top + this.document.documentElement.scrollTop
      : rect.left + this.document.documentElement.scrollLeft;
  }

  /**
   * Which page a `Range` falls on.
   *
   * This goes through `pageContaining` rather than `pageAt` — a content position falls
   * anywhere within a page, not on a whole multiple of the stride (`geometry.ts`).
   */
  pageOf(range: Range): number {
    return Math.min(pageContaining(this.metrics, this.offsetOf(range)), this.pageCount - 1);
  }

  /**
   * The first character on some page.
   *
   * A binary search rather than a scan from the start: one section of the
   * `huge-single-section` book has over a thousand paragraphs, and scanning on every page
   * turn would mean measuring thousands of rectangles each time. The binary search holds
   * on the premise that **text nodes' positions along the pagination axis increase with
   * document order** — which is exactly the property of a multi-column layout.
   *
   * Returns `undefined` when nothing is found (a section with no text at all, such as the
   * one in `empty-and-image-only-sections`).
   */
  positionAtPageStart(page: number): { readonly node: Text; readonly offset: number } | undefined {
    if (this.textNodes.length === 0) return undefined;

    const target = pageOffsetFor(this.metrics, page);
    const nodeIndex = this.firstNodeAtOrAfter(target);
    const node = this.textNodes[nodeIndex];
    if (node === undefined) {
      // The target falls past the last text node: stop at its end.
      const last = this.textNodes[this.textNodes.length - 1]!;
      return { node: last, offset: last.length };
    }

    // This node may straddle the page boundary (a long paragraph), so binary-search once
    // more inside the node.
    return { node, offset: this.firstCharacterAtOrAfter(node, target) };
  }

  /**
   * Turns a position into a `Range` within this document.
   *
   * It lives here rather than letting the caller `createRange()` itself: a `Range` has to
   * be built by **this** document, and using the outer document's `createRange()` to point
   * at nodes inside the iframe throws `WrongDocumentError`. Keeping that constraint on the
   * side that owns the document means there is no second place the caller has to remember
   * it.
   */
  rangeAt(position: { readonly node: Node; readonly offset: number }): Range {
    const range = this.document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    return range;
  }

  /**
   * A `Range` spanning two positions of this document.
   *
   * Same reason as `rangeAt` for living here rather than at the caller: only this document
   * may build a `Range` over its own nodes.
   */
  rangeBetween(
    start: { readonly node: Node; readonly offset: number },
    end: { readonly node: Node; readonly offset: number },
  ): Range {
    const range = this.document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }

  /** A `Range` covering a whole element — the one needed when jumping to an anchor. */
  rangeOfNode(node: Node): Range {
    const range = this.document.createRange();
    range.selectNode(node);
    return range;
  }

  /** The element in this document with this id. */
  elementById(id: string): Element | null {
    return this.document.getElementById(id);
  }

  /**
   * A range's rectangles in the container's coordinate system — the geometry a consumer
   * needs to draw its own highlights (user stories 49 and 51).
   *
   * **These are the boxes of the content itself: the text, and any replaced element.** Not
   * the boxes of the elements containing it — see `contentRects` for why asking the range
   * directly is the wrong question.
   *
   * They are given **relative to the container** rather than to the iframe: the consumer
   * draws highlights on the container, and the iframe itself is offset by the margin.
   * Colour, style and animation are the consumer's decision; frond only supplies the
   * geometry (ADR-0002).
   */
  rectsFor(range: Range): readonly MarkedRect[] {
    // A zero-length range goes through `measurable` (expanding by one character first)
    // rather than being asked for its own rectangles, for the same reason as when measuring
    // a position: a caret on a column boundary gets drawn at the end of the previous
    // column. It also happens to solve the case where zero-width rectangles are all
    // filtered out and the consumer receives an empty array.
    const resolved =
      measurable(range)
        .map((candidate) =>
          contentRects(candidate, this.writingMode, (font) => this.fontInkFor(font)),
        )
        .find((rects) => rects.length > 0) ?? [];

    return resolved.map((marked) => ({
      role: marked.role,
      rect: this.inContainer(marked.rect),
      ink: this.inContainer(marked.ink),
    }));
  }

  /** Where the page sits in the container the consumer draws on. See `pageBoxFor`. */
  get pageBox(): PageBox {
    return pageBoxFor(this.metrics, this.insets);
  }

  /** The iframe is inset by the reader's margin; the consumer draws on the container. */
  private inContainer(rect: DOMRect): DOMRect {
    return new DOMRect(
      rect.left + this.insets.left,
      rect.top + this.insets.top,
      rect.width,
      rect.height,
    );
  }

  /** The current selection. `undefined` when there is none, or when it is not in this document. */
  selection(): Range | undefined {
    const selection = this.document.getSelection();
    if (selection === null || selection.rangeCount === 0) return undefined;

    const range = selection.getRangeAt(0);
    return range.collapsed ? undefined : range;
  }

  /** Drops the selection in this document. Raises `selectionchange` when there was one. */
  clearSelection(): void {
    this.document.getSelection()?.removeAllRanges();
  }

  destroy(): void {
    this.frame.remove();
    this.source.release();
  }

  /**
   * Which page the content actually extends to. Returns `undefined` for a section with
   * neither a character nor an image.
   *
   * "Content" covers text and replaced elements (images, video) — looking only at text
   * would judge an image-only section such as the one in
   * `empty-and-image-only-sections` to have zero pages.
   *
   * ## The last text node in document order is not necessarily drawable
   *
   * This is an ailment measured on real books (`hidden-trailing-notes`): books putting
   * footnotes **after** the body text and hiding them with `display: none`, so the reader
   * only sees them on tapping a marker, is a very common practice; so is hiding the entire
   * `nav.xhtml`. Those nodes are the last few in document order, and not one rectangle can
   * be measured for them.
   *
   * Taking such a node as the end of the content, `getBoundingClientRect()` gives **all
   * zeros** — so `axisEndOf` computes 0, `pageContaining` computes page 0, and the whole
   * section's page count is squashed to 1. The symptom is the reader being able to read
   * only the first page of a chapter and unable to turn past it, **with no error at all**:
   * the page count looks like a perfectly normal number. The worst section in the sample
   * has 8778 drawable characters and reports 1 page for the whole book.
   *
   * So this searches backwards for the first text node **that does have a measurable
   * rectangle**, rather than taking the last one. The length of that walk is the number of
   * hidden nodes on the tail, which is zero steps for a normal book.
   */
  private lastPageWithContent(): number | undefined {
    let end: number | undefined;

    for (let index = this.textNodes.length - 1; index >= 0; index -= 1) {
      const range = this.document.createRange();
      range.selectNodeContents(this.textNodes[index]!);
      const rect = renderedRect(range);
      if (rect !== undefined) {
        end = this.axisEndOf(rect);
        break;
      }
    }

    for (const element of this.document.querySelectorAll(REPLACED_ELEMENTS)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const candidate = this.axisEndOf(rect);
      end = end === undefined ? candidate : Math.max(end, candidate);
    }

    if (end === undefined) return undefined;

    // Subtract one pixel so that content filling a page exactly is not counted onto the
    // next page by the tolerance.
    return pageContaining(this.metrics, Math.max(0, end - 1));
  }

  /** A rectangle's far edge along the pagination axis, with the scroll offset added back. */
  private axisEndOf(rect: DOMRect): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? rect.bottom + root.scrollTop : rect.right + root.scrollLeft;
  }

  private get scrollExtent(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollHeight : root.scrollWidth;
  }

  private get scrollOffset(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollTop : root.scrollLeft;
  }

  /** The visible length along the pagination axis — `inlineSize`'s counterpart as the document sees it. */
  private get clientExtent(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.clientHeight : root.clientWidth;
  }

  /** How far this document can be scrolled at all. Read from the document, not computed from pages. */
  private get maxScrollOffset(): number {
    return maxScrollOffsetFor(this.scrollExtent, this.clientExtent);
  }

  /**
   * A font's ink, measured once per `font` shorthand and kept for this view.
   *
   * **The canvas belongs to the book's document, not to the page around it.** A face the
   * consumer handed over arrives as an `@font-face` inside the iframe (ADR-0006), and a canvas
   * in the outer realm cannot see it — `measureText` would quietly fall back and report some
   * other face's metrics for this book's text, which is the very mistake the guard below
   * exists to catch.
   *
   * **The probe is fixed, deliberately.** Measuring the text actually covered would make a
   * mark's height depend on which letters the reader happened to select — marking `mono` and
   * marking `happy` would put the line at two different distances from the same baseline. Two
   * constant strings give one answer per font.
   */
  private fontInkFor(font: string): FontInk | undefined {
    if (font.length === 0) return undefined;

    const remembered = this.inkByFont.get(font);
    if (remembered !== undefined) return remembered;

    if (this.measuring === undefined) {
      this.measuring = this.document.createElement("canvas").getContext("2d");
    }
    const context = this.measuring;
    if (context === null) return undefined;

    // **The shorthand does not round-trip, and checking that it does is a trap.** A canvas
    // normalises what it is given — `normal 400 16px serif` reads back as `16px serif` — so
    // comparing the two strings rejects every ordinary font and silently leaves every mark
    // where it was. What has to be caught is the *unparseable* shorthand, which leaves the
    // context on whatever font it held before. A sentinel separates the two: it survives only
    // if the assignment was thrown away.
    context.font = SENTINEL_FONT;
    context.font = font;
    if (context.font === SENTINEL_FONT) return undefined;

    const above = context.measureText(ASCENDERS);
    const below = context.measureText(DESCENDERS);
    const measured: FontInk = {
      boxAscent: above.fontBoundingBoxAscent,
      boxDescent: above.fontBoundingBoxDescent,
      inkAscent: above.actualBoundingBoxAscent,
      inkDescent: below.actualBoundingBoxDescent,
    };

    this.inkByFont.set(font, measured);
    return measured;
  }

  private applyLayout(): void {
    const style = this.document.getElementById(LAYOUT_STYLE_ID);
    if (style === null) return;
    style.textContent = layoutStylesheet(this.metrics, this.writingMode) + this.inkFloorRule();
  }

  /**
   * The `minimum-ink-gap` intervention: enough line height for a consumer to draw between the
   * lines, and not one step more.
   *
   * **No `!important`, and on the root alone.** The floor is for the case the book said
   * nothing — measured on Alice, whose body text is `line-height: normal` and leaves 4px
   * between the ink of consecutive lines. A book that states a line height has said what it
   * wants, and states it on a selector that beats this one; a book that says nothing inherits
   * this. Forcing the value would also *lower* everything a book set looser, which is the
   * opposite of the requirement.
   */
  private inkFloorRule(): string {
    const floor = this.inkFloor;
    if (floor === undefined || floor.readerSet) return "";
    // Vertical setting is skipped for the same reason `measurePart` skips it: a vertical text
    // rectangle is already tight to the glyphs, so there is no internal leading to recover and
    // `TextMetrics` cannot measure the cross axis anyway.
    if (this.writingMode !== "horizontal-tb") return "";

    const body = this.document.body;
    if (body === null) return "";
    const style = this.document.defaultView?.getComputedStyle(body);
    if (style === undefined) return "";

    const fontSize = parseFloat(style.fontSize);
    const ink = this.fontInkFor(fontShorthand(style));
    if (ink === undefined || !Number.isFinite(fontSize)) return "";

    if (this.ownLineHeight === undefined) {
      // `line-height: normal` parses as NaN, and that is the case the floor is for: the book
      // named no height, so there is nothing of the book's to override.
      const ratio = parseFloat(style.lineHeight) / fontSize;
      this.ownLineHeight = Number.isFinite(ratio) ? ratio : null;
    }

    const needed = minimumLineHeight(ink, fontSize, floor.gap);
    if (this.ownLineHeight !== null && this.ownLineHeight >= needed) return "";

    return `\n:root { line-height: ${roundUp(needed)}; }`;
  }

  private attachHooks(hooks: SectionViewHooks): void {
    this.document.addEventListener("click", (event) => {
      // **`instanceof Element` must not be used.** This module runs in the outer page's
      // realm while the event's target comes from the iframe's realm — the two realms have
      // their own `Element` constructors, so `instanceof` is always false. The symptom is
      // link events never being delivered, with no error message at all, looking exactly
      // like "this listener was never attached".
      const target = event.target as Node | null;
      if (target === null) return;

      const element = isElement(target) ? target : target.parentElement;
      const anchor = element?.closest("a[href]") ?? null;
      if (anchor === null) return;

      // Preventing the default is necessary: letting the iframe navigate there would throw
      // away the whole rendering state, after which frond's document reference points at a
      // document that is no longer on screen.
      event.preventDefault();
      hooks.onLinkActivate(anchor.getAttribute("href") ?? "");
    });

    this.document.addEventListener("selectionchange", () => {
      hooks.onSelectionChange();
    });

    // Pointer and key listeners are `passive`: frond makes no decision about them, and so
    // has nothing to prevent. The `touchend` below is the one exception, and it is a narrow
    // one — see it for why the reason behind this rule does not reach that far.
    this.document.addEventListener(
      "pointerdown",
      (event) => {
        const facts = event as unknown as PointerFacts;
        // What the press before this one asked is settled by now — either its touch ended
        // and took the answer with it, or the answer never reached a touch at all (a mouse).
        // Either way this press starts from no.
        this.tapDefaultRequested = false;
        hooks.onPointerDown({
          ...this.describePointer(facts),
          preventTapDefault: () => {
            this.tapDefaultRequested = true;
          },
        });
      },
      { passive: true },
    );

    // A move carries no decision of frond's either, and it is the one that arrives by the
    // hundred: a turn in progress is driven by nothing else.
    this.document.addEventListener(
      "pointermove",
      (event) => {
        hooks.onPointerMove(this.describePointer(event as unknown as PointerFacts));
      },
      { passive: true },
    );

    this.document.addEventListener(
      "pointerup",
      (event) => {
        hooks.onPointerUp(this.describePointer(event as unknown as PointerFacts));
      },
      { passive: true },
    );

    this.document.addEventListener(
      "pointercancel",
      (event) => {
        hooks.onPointerCancel(this.describePointer(event as unknown as PointerFacts));
      },
      { passive: true },
    );

    // **The answer is moved onto the finger that carries it**, and this is the only moment
    // where the two can be matched up: Pointer Events requires `pointerdown` to be dispatched
    // before the `touchstart` for the same contact, so the request the consumer just made
    // belongs to the touch arriving here.
    //
    // A single flag would be wrong as soon as two fingers are on the screen — a thumb resting
    // on the page while the other hand taps the edge. The second `pointerdown` would clear
    // the first finger's answer, and the first `touchend` to arrive would spend it whether or
    // not it was that finger's.
    this.document.addEventListener(
      "touchstart",
      (event) => {
        // A gesture starting from nothing cannot inherit anything: this bounds the set even
        // if an engine somewhere loses a `touchend`.
        if (event.touches.length === event.changedTouches.length) this.cancelledTouches.clear();
        if (!this.tapDefaultRequested) return;

        this.tapDefaultRequested = false;
        for (const touch of event.changedTouches) this.cancelledTouches.add(touch.identifier);
      },
      { passive: true },
    );

    this.document.addEventListener(
      "touchcancel",
      (event) => {
        for (const touch of event.changedTouches) this.cancelledTouches.delete(touch.identifier);
      },
      { passive: true },
    );

    // **The one non-passive listener**, and the mechanism behind `preventTapDefault()`.
    //
    // The rule above exists so the browser never waits on frond to decide whether to
    // scroll — but that decision is made from `touchstart` and `touchmove`. By `touchend`
    // the scrolling is long settled, so listening here costs the page nothing.
    //
    // Cancelling this event is what takes the tap's `click` away, and with it Chrome for
    // Android's Touch to Search. It stays registered whether or not any consumer ever asks:
    // a listener added later, once a press has already begun, would be too late for that
    // press, and an empty set is what makes it a no-op the rest of the time.
    this.document.addEventListener(
      "touchend",
      (event) => {
        let cancel = false;
        for (const touch of event.changedTouches) {
          if (this.cancelledTouches.delete(touch.identifier)) cancel = true;
        }
        if (cancel) event.preventDefault();
      },
      { passive: false },
    );

    for (const kind of ["keydown", "keyup"] as const) {
      this.document.addEventListener(
        kind,
        (event) => {
          hooks.onKey(kind, describeKey(event as unknown as KeyFacts));
        },
        { passive: true },
      );
    }
  }

  /**
   * A pointer event's position in the container's coordinate system, plus the two DOM
   * conditions at that instant.
   *
   * The iframe's content scrolls itself, and the iframe is only one viewport large — so the
   * event's `clientX`/`clientY` are already relative to the visible area, and **the scroll
   * offset must not be added back**. All that has to be added is how far the iframe is
   * offset within the container, which is the reader's margin. This is the same conversion
   * as `rectsFor()`, so both return the same coordinate system.
   *
   * (spine has to subtract `scrollLeft` on epub.js because the iframe there spans the whole
   * scrolled section. frond's iframe is not that shape, and copying that step would shift
   * the coordinates by a whole page.)
   */
  private describePointer(event: PointerFacts): RendererPointerEvent {
    // **`instanceof Element` must not be used** — the target comes from the iframe's realm,
    // for the same reason as the click listener above.
    const target = event.target as Node | null;
    const element = target === null ? null : isElement(target) ? target : target.parentElement;

    return {
      // `offset` is what a turn in progress has moved this frame by. Without it the coordinates
      // would be counted from a corner that is itself being dragged, so a page following the
      // finger would report the finger as standing still.
      x: event.clientX + this.insets.left + this.offset.x,
      y: event.clientY + this.insets.top + this.offset.y,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
      pointerType: event.pointerType,
      hasSelection: this.selection() !== undefined,
      isLink: (element?.closest("a[href]") ?? null) !== null,
    };
  }

  /** The index of the first text node whose end is at or after `target`. */
  private firstNodeAtOrAfter(target: number): number {
    let low = 0;
    let high = this.textNodes.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      const node = this.textNodes[middle]!;
      if (this.endOffsetOfNode(node) >= target) high = middle;
      else low = middle + 1;
    }

    return low;
  }

  /** The first character in this node that falls at or after `target`. */
  private firstCharacterAtOrAfter(node: Text, target: number): number {
    let low = 0;
    let high = node.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.offsetOfCharacter(node, middle) >= target) high = middle;
      else low = middle + 1;
    }

    return Math.min(low, Math.max(0, node.length - 1));
  }

  /** Where a node's end falls along the pagination axis. */
  private endOffsetOfNode(node: Text): number {
    const range = this.document.createRange();
    range.selectNodeContents(node);
    const rect = lastVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.bottom + this.document.documentElement.scrollTop
      : rect.right + this.document.documentElement.scrollLeft;
  }

  /** Where a character falls along the pagination axis. */
  private offsetOfCharacter(node: Text, offset: number): number {
    const range = this.document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, Math.min(offset + 1, node.length));
    return this.offsetOf(range);
  }
}

/**
 * Marks the frame the reader is reading, as opposed to the two waiting either side of it.
 *
 * On the public face in the sense that matters: a consumer's own tests have to be able to find
 * the book among three frames, and "the last iframe in the container" stopped being an answer
 * the moment there was more than one.
 */
export const CURRENT_FRAME_ATTRIBUTE = "data-frond-page";

/**
 * Marks a frame as one of the pages waiting either side of this one, **and as ready to be
 * dragged in**.
 *
 * A frame is in the container from the moment it starts loading, so counting frames says
 * nothing about whether a turn can preview one. The renderer sets this last of all, after the
 * peek has laid out and been scrolled to the page it is there to show, which makes it the
 * honest answer to "is the preview ready" — the one thing a consumer's tests cannot otherwise
 * wait for.
 */
export const PEEK_FRAME_ATTRIBUTE = "data-frond-peek";

/**
 * Insets the iframe within its container by the reader's margin.
 *
 * Positioning uses the physical `left`/`top` rather than the logical
 * `inset-inline-start`/`inset-block-start`. Those two logical properties resolve against
 * the **container's** writing mode, which is the consuming app's direction and has nothing
 * to do with the book's — when the consumer's page is rtl, `inset-inline-start` becomes the
 * right side, while `rectsFor()` adds back `rect.left`. With the two sides using different
 * frames of reference, every highlight would be displaced.
 */
function sizeFrame(frame: HTMLIFrameElement, host: HTMLElement, insets: Insets): void {
  const width = Math.max(1, Math.floor(host.clientWidth - insets.left - insets.right));
  const height = Math.max(1, Math.floor(host.clientHeight - insets.top - insets.bottom));

  frame.style.left = `${insets.left}px`;
  frame.style.top = `${insets.top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
}

/** The container's size, read the same way `sizeFrame` reads it. */
function hostSize(host: HTMLElement): { readonly width: number; readonly height: number } {
  return { width: host.clientWidth, height: host.clientHeight };
}

/**
 * The few fields frond reads from a pointer event.
 *
 * Written as a narrow interface rather than using `PointerEvent`: the event comes from the
 * iframe's realm, and its type is the outer realm's constructor while in fact it is not the
 * same one — reading data fields only is safe, and a narrow interface turns "reads data
 * fields only" into something the type system enforces.
 */
interface PointerFacts {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
  readonly target: EventTarget | null;
}

interface KeyFacts {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

function describeKey(event: KeyFacts): RendererKeyEvent {
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
  };
}

function metricsFor(
  frame: HTMLIFrameElement,
  settings: ReaderSettings,
  writingMode: WritingMode,
): PageMetrics {
  const viewport = {
    width: frame.clientWidth,
    height: frame.clientHeight,
  };

  return pageMetrics({
    writingMode,
    viewport,
    columns: resolveColumns(writingMode, settings.columns, viewport),
    gap: COLUMN_GAP,
  });
}

/**
 * Elements with content but no text. They have to count when deciding "is this page empty".
 *
 * `<iframe>` / `<object>` / `<embed>` are not included, and the reason is no longer "they
 * are not in the document". `stripScriptedContent` now leaves them where they stand and
 * empties them (ADR-0006, #65), so all three **can** appear — carrying
 * `display: none !important`, whose bounding rectangle is all zeros. Adding them to this
 * selector would therefore change nothing: the loop over it already skips a zero-sized
 * rectangle. They are left out to say that on purpose rather than by accident.
 */
const REPLACED_ELEMENTS = "img, svg, video, canvas";

/**
 * The boxes of the **content** a range covers: its text, and any replaced element.
 *
 * `range.getClientRects()` is the obvious way to ask this and it answers a different
 * question. Per CSSOM View it also includes the border box of every *element* the range
 * fully contains, and a paragraph's border box is the width of the whole column. So a
 * highlight spanning five paragraphs came back as four line boxes plus three column-wide
 * slabs, and the consumer drawing them has no field to tell the two apart — it would be
 * guessing from the width. Measured in chromium, a range over five 600px-wide paragraphs:
 *
 * | | `getClientRects()` | what the text occupies |
 * | --- | --- | --- |
 * | rectangles | 8 | 5 |
 * | widths | 80, **600**, 80, **600**, 64, **600**, 64, 64 | 80, 80, 64, 64, 64 |
 *
 * The same rule fires on inline elements, where it is easier to miss and no less wrong: an
 * `<em>` inside the range contributes its border box *and* its text's box at the same
 * coordinates, so those characters get painted twice and read a shade darker than their
 * neighbours.
 *
 * Walking to the text and asking each node for its own rectangles leaves no element boxes to
 * filter out — there is no width heuristic here, and none is needed. Replaced elements are
 * the deliberate exception: an `<img>` has no text box at all, and dropping it would leave a
 * highlight crossing a picture with a hole in it.
 */
function contentRects(
  range: Range,
  writingMode: WritingMode,
  inkFor: (font: string) => FontInk | undefined,
): readonly MarkedRect[] {
  const marked = coveredParts(range).flatMap((part) => measurePart(part, writingMode, inkFor));

  // Content that is neither text nor a replaced element — a range over a single `<br>`, say
  // — leaves nothing to measure. Falling back to the range's own rectangles keeps such a
  // consumer no worse off than before, and it cannot reintroduce the slabs above: this line
  // is only reached when the range contains no text for them to be wrong about.
  if (marked.length > 0) return marked;
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({ role: "text" as const, rect, ink: rect }));
}

/** One part's rectangles, each carrying where its ink sits inside it. */
function measurePart(
  part: CoveredPart,
  writingMode: WritingMode,
  inkFor: (font: string) => FontInk | undefined,
): MarkedRect[] {
  const rects = [...part.node.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return [];

  // **Only the horizontal axis gets an ink measurement.** `TextMetrics` answers about a run
  // laid out along a horizontal baseline, and there is no counterpart for the cross-axis
  // extent of vertical setting. It is not needed there either: a vertical text rectangle is
  // already tight to the glyphs — 15px across for 18.4px type, measured on 草枕 — where a
  // horizontal one carries the font's internal leading on both sides.
  const font = writingMode === "horizontal-tb" ? inkFor(part.font) : undefined;

  return rects.map((rect) => ({
    role: part.role,
    rect,
    ink:
      font === undefined
        ? rect
        : (() => {
            const { top, bottom } = inkWithin(rect, font);
            return new DOMRect(rect.left, top, rect.width, bottom - top);
          })(),
  }));
}

/** A part of a range that carries its own geometry, plus what the consumer needs to know about it. */
interface CoveredPart {
  readonly node: Range | Element;
  readonly role: RectRole;
  /** The CSS `font` shorthand it is set in, for measuring that font's ink. Empty for a replaced element. */
  readonly font: string;
}

/**
 * The parts of a range that carry their own geometry, in document order: one clamped range
 * per stretch of a text node, and each replaced element as itself.
 *
 * The walk starts at `commonAncestorContainer` rather than at the body so that measuring a
 * three-line highlight costs three lines of tree, not the whole section.
 *
 * **A text node can produce more than one part**, because a mark is not wanted on every
 * stretch of it. Chinese and Japanese books commonly open a paragraph with two ideographic
 * spaces, and those sit in the same text node as the prose after them — so a single rectangle
 * covers two cells of nothing followed by the words. Cutting at the blank boundaries lets the
 * consumer drop the blank and keep the rest (`ink.ts`).
 */
function coveredParts(range: Range): readonly CoveredPart[] {
  const parts: CoveredPart[] = [];
  collectCovered(range.commonAncestorContainer, range, parts);
  return parts;
}

function collectCovered(node: Node, range: Range, parts: CoveredPart[]): void {
  if (!range.intersectsNode(node)) return;

  if (isTextLike(node)) {
    collectText(clampedToNode(range, node), node, parts);
    return;
  }

  // A replaced element is taken whole and not descended into: an `<svg>`'s own text nodes
  // are inside the box already counted, and adding them would paint that area twice.
  if (isElement(node) && node.matches(REPLACED_ELEMENTS)) {
    parts.push({ node, role: "text", font: "" });
    return;
  }

  for (const child of node.childNodes) collectCovered(child, range, parts);
}

/** The clamped part of one text node, cut again wherever it changes between blank and prose. */
function collectText(clamped: Range, node: Node, parts: CoveredPart[]): void {
  const covered = clamped.toString();
  if (covered.length === 0) return;

  const element = node.parentElement;
  const font = element === null ? "" : fontShorthandOf(element);
  // `<rt>` is the annotation over (or beside) the base characters. It is text the reader did
  // select, but it is not the text they were reading, and marking it draws a second line
  // alongside the first.
  const role: RectRole = element?.closest("rt") != null ? "ruby" : "text";

  for (const run of blankRuns(covered)) {
    const part = clamped.cloneRange();
    part.setStart(node, clamped.startOffset + run.start);
    part.setEnd(node, clamped.startOffset + run.end);
    parts.push({ node: part, role: run.blank ? "blank" : role, font });
  }
}

/** The `font` shorthand a computed style describes, in the form `measureText` wants. */
function fontShorthand(style: CSSStyleDeclaration): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/** The same for an element. Empty where the style cannot be read at all. */
function fontShorthandOf(element: Element): string {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style === undefined ? "" : fontShorthand(style);
}

/** Implausible enough that a book landing on it exactly loses nothing but its ink measurement. */
const SENTINEL_FONT = "1px monospace";

/** The letters that reach highest, and the ones that reach lowest. */
const ASCENDERS = "bdfhklt";
const DESCENDERS = "gjpqy";

/** The part of a range that falls inside one text node. */
function clampedToNode(range: Range, node: Node): Range {
  const part = range.cloneRange();
  if (node !== range.startContainer) part.setStart(node, 0);
  if (node !== range.endContainer) part.setEnd(node, (node as CharacterData).length);
  return part;
}

/**
 * A range's first rectangle **with any area**.
 *
 * Three measured pitfalls are all blocked by this one function (the foliate patch table in
 * `docs/browser-quirks.md`):
 *
 * - A collapsed range sometimes returns no client rect at all (table 2, #7). CFI
 *   positioning produces collapsed ranges constantly, so this case is guaranteed to come up.
 * - Firefox's `getBoundingClientRect()` misses rects with zero width and non-zero height
 *   (table 1, #5; this project's probe did not hit that precondition, so the status is
 *   unknown rather than "Firefox does not have this bug").
 * - When a range's start immediately follows a hyphen in the previous column, that column
 *   gains an extra zero-width rect (table 2, #12). Taking the first one with area skips it.
 *
 * So this always goes through `getClientRects()` and filters out the ones with no area,
 * rather than using `getBoundingClientRect()`.
 */
function firstVisibleRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) return rect;
    }
  }
  return undefined;
}

/**
 * Which forms of a range to measure, in order.
 *
 * **A zero-length range is always expanded by one character before measuring, rather than
 * being asked for its own rectangles first.** This is not a performance consideration, it
 * is correctness: when a zero-length position falls on a column boundary, the browser draws
 * the caret at **the end of the previous column** rather than the start of this one (the
 * text caret's affinity — one position at a line break has two reasonable renderings). So
 * "the first character on this page" measures out on the previous page.
 *
 * The symptom is particularly hard to trace: it only happens when the position is exactly a
 * page break, and that is precisely the situation frond meets every time it reports a
 * position. It presents as "jumping back to that page with a CFI lands on the previous
 * page", and only on some pages.
 *
 * After expansion what is measured is that character's own box, leaving no room for
 * affinity. Only when it cannot be expanded (the end of a node, an empty node) does it fall
 * back to the original range.
 */
function measurable(range: Range): readonly Range[] {
  if (!range.collapsed) return [range];

  const expanded = uncollapse(range);
  return expanded === undefined ? [range] : [expanded, range];
}

/**
 * A range's last **actually drawn** rectangle. `undefined` when it is not drawn.
 *
 * The only difference from `lastVisibleRect` is the not-drawn case, and the two handlings
 * of that case serve two different problems, which is why they are two functions rather
 * than one flag:
 *
 * | | Asks | What it wants when unmeasurable |
 * | --- | --- | --- |
 * | `renderedRect` | how far the content extends (page count) | **`undefined`** — hidden content occupies no pages |
 * | `lastVisibleRect` | where this position is on screen (CFI) | an approximate position, see below |
 *
 * The cost of conflating them has actually been paid: the page count side receives an
 * all-zero rectangle, and the whole section is squashed to one page
 * (`lastPageWithContent`).
 */
function renderedRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    let found: DOMRect | undefined;
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) found = rect;
    }
    if (found !== undefined) return found;
  }

  return undefined;
}

function lastVisibleRect(range: Range): DOMRect | undefined {
  const rendered = renderedRect(range);
  if (rendered !== undefined) return rendered;

  // Not one rectangle can be measured. The whitespace-node case is already filtered out in
  // `text-index.ts`, so what is left is content such as `display: none` — fall back to the
  // element it sits in, so the position at least lands in the right region. Returning
  // `undefined` would give the binary search 0, and 0 holds on every page, so the search
  // would lose its direction.
  const element = range.startContainer.parentElement;
  return element?.getBoundingClientRect();
}

/** Expands a zero-length range to one character wide. Returns `undefined` when it cannot be expanded. */
function uncollapse(range: Range): Range | undefined {
  if (!range.collapsed) return undefined;

  const container = range.startContainer;
  const expanded = range.cloneRange();

  if (isTextLike(container)) {
    const length = container.nodeValue?.length ?? 0;
    if (range.startOffset < length) {
      expanded.setEnd(container, range.startOffset + 1);
      return expanded;
    }
    if (range.startOffset > 0) {
      expanded.setStart(container, range.startOffset - 1);
      return expanded;
    }
    return undefined;
  }

  expanded.selectNode(container);
  return expanded;
}

/** What `applyLayout` needs to know about the ink-gap requirement, out of the settled settings. */
function inkFloorFrom(settled: {
  readonly minimumInkGap: number | undefined;
  readonly lineHeight: number | undefined;
}): { readonly gap: number; readonly readerSet: boolean } | undefined {
  if (settled.minimumInkGap === undefined || settled.minimumInkGap <= 0) return undefined;
  return { gap: settled.minimumInkGap, readerSet: settled.lineHeight !== undefined };
}

/**
 * Two decimals, and **up**.
 *
 * Two because a line height is not perceived finer than that and the rule stays readable. Up
 * because this is a floor: rounding to nearest delivers a hair less than was asked for half the
 * time, which is a gap that fails its own requirement by a fraction of a pixel.
 */
function roundUp(value: number): number {
  return Math.ceil(value * 100) / 100;
}
