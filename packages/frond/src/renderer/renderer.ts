/**
 * `Renderer` — the upper half of ADR-0005's two-layer split: the layer that needs the
 * DOM.
 *
 * Its shape is "**a plain class taking a container element**" rather than a custom
 * element, for the reason given in ADR-0005: `CustomEvent.detail` is `any` in TypeScript,
 * and "not having to guess fields against an `any`" is half the reason this project
 * exists.
 *
 * ## What it answers and what it does not
 *
 * frond owns the facts, the consumer owns the policy (ADR-0002). This class answers "what
 * does this book look like in this viewport, and where are we now" — the writing mode, the
 * page count, the current position's CFI and fraction, the rectangles a range occupies. It
 * **does not consume gestures**: `next()` and `previous()` are actions rather than event
 * handlers, and the decision that "swiping left means next page" belongs to the consumer.
 * The fact that a book is `rtl` comes from
 * `EpubBook.metadata.pageProgressionDirection`, not from this layer.
 */

import { parseCfi, serializeCfi, type Cfi } from "../epub/cfi.ts";
import { resolveHref } from "../epub/resource-path.ts";
import type { RenderableBook } from "./book.ts";
import { cfiForRange, rangeForCfi, sectionIndexOf, spineSegment } from "./cfi-dom.ts";
import { buildSectionDocument, ResourceUrls, SectionParseError } from "./document-source.ts";
import {
  Emitter,
  type RangeFacts,
  type RenderLocation,
  type RendererEvents,
  type Unsubscribe,
} from "./events.ts";
import { turnPlacement, type PageBox, type TurnEdge, type WritingMode } from "./geometry.ts";
import { ProgressIndex } from "./progress.ts";
import { SectionView, type MarkedRect, type SettingsSource } from "./section-view.ts";
import {
  DEFAULT_SETTINGS,
  withSettings,
  type ReaderSettings,
  type ResolveLayout,
} from "./settings.ts";
import {
  charactersBefore,
  countCharacters,
  positionAtCharacter,
  textNodesIn,
} from "./text-index.ts";

/** Where a whole-book progress value falls in the book. The product of `locate()`. */
export interface SectionAt {
  readonly sectionIndex: number;
  /** This section's path inside the archive — the same value as `TocItem.target.path`. */
  readonly sectionPath: string;
  /** Which character, counting from the start of this section. */
  readonly charactersIntoSection: number;
}

/** Where within a section to jump to. */
export type SectionAnchor =
  | { readonly kind: "first-page" }
  | { readonly kind: "last-page" }
  | { readonly kind: "fragment"; readonly id: string }
  | { readonly kind: "cfi"; readonly cfi: Cfi }
  | { readonly kind: "characters"; readonly characters: number };

/**
 * Where in the first section to render.
 *
 * ## Why there is no `{ fraction }`
 *
 * A fraction cannot be computed without the whole-book index, and the index is built in
 * the background after `attach()` (user story 25). So `start: { fraction }` has only two
 * possible implementations, and both are worse than not offering it: wait for the index
 * before rendering the first page (the reader waits for the whole book to be scanned
 * before seeing a word), or render section 0 first and then jump (the very route this
 * field exists to avoid, saving not one mount).
 *
 * The progress a consumer stores is a CFI to begin with — that is exactly why CFI exists —
 * so `{ cfi }` is enough.
 */
export type RendererStart =
  { readonly cfi: string } | { readonly sectionIndex: number; readonly fragment?: string };

export interface RendererOptions {
  readonly settings?: Partial<ReaderSettings>;
  /**
   * Answers the margin and the column count from the facts of each layout — the writing
   * mode and the container's size (`settings.ts`'s `ResolveLayout`).
   *
   * ## Why this is not just `settings`
   *
   * The writing mode is the book's to declare and the browser's to settle, so frond has no
   * answer for it until the document is on screen. A consumer whose margin depends on it
   * (a line-length ceiling lands on the inline axis, which is horizontal in one mode and
   * vertical in the other) is therefore stuck: `attach()` wants the settings before the
   * fact exists, and the first `load` reports it after the reading position has been
   * restored — so correcting it there costs a second layout, and a second layout under a
   * restored position drops the reader somewhere else in the section.
   *
   * This closes that gap without moving the decision into frond: frond states the facts at
   * the moment it has them, the consumer answers with its policy (ADR-0002), and the
   * answer is in force for the layout that follows.
   */
  readonly resolveLayout?: ResolveLayout;
  /**
   * Listeners attached **before** the first section renders.
   *
   * By the time `attach()` returns the first section has already laid out, which means
   * that run's `load` and `relocate` were emitted inside `attach()` — attaching with
   * `on()` afterwards misses both. A consumer therefore has two options: read
   * `renderer.location` for the initial state (synchronous, readable at any time), or
   * attach listeners here and receive the complete event sequence.
   *
   * This field exists rather than deferring the initial events, because deferring would
   * put "the order events arrive in" out of step with "the order state actually changed
   * in", and that is the hardest kind of bug to trace.
   */
  readonly on?: RendererListeners;
  /**
   * Where in the first section to render. Omitted, it is the first page of section 0.
   *
   * This field exists rather than having the consumer call `goToCfi()` after `attach()`,
   * and what it saves is **one whole `SectionView` mount** — building the iframe, awaiting
   * `document.fonts.ready`, measuring the page count. Not one reflow. Restoring the
   * reading position happens every time a book is opened, so that wasted work would be
   * paid every time.
   *
   * An unresolvable CFI or an out-of-range `sectionIndex` falls back to the first page of
   * section 0 rather than throwing: a new edition of the book, or progress from a
   * different reader, both arrive here, and the response to them is not to interrupt
   * opening the book.
   */
  readonly start?: RendererStart;
  /**
   * Whether the browser may select text in the book. Omitted, it may.
   *
   * A consumer that draws its own selection turns this off and works from
   * `rangeFromPoints()` instead (ADR-0036). It has to be frond's to apply: the text is in the
   * iframe, so `user-select` on the container reaches none of it, and the same is true of the
   * callout menu iOS raises on a long press.
   *
   * **Which pointers this covers is not asked here.** Suppressing for a finger and leaving a
   * mouse alone is a policy about devices, and policy is the consumer's (ADR-0002) — it decides
   * and passes the answer.
   */
  readonly nativeSelection?: boolean;
}

export type RendererListeners = {
  readonly [Name in keyof RendererEvents]?: (event: RendererEvents[Name]) => void;
};

/** Which way a turn is going. */
export type TurnDirection = "next" | "prev";

/** How far a page sits from where it rests, in px. `{ x: 0, y: 0 }` is at rest. */
export interface PageOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * A page turn that has begun and has not been decided yet — the reader's finger is still on
 * it.
 *
 * ## Why this is frond's state and not the consumer's
 *
 * Half a turn is two pages on screen at once, and the page that is not on screen yet is not
 * anywhere the consumer can reach: it is a second document, laid out to the same settings, in
 * a frame of its own inside frond's container (frond ADR-0013). The consumer supplies the two
 * things frond must not decide — which way this drag counts as forward, and how far is far
 * enough — and nothing else.
 *
 * A turn is abandoned by anything that moves the reader some other way: a key press, a jump, a
 * settings change, a resize. `live` is how a consumer that is mid-animation finds out.
 */
export interface TurnInProgress {
  /**
   * How far the turn travels from beginning to end, in px.
   *
   * **Not the in-document `stride`.** A turn moves two documents past the container, so what
   * it crosses is the container's own extent along the axis it moves on.
   */
  readonly extent: number;
  /** There is no page on the other side: the reader is at one end of the book. */
  readonly atBoundary: boolean;
  /** The page coming in is laid out and on screen behind the current one. */
  readonly hasPreview: boolean;
  /** Still the turn in progress. False once it has been committed, cancelled, or overtaken. */
  readonly live: boolean;
  /**
   * Moves it to `distance` px along, clamped to `0..extent`, and answers where that put the
   * page the reader is on — an offset from where it rests, in the coordinates `rectsFor`
   * reports in.
   *
   * **The answer is what a consumer drawing over the page needs and cannot work out.** Which
   * axis a turn travels on and which way along it are frond's (`turnPlacement`), while anything
   * drawn on top of the page — a highlight, a note marker — belongs to the app (ADR-0002).
   * Without this the app's layer stays where the text used to be for the length of the turn,
   * and only catches up when `relocate` arrives, after it has landed.
   */
  moveTo(distance: number): PageOffset;
  /**
   * Takes the turn: the incoming page becomes the page.
   *
   * At the end of the book it does nothing. With a page there but no preview ready, it turns
   * the ordinary way — the reader gets the page they asked for, without having watched it
   * arrive.
   */
  commit(): void;
  /** Puts everything back where it was. */
  cancel(): void;
}

/** One of the two pages waiting either side of the one on screen. */
interface Peek {
  readonly view: SectionView;
  /** The page it was mounted to show. Compared against what is wanted now, to tell a usable peek from a stale one. */
  want: NeighbourPage;
}

/** Which page sits next to the current one on one side. `"last"` is only knowable once that section has laid out. */
interface NeighbourPage {
  readonly sectionIndex: number;
  readonly page: number | "last";
}

function sameNeighbour(a: NeighbourPage, b: NeighbourPage): boolean {
  return a.sectionIndex === b.sectionIndex && a.page === b.page;
}

/** A turn as the renderer holds it: everything the consumer can do, plus being ended without being asked. */
interface ActiveTurn extends TurnInProgress {
  abandon(): void;
}

/** Where a page sits when no turn is moving it. */
const AT_REST: PageOffset = { x: 0, y: 0 };

/** A placement as `SectionView.place` takes it. */
function offsetOf(at: { readonly x: number; readonly y: number }): [number, number] {
  return [at.x, at.y];
}

export class Renderer {
  readonly book: RenderableBook;

  private readonly container: HTMLElement;
  private readonly emitter = new Emitter<RendererEvents>();
  private readonly restoreContainerStyle: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;

  private currentSettings: ReaderSettings;
  private readonly resolveLayout: ResolveLayout | undefined;
  /**
   * Whether the browser may select text (`RendererOptions.nativeSelection`).
   *
   * Read wherever a document becomes selectable again, because "selectable" has two reasons to
   * be false and they nest: a turn suppresses selection for as long as the finger is down, and
   * this suppresses it for the standing arrangement. Restoring to `true` after a turn — which is
   * what the code did when a turn was the only reason — would hand native selection back to a
   * consumer that had asked for it to be gone, one page turn in.
   *
   * Not `readonly`: `setNativeSelection` moves it when the consumer learns something about the
   * device that was not knowable when the book opened.
   */
  private nativeSelection: boolean;
  private resources: ResourceUrls;
  private view: SectionView | undefined;
  private sectionIndex = 0;
  private index: ProgressIndex | undefined;
  private destroyed = false;
  /** The last position emitted, used to suppress a `relocate` that changed nothing. */
  private lastEmitted: string | undefined;
  /**
   * Which load this is. Incremented on every `loadSection` call, to recognise **the ones
   * that have gone stale**.
   *
   * It is needed because loading has to await in the middle (mounting the iframe, awaiting
   * fonts) and the consumer does not wait: while the reader drags the margin slider, the
   * `input` event fires once per step, and every step is an `applySettings`. See
   * `loadSection`.
   */
  private loadGeneration = 0;
  /**
   * The two pages waiting either side of the one on screen, laid out and hidden.
   *
   * Kept mounted rather than built when a drag starts, because the moment a drag starts is the
   * one moment they cannot be built: mounting a section means loading a document and waiting on
   * its fonts, and the reader's finger is already moving. The cost is paid where the reader is
   * doing nothing, which is while they are reading (frond ADR-0013).
   */
  private readonly peeks: { prev: Peek | undefined; next: Peek | undefined } = {
    prev: undefined,
    next: undefined,
  };
  /**
   * Which section each side already has a mount on its way for, if any.
   *
   * Separate from `peeks`, which holds only what has **landed**. A mount takes long enough
   * that a reader turning pages steadily starts several before the first one arrives, and
   * without somewhere to record that, every turn starts another. The cost is not just the
   * mount: each one builds a whole document into the container before it can be thrown
   * away. A hundred turns measured 201 frames in the container at once.
   */
  private readonly peekMounts: { prev: number | undefined; next: number | undefined } = {
    prev: undefined,
    next: undefined,
  };
  /**
   * Recognises a peek mount whose **document** has gone stale — built from settings that
   * have since been replaced (`dropPeeks`).
   *
   * **Not bumped per turn**, which is what it used to be. A mount that lands after the
   * reader has turned a few more pages is still a perfectly good document of the right
   * section, and `mountPeek` points it at wherever they have got to; calling it stale threw
   * away the one thing that makes a run of turns cost a single mount.
   */
  private peekDocumentGeneration = 0;
  private turn: ActiveTurn | undefined;
  /**
   * The chain the enqueued operations are strung onto. See `enqueue()`.
   *
   * The `catch` is deliberate: one failure should not turn every subsequent page turn into
   * a rejected promise. The failure is still passed to the caller **that initiated it**.
   */
  private chain: Promise<void> = Promise.resolve();
  /** The most recent operation for each coalesce key. Compared on enqueue, and anything that is not the latest is skipped entirely. */
  private readonly latest = new Map<string, symbol>();

  private constructor(
    book: RenderableBook,
    container: HTMLElement,
    settings: ReaderSettings,
    resolveLayout: ResolveLayout | undefined,
    nativeSelection: boolean,
  ) {
    this.book = book;
    this.container = container;
    this.currentSettings = settings;
    this.resolveLayout = resolveLayout;
    this.nativeSelection = nativeSelection;
    this.resources = new ResourceUrls(book, settings);

    // The iframe is absolutely positioned (the margin comes from the inset), so the
    // container has to be its positioning reference. It is only touched while the container
    // is still static, and the original value is recorded — `destroy()` has to restore it.
    const view = container.ownerDocument.defaultView;
    const originalPosition = container.style.position;
    const originalBackground = container.style.backgroundColor;
    const originalOverflow = container.style.overflow;

    if (view !== null && view.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    // The pages waiting either side of this one rest a whole container away, and a turn drags
    // them across it. Without this they would be drawn over whatever the consumer has put
    // beside the book.
    container.style.overflow = "hidden";
    this.applyContainerTheme();

    this.restoreContainerStyle = () => {
      container.style.position = originalPosition;
      container.style.backgroundColor = originalBackground;
      container.style.overflow = originalOverflow;
    };

    if (view !== null && typeof view.ResizeObserver === "function") {
      this.resizeObserver = new view.ResizeObserver(() => {
        // **A notification carrying the size the current section already laid out at is
        // not a resize.** `observe()` delivers one of those unconditionally, for the size
        // the container had at the time — and the section mounted right after was measured
        // against exactly that size, so laying out again would only repeat it.
        //
        // Ignoring it is not merely an economy. That notification is delivered on the
        // engine's rendering step, so *when* it arrives relative to the first section's
        // mount is a race, and acting on it makes "how many times was the resolver asked"
        // a race with it. `relayout()` is still the honest answer for a container that
        // really did change size, and for the consumer calling it outright.
        if (!this.containerResized()) return;
        void this.relayout();
      });
      this.resizeObserver.observe(container);
    }
  }

  /**
   * Mounts a book on a container element and renders the first section.
   *
   * The whole-book index is **not awaited here**: it has to read through every section,
   * and what the reader wants is the first page as soon as possible. An `indexed` event is
   * emitted once the index is ready, and until then `location.fraction` is `undefined`
   * (user story 25).
   */
  static async attach(
    book: RenderableBook,
    container: HTMLElement,
    options: RendererOptions = {},
  ): Promise<Renderer> {
    const renderer = new Renderer(
      book,
      container,
      withSettings(DEFAULT_SETTINGS, options.settings ?? {}),
      options.resolveLayout,
      options.nativeSelection ?? true,
    );

    for (const [name, listener] of Object.entries(options.on ?? {})) {
      renderer.emitter.on(
        name as keyof RendererEvents,
        listener as (event: RendererEvents[keyof RendererEvents]) => void,
      );
    }

    const start = renderer.resolveStart(options.start);
    await renderer.loadSection(start.index, start.anchor);
    void renderer.buildIndex();

    return renderer;
  }

  /**
   * Lands `options.start` on a section and an anchor. Falls back to the first page of
   * section 0 when it cannot be recognised.
   *
   * Not enqueued — the queue is empty at this moment, and `attach()` has not returned, so
   * nobody can get in front of it.
   */
  private resolveStart(start: RendererStart | undefined): {
    readonly index: number;
    readonly anchor: SectionAnchor;
  } {
    const beginning = { index: 0, anchor: { kind: "first-page" } as const };
    if (start === undefined) return beginning;

    if ("cfi" in start) {
      const parsed = tryParse(start.cfi);
      if (parsed === undefined) return beginning;

      const index = sectionIndexOf(parsed);
      if (index === undefined || index >= this.book.readingOrder.length) return beginning;

      return { index, anchor: { kind: "cfi", cfi: parsed } };
    }

    const { sectionIndex, fragment } = start;
    if (sectionIndex < 0 || sectionIndex >= this.book.readingOrder.length) return beginning;

    return {
      index: sectionIndex,
      anchor: fragment === undefined ? { kind: "first-page" } : { kind: "fragment", id: fragment },
    };
  }

  /**
   * The reader's settings, **as the consumer set them**.
   *
   * Not what the current layout ran under: with a `resolveLayout` in play the margin and
   * the column count are answered per layout, and reporting one section's answer here
   * would present a value that belongs to a moment rather than to the reader. What that
   * layout settled on is visible where it matters — the `layout` event carries the writing
   * mode and the page count, and `location` the position.
   */
  get settings(): ReaderSettings {
    return this.currentSettings;
  }

  /** The settings and the resolver as one value, which is what every layout path needs. */
  private get settingsSource(): SettingsSource {
    return { reader: this.currentSettings, resolveLayout: this.resolveLayout };
  }

  /** The writing mode the current section laid out in. **Sections of one book are not guaranteed to agree.** */
  get writingMode(): WritingMode {
    return this.view?.writingMode ?? "horizontal-tb";
  }

  get location(): RenderLocation {
    return this.describeLocation();
  }

  on<Name extends keyof RendererEvents>(
    name: Name,
    listener: (event: RendererEvents[Name]) => void,
  ): Unsubscribe {
    return this.emitter.on(name, listener);
  }

  /**
   * Turns forward one page, **continuing automatically into the next section** at the end
   * of this one (user story 28).
   *
   * At the end of the book it does nothing — it neither throws nor wraps back to the first
   * page. `location.atEnd` is the fact the consumer should be looking at.
   */
  async next(): Promise<void> {
    this.abandonTurn();
    return this.enqueue(async () => {
      const view = this.view;
      if (view === undefined) return;

      if (view.page + 1 < view.pageCount) {
        view.goToPage(view.page + 1);
        this.emitRelocate();
        this.refreshNeighbours();
        return;
      }

      if (this.sectionIndex + 1 >= this.book.readingOrder.length) return;
      await this.loadSection(this.sectionIndex + 1, { kind: "first-page" });
    });
  }

  /** Turns back one page, continuing to **the last page of the previous section** past the start of this one. */
  async previous(): Promise<void> {
    this.abandonTurn();
    return this.enqueue(async () => {
      const view = this.view;
      if (view === undefined) return;

      if (view.page > 0) {
        view.goToPage(view.page - 1);
        this.emitRelocate();
        this.refreshNeighbours();
        return;
      }

      if (this.sectionIndex === 0) return;
      await this.loadSection(this.sectionIndex - 1, { kind: "last-page" });
    });
  }

  /**
   * Begins a turn the reader drags: the page follows their finger and the next one comes in
   * behind it (user story 55, frond ADR-0013).
   *
   * **Synchronous, and not on the queue.** The finger is already moving; a turn that begins one
   * task later begins behind the gesture and never catches up.
   *
   * `from` is which edge the incoming page comes in from, and frond does not derive it: a
   * right-to-left book brings the next page in from the left, but so does an interface that
   * decided a leftward drag means forward, and choosing between those is policy (ADR-0002).
   *
   * Returns `undefined` only when there is no page on screen to turn. At the ends of the book
   * it still returns a turn, with `atBoundary` set — the rubber band a consumer draws there is
   * its own decision, and it needs something to move.
   */
  beginTurn(towards: TurnDirection, from: TurnEdge): TurnInProgress | undefined {
    const view = this.view;
    if (view === undefined || this.destroyed) return undefined;

    this.abandonTurn();

    const wanted = this.neighbourAt(towards);
    const peek = this.peeks[towards];
    const usable =
      wanted !== undefined && peek !== undefined && sameNeighbour(peek.want, wanted)
        ? peek
        : undefined;

    const turn = this.createTurn({
      towards,
      from,
      extent:
        from === "left" || from === "right"
          ? this.container.clientWidth
          : this.container.clientHeight,
      atBoundary: wanted === undefined,
      current: view,
      incoming: usable?.view,
      incomingSection: usable?.want.sectionIndex,
    });
    this.turn = turn;
    return turn;
  }

  async goToSection(index: number, anchor: SectionAnchor = { kind: "first-page" }): Promise<void> {
    if (index < 0 || index >= this.book.readingOrder.length) return;
    this.abandonTurn();
    return this.enqueue(() => this.loadSection(index, anchor));
  }

  /**
   * Jumps to the position a TOC entry points at (user story 26).
   *
   * It takes a resolved path rather than a verbatim href — `TocItem.target` gives exactly
   * this shape, and href normalization (`%2c`, `../`) is already done at the `EpubBook`
   * layer. Making Renderer resolve the href again would mean implementing the same
   * normalization a second time, and that is precisely spine's original sin (ADR-0002).
   */
  async goTo(target: {
    readonly path: string;
    readonly fragment?: string | undefined;
  }): Promise<void> {
    const index = this.book.readingOrder.findIndex((section) => section.path === target.path);
    if (index === -1) return;

    this.abandonTurn();
    return this.enqueue(() =>
      this.loadSection(
        index,
        target.fragment === undefined
          ? { kind: "first-page" }
          : { kind: "fragment", id: target.fragment },
      ),
    );
  }

  /** Jumps to a CFI (user story 20). An unrecognisable CFI does nothing. */
  async goToCfi(cfi: string | Cfi): Promise<void> {
    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return;

    const index = sectionIndexOf(parsed);
    if (index === undefined || index >= this.book.readingOrder.length) return;

    this.abandonTurn();
    return this.enqueue(() => this.loadSection(index, { kind: "cfi", cfi: parsed }));
  }

  /**
   * Jumps to a whole-book progress value (user story 24).
   *
   * Does nothing before the index is built — at that point `location.fraction` is
   * `undefined` too, and the position slider should be disabled anyway.
   */
  async goToFraction(fraction: number): Promise<void> {
    const at = this.locate(fraction);
    if (at === undefined) return;

    this.abandonTurn();
    return this.enqueue(() =>
      this.loadSection(at.sectionIndex, {
        kind: "characters",
        characters: Math.round(at.charactersIntoSection),
      }),
    );
  }

  /**
   * Which section a whole-book progress value falls in — **without jumping there** (user
   * story 23).
   *
   * While a position slider is being dragged, the chapter title at the landing point has
   * to be shown, and that is a query: the reader has not let go yet, and the screen should
   * not move. `goToFraction()` is the same query plus navigation, and both share this
   * function.
   *
   * `undefined` before the index is built — the same timing as `location.fraction`, and a
   * position slider should be disabled until then anyway.
   *
   * `sectionPath` is given alongside: a consumer maps the TOC back to sections by path
   * (`TocItem.target.path`), and giving only an index would force it to look up
   * `readingOrder` again itself.
   */
  locate(fraction: number): SectionAt | undefined {
    const index = this.index;
    if (index === undefined) return undefined;

    const { sectionIndex, charactersIntoSection } = index.locate(fraction);
    return {
      sectionIndex,
      sectionPath: this.book.readingOrder[sectionIndex]?.path ?? "",
      charactersIntoSection,
    };
  }

  /**
   * The inverse of `locate()`: where a section begins, as a whole-book fraction.
   *
   * `undefined` before the index is built, on the same timing as `locate()`.
   *
   * This is here because it is a fact only the renderer holds. A consumer drawing a position
   * axis knows which sections its chapters start at — the TOC says so — but turning that into
   * a position on the axis needs the character counts behind the index, and the alternative is
   * for the consumer to binary-search `locate()` until it lands on a boundary. A chapter-aware
   * axis (snapping a drag to the nearest chapter, drawing ticks) is the caller's policy; where
   * the chapters *are* is this layer's fact.
   */
  fractionAt(sectionIndex: number, charactersIntoSection = 0): number | undefined {
    return this.index?.fractionAt(sectionIndex, charactersIntoSection);
  }

  /**
   * Changes the reader settings while staying on the same stretch of text (user stories 19
   * and 46).
   *
   * **The whole section is rebuilt.** The reason is that the interventions themselves are
   * written into the text: removing the book's `!important` and converting absolute font
   * sizes to `rem` (`css.ts`) both happen while the document is still a string, and cannot
   * be applied to an already-parsed DOM. So changing settings necessarily means starting
   * over, and the position is carried back by a CFI — which is exactly why CFI exists, and
   * exactly the behaviour user story 19 asks for.
   */
  async applySettings(patch: Partial<ReaderSettings>): Promise<void> {
    // **The settings themselves apply synchronously; only the rebuild is enqueued.**
    // Settings are cumulative (each call changes only the fields it mentions) while a
    // rebuild is replacing (only the last one counts). Deferring both into the queue
    // together would mean the calls superseded by later ones never even get their patch
    // applied — a reader adjusting the font size and then the margin would silently lose
    // the font size.
    this.currentSettings = withSettings(this.currentSettings, patch);
    this.applyContainerTheme();
    this.abandonTurn();
    // The peeks hold documents built from the settings that have just been replaced, and the
    // interventions are written into the text itself — so there is nothing to re-apply to them.
    // They are mounted again from the far side of the rebuild.
    this.dropPeeks();

    const previousResources = this.resources;
    this.resources = new ResourceUrls(this.book, this.currentSettings);

    await this.enqueue(async () => {
      const cfi = this.currentCfi();
      await this.loadSection(
        this.sectionIndex,
        cfi === undefined ? { kind: "first-page" } : { kind: "cfi", cfi },
      );
    }, "settings");

    // The old addresses are only revoked once the new document is mounted — revoking them
    // early would leave images missing for the instant the settings change.
    previousResources.release();
  }

  /**
   * Lays out again from the facts as they stand now, staying where the reader was (user
   * story 32).
   *
   * Two occasions call for it, and they are the same operation: **the container changed
   * size** (frond's own `ResizeObserver` calls this), and **an input to `resolveLayout`
   * changed** — the reader moved a margin slider whose value the consumer turns into a
   * margin itself. The second has no other route: those settings never pass through
   * `applySettings`, so frond cannot see that anything moved.
   *
   * Unlike a settings change, this **does not rebuild the document**: the layout parameters
   * only change the injected stylesheet and the iframe's inset, and the DOM is untouched.
   * So the position is carried across with a `Range` directly, without even the CFI string
   * round trip — one fewer round trip is one fewer set of edge cases that can fail to line
   * up.
   */
  /**
   * Whether the container is a different size from the one the section on screen laid out
   * at. With no section mounted the answer is "yes" — there is nothing to compare against,
   * and `relayout()` has its own guard for that case.
   */
  private containerResized(): boolean {
    const laidOutAt = this.view?.laidOutAt;
    if (laidOutAt === undefined) return true;

    return (
      laidOutAt.width !== this.container.clientWidth ||
      laidOutAt.height !== this.container.clientHeight
    );
  }

  async relayout(): Promise<void> {
    this.abandonTurn();
    // The coalesce key is kept separate from `applySettings`: when a window drag and a font
    // size slider drag happen at once, each should keep its own last call rather than the
    // two cancelling each other.
    return this.enqueue(() => {
      const view = this.view;
      if (view === undefined || this.destroyed) return Promise.resolve();

      const anchor = view.positionAtPageStart(view.page);
      view.relayout(this.settingsSource);
      // The peeks lay out to the same container, so a container that changed size changed
      // theirs too. Left alone, the page waiting to come in is paginated to the old size and
      // the reader sees it the moment they drag.
      for (const side of ["prev", "next"] as const) {
        this.peeks[side]?.view.relayout(this.settingsSource);
      }

      if (anchor !== undefined) view.goToPage(view.pageOf(view.rangeAt(anchor)));
      this.refreshNeighbours();

      // **This is the route that used to be silent.** No document is rebuilt, so there is no
      // `load`; and staying on the same page of the same CFI means `relocate` is swallowed by
      // its own de-duplication — which is correct, the position really did not move. But every
      // rectangle did, and this is the event that says so.
      this.emitLayout(view);
      this.emitRelocate();
      return Promise.resolve();
    }, "relayout");
  }

  /**
   * The rectangles a CFI occupies on screen (user stories 49 and 51).
   *
   * frond supplies only the geometry — colour, style and animation are the consumer's
   * decision (ADR-0002).
   *
   * ## What is measured
   *
   * **The content itself**: the boxes of the text, plus any replaced element such as an
   * `<img>`. Never the box of an element containing it — a paragraph's box is the width of
   * the whole column and has nothing to do with how much of it the CFI covers. So a
   * highlight spanning paragraphs comes back as one rectangle per line, and none of them
   * overlaps another (`section-view.ts`'s `contentRects`).
   *
   * ## The coordinate system
   *
   * Relative to **the container element's top-left corner**, in CSS pixels, with the
   * reader's margin already added back (the iframe is inset within the container). That is
   * the same system `RendererPointerEvent`'s `x`/`y` are in, so a rectangle and a tap can be
   * compared directly, and an overlay positioned on the container can use these numbers
   * verbatim.
   *
   * ## Positions that are not on screen
   *
   * There are two cases and they answer differently:
   *
   * - **Not in the current section** — an empty array. Nothing is laid out, so there is no
   *   geometry to report.
   * - **In this section but not on the current page** — real rectangles **outside the
   *   container**. Pages are made by scrolling one long multi-column layout, so a position
   *   two pages ahead is simply at a large coordinate (measured: at a container width of
   *   600, a position on page 1 comes back at `x = 632`), and a position behind is negative.
   *
   * The second case is deliberate: which rectangles to draw is a clipping policy and belongs
   * to the consumer (ADR-0002), while reporting the true geometry is the fact frond owns.
   * A consumer that draws them unconditionally paints its highlight outside the page, so the
   * comparison against the container's own size is its job — `location.page` or the
   * container's bounds both serve.
   *
   * These numbers go stale on every layout pass. **`layout` is the event that says so.**
   */
  rectsFor(cfi: string | Cfi): readonly MarkedRect[] {
    const view = this.view;
    if (view === undefined) return [];

    const range = this.rangeIn(cfi);
    return range === undefined ? [] : view.rectsFor(range);
  }

  /**
   * Where the page sits inside the container, in the same coordinates as `rectsFor()`.
   *
   * This is the companion `rectsFor()` needs to be **clipped** against, and clipping against
   * the container instead is wrong in a way that only shows on a wide screen. The container
   * includes the reader's margin; the page does not. Adjacent pages are `COLUMN_GAP` apart,
   * so as soon as the margin is wider than that gap, the head of the next page falls inside
   * the container — and a consumer clipping to the container paints it in this page's margin,
   * cut off at the container's edge (Tidemarks #41).
   *
   * `undefined` when no section is mounted, which is also when `rectsFor()` has nothing to
   * report.
   *
   * **Stale on the next `layout`**, exactly as rectangles are: a margin change moves this box
   * and every rectangle in it.
   */
  pageBox(): PageBox | undefined {
    return this.view?.pageBox;
  }

  /**
   * Drops whatever is selected in the section on screen. A no-op when nothing is selected.
   *
   * ## Why a renderer needs this at all
   *
   * The selection lives in the iframe's document, which is frond's alone — a consumer holds
   * the container, and `container.ownerDocument.getSelection()` answers about the outer page,
   * not about the book. So without this the consumer has no way to undo a selection it did
   * not want, short of reaching into the iframe behind frond's back.
   *
   * And it does have selections it does not want: **phone browsers select a word on a plain
   * tap**, with no long press involved. Chrome for Android's Touch to Search does it, and the
   * selection it makes is a real one — `selectionchange` fires, and `selection` is emitted
   * with a CFI and rectangles, indistinguishable from a reader deliberately choosing a word.
   * Telling the two apart is a policy question (how long the press lasted, where it landed),
   * so the decision stays with the consumer (ADR-0002); what frond owes it is the ability to
   * act on that decision.
   *
   * Clearing raises `selectionchange`, so a `selection` event with an empty `text` follows —
   * the same event any other collapse produces.
   */
  clearSelection(): void {
    this.view?.clearSelection();
  }

  /**
   * Selects the passage a CFI names, using the browser's own selection — the other half of
   * `clearSelection()`.
   *
   * Answers whether it selected anything. `false` means the CFI does not parse, names another
   * section, or points at nothing in this one; the selection is left alone in that case rather
   * than cleared, so a caller acting on a bad address does not also destroy what the reader
   * had.
   *
   * **A `selection` event follows**, indistinguishable from one a drag produced — which is the
   * whole point: a consumer wanting the state a reader reaches by selecting text gets there by
   * the same route rather than by a second one it has to keep in step (Tidemarks #128).
   *
   * ⚠️ **It does nothing while native selection is off** (`setNativeSelection(false)`). A
   * consumer drawing its own selection on touch has `user-select: none` on the document, and
   * a range added under it is dropped by the browser without complaint. That consumer wants
   * `rangeFactsFor()` instead — the geometry, to draw itself. Which of the two routes is live
   * is the consumer's own answer (ADR-0002), so this cannot pick for it, and reporting `true`
   * for a selection the browser then discarded is the one thing it must not do — hence the
   * warning here rather than a `false` that would mean something else.
   */
  selectRange(cfi: string | Cfi): boolean {
    const view = this.view;
    if (view === undefined) return false;

    const range = this.rangeIn(cfi);
    if (range === undefined) return false;

    view.select(range);
    return true;
  }

  /**
   * The same three facts `rangeFromPoints()` answers with, for a passage named by a CFI rather
   * than by two points on screen.
   *
   * This is the CFI-shaped door into the take-over-selection route (ADR-0036): that route never
   * touches the browser's selection, so it needs the geometry handed to it, and until now the
   * only way in was two screen coordinates — which a caller holding an address does not have
   * and would have to fake by inventing a drag.
   *
   * `undefined` on an unparseable CFI, one naming another section, or one pointing at nothing
   * here. `rects` and `cfi` go stale on the next `layout`, exactly as `rangeFromPoints()`'s do.
   */
  rangeFactsFor(cfi: string | Cfi): RangeFacts | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const range = this.rangeIn(cfi);
    if (range === undefined) return undefined;

    return {
      cfi: serializeCfi(cfiForRange(range, this.sectionIndex)),
      text: range.toString(),
      rects: view.rectsFor(range).map((marked) => marked.rect),
    };
  }

  /**
   * Where a phrase sits in the section on screen, as a CFI. `undefined` when it is not there.
   *
   * Only this section, not the whole book: searching the rest would mean laying out sections
   * the reader is not looking at, and a caller that knows which passage it wants also knows
   * which chapter it is in. The match runs across element boundaries — see `findText` in
   * `section-view.ts` for what that covers and the one case it does not.
   *
   * The CFI is the currency the rest of this class already speaks, so what comes back can be
   * handed straight to `selectRange()`, `rangeFactsFor()` or `rectsFor()`.
   */
  findText(text: string): string | undefined {
    const range = this.view?.findText(text);
    return range === undefined ? undefined : serializeCfi(cfiForRange(range, this.sectionIndex));
  }

  /**
   * The `Range` a CFI names within the section on screen, for the two callers above.
   *
   * The section check is what keeps a CFI from elsewhere in the book from being answered with
   * a range built out of whatever node the walk happened to land on — the same guard
   * `rectsFor()` makes, for the same reason.
   */
  private rangeIn(cfi: string | Cfi): Range | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return undefined;
    if (sectionIndexOf(parsed) !== this.sectionIndex) return undefined;

    return rangeForCfi(view.document, parsed);
  }

  /**
   * Changes whether the browser may select text, on a book that is already open
   * (`RendererOptions.nativeSelection`, which is where the same answer is given at the start).
   *
   * **Why it can be answered more than once.** At the start there is nothing to go on but a
   * media query, and a machine with both a touchscreen and a mouse answers that query as a
   * phone — it reports no fine pointer at all, so no query distinguishes the two. What does
   * distinguish them is the pointer events themselves, and those arrive only once the book is
   * open. Which fact the consumer trusts, and what it makes of it, is still the consumer's
   * (ADR-0002); what frond owes it is the ability to act on an answer that has changed.
   *
   * **The peeks are moved too, and a live turn is no reason to skip them.** A peek becomes the
   * page on screen without being mounted again (`takeTurn`), and `refreshNeighbours` keeps one
   * that already points at the right section rather than rebuilding it — so a peek left on the
   * old answer carries it back one page turn later. Nothing downstream catches that: `settle`
   * and `takeTurn` put this value back on the frame that **was** the page, and the peek arriving
   * to replace it is never touched there. Which is exactly why it has to be right before the
   * turn starts.
   *
   * Documents mounted after this read the new value where they are built.
   *
   * Only the page on screen waits, and only while a turn is moving it: a turn suppresses
   * selection for as long as the finger is down whatever this says, and it is that frame the
   * turn puts back when it settles.
   */
  setNativeSelection(allowed: boolean): void {
    if (this.destroyed || allowed === this.nativeSelection) return;
    this.nativeSelection = allowed;
    for (const view of [this.peeks.prev?.view, this.peeks.next?.view]) {
      view?.suppressSelection(!allowed);
    }
    if (this.turn?.live !== true) this.view?.suppressSelection(!allowed);
  }

  /**
   * The range between two container points, for a consumer that has taken over touch selection
   * (ADR-0036, issue #50). This is the one fact only frond can compute for that consumer: what
   * text sits between two places on screen, and where it is — the content lives in the iframe,
   * out of the consumer's reach.
   *
   * `null` when either point is off the text. Both points are taken against the section on
   * screen, so a selection does not cross the page boundary; cross-page selection is
   * deliberately out for now (ADR-0036), which is what lets this stay a single-section query.
   *
   * Unlike `emitSelection`, nothing native is involved — the consumer supplies the two points
   * and frond answers with geometry, so the document's `user-select` can be off entirely. The
   * `rects` and `cfi` go stale on the next `layout`, exactly as a `SelectionEvent`'s do.
   */
  rangeFromPoints(
    anchor: { readonly x: number; readonly y: number },
    focus: { readonly x: number; readonly y: number },
    granularity: "word" | "char",
  ): RangeFacts | null {
    const view = this.view;
    if (view === undefined) return null;

    const range = view.rangeFromPoints(anchor, focus, granularity);
    if (range === undefined) return null;

    return {
      cfi: serializeCfi(cfiForRange(range, this.sectionIndex)),
      text: range.toString(),
      rects: view.rectsFor(range).map((marked) => marked.rect),
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.abandonTurn();
    this.resizeObserver?.disconnect();
    this.view?.destroy();
    this.view = undefined;
    this.dropPeeks();
    this.resources.release();
    this.restoreContainerStyle();
    this.emitter.clear();
  }

  // --- turns in progress ----------------------------------------------------

  /**
   * The live turn, as an object over this renderer's state.
   *
   * Written as a closure rather than a class because it needs the renderer's own internals —
   * the views, the peeks, the section index — and a class beside this one could only reach them
   * by widening them for everybody.
   */
  private createTurn(spec: {
    readonly towards: TurnDirection;
    readonly from: TurnEdge;
    readonly extent: number;
    readonly atBoundary: boolean;
    readonly current: SectionView;
    readonly incoming: SectionView | undefined;
    readonly incomingSection: number | undefined;
  }): ActiveTurn {
    let live = true;
    const { current, incoming } = spec;

    current.suppressSelection(true);
    // Both frames are about to be moved every frame the finger moves, so both go onto layers of
    // their own for the duration — see `SectionView.promote` for what that saves and why it is
    // not left standing between turns.
    current.promote(true);
    incoming?.promote(true);
    incoming?.reveal();
    incoming?.place(...offsetOf(turnPlacement(spec.from, 0, spec.extent).incoming));

    // Everything that ends a turn passes through here: the frames go back to resting, the
    // document is selectable again, and the peeks are re-pointed at wherever the reader ended
    // up. Only committing a previewed turn skips it, because there the frames do not go back —
    // they change roles (`takeTurn`).
    const settle = (): void => {
      live = false;
      if (this.turn === turn) this.turn = undefined;
      current.suppressSelection(!this.nativeSelection);
      current.promote(false);
      incoming?.promote(false);
      current.place(0, 0);
      incoming?.place(0, 0);
      incoming?.conceal();
      this.refreshNeighbours();
    };

    const turn: ActiveTurn = {
      extent: spec.extent,
      atBoundary: spec.atBoundary,
      hasPreview: incoming !== undefined,
      get live() {
        return live;
      },
      moveTo: (distance) => {
        // A turn that is already over leaves the frames alone, and says so: the frames are back
        // at rest, so that is where a consumer's own layer belongs too.
        if (!live) return AT_REST;
        const at = turnPlacement(spec.from, distance, spec.extent);
        current.place(...offsetOf(at.current));
        incoming?.place(...offsetOf(at.incoming));
        return at.current;
      },
      commit: () => {
        if (!live) return;
        if (incoming !== undefined && spec.incomingSection !== undefined) {
          live = false;
          if (this.turn === turn) this.turn = undefined;
          this.takeTurn(spec.towards, incoming, spec.incomingSection);
          return;
        }
        settle();
        // No preview to swap in, but the page it would have shown does exist: the reader asked
        // for it, so they get it the ordinary way rather than nothing at all. This is the window
        // right after a book opens or its settings change, before the peeks have caught up.
        if (!spec.atBoundary) void (spec.towards === "next" ? this.next() : this.previous());
      },
      cancel: settle,
      abandon: settle,
    };

    return turn;
  }

  /** Ends whatever turn is in progress. Everything that moves the reader some other way calls it. */
  private abandonTurn(): void {
    this.turn?.abandon();
  }

  /**
   * Finishes a previewed turn by **changing which frame is which**.
   *
   * Nothing is mounted here and nothing moves: the incoming frame is already laid out, already
   * on the page the reader dragged into view, and already sitting exactly where the current one
   * rests. What is left is bookkeeping — and the frame that has just left the screen becomes the
   * peek on the other side, which is the page the reader would go back to.
   */
  private takeTurn(towards: TurnDirection, incoming: SectionView, section: number): void {
    const outgoing = this.view;
    if (outgoing === undefined) return;

    // Asked before anything moves, because `conceal()` below takes the focus off a frame it
    // hides — by then the answer is gone.
    const focused = outgoing.holdsFocus();
    const behind = towards === "next" ? "prev" : "next";
    const crossed = section !== this.sectionIndex;
    const previousSection = this.sectionIndex;

    // The turn is over, so the layers it needed come down — on both frames, including the one
    // that is staying on screen. Leaving them up is what breaks WebKit's hit-testing
    // (`SectionView.promote`).
    outgoing.suppressSelection(!this.nativeSelection);
    outgoing.promote(false);
    incoming.promote(false);
    outgoing.place(0, 0);
    outgoing.conceal();
    outgoing.setCurrent(false);
    incoming.place(0, 0);
    incoming.setCurrent(true);

    // **The focus follows the page.** A frame keeps its focus when it stops being the page, and
    // a reader who has touched the book at all has put the focus there — so without this, every
    // key they press after the first turn is delivered to the frame behind them. Nothing else
    // moves it back: the outer document hears nothing while focus is inside any frame, and the
    // frame holding it is still mounted, so it is not the browser's to reassign either.
    if (focused) incoming.takeFocus();

    // The peek that was behind the reader has nothing to show any more — the page it holds is
    // now two back — but it is a laid-out frame of a section that is very likely still wanted,
    // one page further on. Handing it to the other side lets `refreshNeighbours` re-point it by
    // scrolling instead of mounting a third document on every page turn.
    const displaced = this.peeks[behind];
    this.peeks[towards] = displaced;
    this.peeks[behind] = {
      view: outgoing,
      want: { sectionIndex: previousSection, page: outgoing.page },
    };
    this.view = incoming;
    this.sectionIndex = section;

    if (crossed) {
      this.emitter.emit("load", {
        sectionIndex: section,
        sectionPath: this.book.readingOrder[section]?.path ?? "",
        writingMode: incoming.writingMode,
      });
      this.emitLayout(incoming);
    }
    this.emitRelocate();
    this.refreshNeighbours();
  }

  // --- the pages either side ------------------------------------------------

  /** Which page sits on one side of the current one, or `undefined` at the ends of the book. */
  private neighbourAt(towards: TurnDirection): NeighbourPage | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    if (towards === "next") {
      if (view.page + 1 < view.pageCount) {
        return { sectionIndex: this.sectionIndex, page: view.page + 1 };
      }
      if (this.sectionIndex + 1 >= this.book.readingOrder.length) return undefined;
      return { sectionIndex: this.sectionIndex + 1, page: 0 };
    }

    if (view.page > 0) return { sectionIndex: this.sectionIndex, page: view.page - 1 };
    if (this.sectionIndex === 0) return undefined;
    return { sectionIndex: this.sectionIndex - 1, page: "last" };
  }

  /**
   * Points both peeks at the pages either side of where the reader is now.
   *
   * **The cheap half is synchronous.** Both neighbours are usually pages of the section already
   * on screen, and a peek showing that section only has to be scrolled — so a reader turning
   * pages one after another never waits for a mount, and the drag they start immediately after
   * a page turn has its preview ready.
   *
   * `rebuilt` says the documents themselves are out of date (a settings change rewrites them),
   * so a peek showing the right section is still the wrong document and has to be mounted again.
   */
  private refreshNeighbours(): void {
    if (this.destroyed || this.view === undefined) return;
    // Not while the reader is dragging one of them across the screen.
    if (this.turn !== undefined) return;

    for (const side of ["prev", "next"] as const) {
      const wanted = this.neighbourAt(side);
      const peek = this.peeks[side];

      if (wanted === undefined) {
        peek?.view.destroy();
        this.peeks[side] = undefined;
        continue;
      }

      if (peek !== undefined && peek.want.sectionIndex === wanted.sectionIndex) {
        peek.view.goToPage(wanted.page === "last" ? peek.view.pageCount - 1 : wanted.page);
        peek.want = wanted;
        continue;
      }

      // Whatever stands here is of a section this side no longer wants — the same section is
      // handled above — so it goes now rather than lingering behind whatever comes next.
      peek?.view.destroy();
      this.peeks[side] = undefined;

      // A mount for this side is already on its way. A second one would not make the preview
      // arrive any sooner — whichever mount lands re-reads where the reader is by then, and
      // asks again if the answer has changed (`mountPeek`) — so one mount serves a whole run
      // of turns rather than one being started, and discarded, per turn.
      //
      // **One a side, not one per section wanted.** A mount is a frame in the container from
      // the moment it starts (`SectionView.mount` appends the frame and then waits for it to
      // load), so letting a reader crossing section after section start a second one while the
      // first is still building puts no ceiling on how many documents are in the container at
      // once — it is bounded only by how fast they cross against how slowly a section mounts.
      // With the peek above already gone, a side is one frame at most: a peek, or a mount.
      if (this.peekMounts[side] !== undefined) continue;

      this.peekMounts[side] = wanted.sectionIndex;
      void this.mountPeek(side, wanted.sectionIndex, this.peekDocumentGeneration);
    }
  }

  /**
   * Tears both peeks down. A settings change does this, because their documents are the old ones.
   *
   * The generation carries that same message to the mounts still on their way: they are
   * building documents from the settings being replaced, so whichever of them lands after
   * this has to be discarded rather than shown. This is the **only** thing that ages a peek
   * document out — see `peekDocumentGeneration`.
   */
  private dropPeeks(): void {
    this.peekDocumentGeneration += 1;
    for (const side of ["prev", "next"] as const) {
      this.peeks[side]?.view.destroy();
      this.peeks[side] = undefined;
      this.peekMounts[side] = undefined;
    }
  }

  private async mountPeek(
    side: TurnDirection,
    sectionIndex: number,
    generation: number,
  ): Promise<void> {
    // The two ways out below leave this side with no peek and **do not ask again**, unlike the
    // staleness check further down. That is deliberate: asking again would mount the very
    // section that has just failed, and a side is only allowed one mount at a time — so the
    // failure would come straight back, as fast as the machine can build a document. The side
    // is not stuck, only empty: `peekMounts[side]` is cleared on both paths, so the reader's
    // next move mounts a peek again.
    const section = this.book.readingOrder[sectionIndex];
    if (section === undefined) {
      this.peekMounts[side] = undefined;
      return;
    }

    let view: SectionView;
    try {
      view = await this.mountSection(section.path);
    } catch {
      // A section that will not mount is reported when the reader actually goes there
      // (`loadSection`). Saying it twice, from a page they have not asked for yet, would put an
      // error on screen over a page that is perfectly readable.
      this.peekMounts[side] = undefined;
      return;
    }

    if (this.peekMounts[side] === sectionIndex) this.peekMounts[side] = undefined;

    // Where the reader is **now**, rather than where they were when this mount was asked
    // for. Turning a page is far quicker than mounting a document, so by the time one lands
    // the reader has usually moved on — and re-asking is exactly what lets a single mount
    // serve a whole run of turns. A section change or a settings change still discards it:
    // the first makes it the wrong section, the second the wrong document.
    const wanted = this.neighbourAt(side);

    if (
      this.destroyed ||
      wanted === undefined ||
      wanted.sectionIndex !== sectionIndex ||
      generation !== this.peekDocumentGeneration
    ) {
      view.destroy();
      // Asking again is what makes "one mount a side" safe: while this one was building, the
      // side was refused a mount of the section it moved on to, so nothing else would ever
      // mount it. `peekMounts[side]` was cleared just above, so this side is free again.
      if (!this.destroyed) this.refreshNeighbours();
      return;
    }

    // Pointed at its page **before** it is marked as a peek: the mark is what says the preview
    // is ready, and a frame that is mounted but still showing page 0 is not.
    view.goToPage(wanted.page === "last" ? view.pageCount - 1 : wanted.page);
    view.setCurrent(false);
    this.peeks[side]?.view.destroy();
    this.peeks[side] = { view, want: wanted };
  }

  // --- internals ------------------------------------------------------------

  /**
   * Puts an operation onto the sequence.
   *
   * ## Why there is a queue
   *
   * Cross-section operations await in the middle (mounting the iframe, awaiting fonts) and
   * the consumer does not wait. On two rapid "next page" presses at the end of a section,
   * the second one sees a `this.view` that is still the old one with `page` still on the
   * last page, and so loads **the same section** again — `loadGeneration` makes the first
   * clean itself up, and the net result is that two inputs advance one section. Swipe
   * paging is far faster than key presses, so this case is the norm once pointer events are
   * wired in.
   *
   * Once on the sequence, every operation **reads `this.view` when its turn comes**, sees
   * the latest state, and "N presses advance N pages" holds.
   *
   * ## Why there are two enqueue semantics
   *
   * | | Which | Rule |
   * | --- | --- | --- |
   * | Cumulative (no `coalesceKey`) | page turns and jumps | every one should take effect |
   * | Replacing (with `coalesceKey`) | `applySettings`, `resize` | only the last one counts |
   *
   * Making everything cumulative is wrong: while the reader drags the margin slider,
   * `input` fires an `applySettings` per step, and running every step serially multiplies
   * the total latency by N and freezes the slider. ResizeObserver is worse still — one
   * window drag fires dozens. What those two want is "only the last one counts", and that
   * is what `coalesceKey` expresses.
   *
   * The superseded calls **still resolve** (rather than rejecting): what the caller wants is
   * "this setting took effect", and after coalescing, the latest one taking effect means
   * their intent was achieved.
   *
   * `loadGeneration` is not superseded by this — it guards a third thing: a load that lands
   * after `destroy()`.
   */
  private enqueue(work: () => Promise<void>, coalesceKey?: string): Promise<void> {
    let token: symbol | undefined;
    if (coalesceKey !== undefined) {
      token = Symbol(coalesceKey);
      this.latest.set(coalesceKey, token);
    }

    const run = this.chain.then(async () => {
      if (this.destroyed) return;
      if (coalesceKey !== undefined && this.latest.get(coalesceKey) !== token) return;
      await work();
    });

    this.chain = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  /**
   * The reader's background colour has to be painted on the container too, not only inside
   * the document.
   *
   * The margin is made by insetting the iframe within the container (`section-view.ts`), so
   * that band is **not inside the document** — painting only the document would leave a ring
   * of the consuming page's background around the text in dark mode. Measured, it is a white
   * frame (`docs/evidence/32/`).
   *
   * With no theme the container is left alone: at that point the consumer's own background
   * is the right answer.
   */
  private applyContainerTheme(): void {
    const theme = this.currentSettings.theme;
    this.container.style.backgroundColor = theme === undefined ? "" : theme.background;
  }

  /**
   * Mounts a section and tears down the previous one.
   *
   * ## What has to be torn down is "the one on screen now", not "the one I saw when I started"
   *
   * There are awaits in the middle (mounting the iframe, awaiting `document.fonts.ready`),
   * and **the consumer does not wait**: while the reader drags the margin slider, `input`
   * fires once per step, and every step is an `applySettings`, hence a `loadSection`. So
   * several loads are in flight at once.
   *
   * Recording `this.view` as "the one to tear down" **before** the await would record the
   * same old view in all of them: the first to complete writes back to `this.view`, a later
   * one overwrites it, and the one that was overwritten **is torn down by nobody** — its
   * iframe is still attached to the container. The iframes are absolutely positioned with
   * transparent backgrounds, so the leftovers show around the edges of the current one, and
   * the reader sees "other content from the book stacked underneath while dragging the
   * margin". Measured, six steps of dragging leave six iframes in the container.
   *
   * So: read `this.view` only after the await, and first confirm this is still the latest
   * load — if it is not, tear down what was just mounted and leave, letting the winner take
   * over.
   */
  private async loadSection(index: number, anchor: SectionAnchor): Promise<void> {
    if (this.destroyed) return;

    const section = this.book.readingOrder[index];
    if (section === undefined) return;

    const generation = (this.loadGeneration += 1);
    let view: SectionView;

    try {
      view = await this.mountSection(section.path);
    } catch (error) {
      this.emitter.emit("error", {
        sectionIndex: index,
        sectionPath: section.path,
        reason:
          error instanceof SectionParseError ? "malformed-content-document" : "unreadable-section",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // A stale load cleans itself up: either `destroy()` has already run, or another load has
    // come along since.
    if (this.destroyed || generation !== this.loadGeneration) {
      view.destroy();
      return;
    }

    this.view?.destroy();
    this.view = view;
    this.sectionIndex = index;
    view.setCurrent(true);

    this.emitter.emit("load", {
      sectionIndex: index,
      sectionPath: section.path,
      writingMode: view.writingMode,
    });

    this.applyAnchor(view, anchor);
    // The frame has been hidden since it was created, and this is the first moment its
    // content is the content the reader asked for: paginated, and on the right page. See
    // `SectionView.reveal()` for what is on screen when this is skipped.
    //
    // Nothing between mounting and here yields, so the old frame's teardown above and this
    // reveal fall in the same task — the container is never left with nothing painted in it.
    view.reveal();
    // After the anchor, not before: the page the anchor lands on decides what is scrolled
    // into view, and therefore what `rectsFor()` answers. A consumer recomputing its
    // highlight layer on this event would otherwise measure the geometry of page 0.
    this.emitLayout(view);
    this.emitRelocate();
    this.refreshNeighbours();
  }

  /**
   * One section mounted into the container, with its events wired to this renderer.
   *
   * Shared by the page the reader is on and by the two waiting either side of it, and that is
   * the point: a peek is not a lesser kind of view. When a turn is taken it becomes the page
   * without being rebuilt, so anything the page can do it has to have been able to do all along.
   *
   * **The pointer and selection events are guarded by which frame is the page**, since all three
   * are live documents: a selection changing in the frame behind the reader is not a selection
   * the consumer should hear about. `holder` is filled in after the mount and read on every
   * event, so the guard follows the frame through the role change rather than being decided at
   * mount time.
   *
   * **Keys are not guarded**, and that is the one asymmetry here. A pointer event names the frame
   * it happened over, so a peek receiving one means the reader is pointing at the wrong thing; a
   * key event has no place at all, only a focus — and there is exactly one focus for the three
   * frames, so whichever of them receives a key is the one the reader is typing into. Dropping
   * it would leave the press unanswered by anybody: the outer document hears nothing while focus
   * is inside a frame.
   */
  private async mountSection(path: string): Promise<SectionView> {
    const holder: { view: SectionView | undefined } = { view: undefined };
    const current = (): boolean => holder.view !== undefined && holder.view === this.view;

    const view = await SectionView.mount(
      this.container,
      buildSectionDocument(this.book, path, this.currentSettings, this.resources),
      this.settingsSource,
      {
        onLinkActivate: (href) => {
          if (current()) this.emitLinkActivate(href);
        },
        onSelectionChange: () => {
          if (current()) this.emitSelection();
        },
        onPointerDown: (event) => {
          if (current()) this.emitter.emit("pointerdown", event);
        },
        onPointerMove: (event) => {
          if (current()) this.emitter.emit("pointermove", event);
        },
        onPointerUp: (event) => {
          if (current()) this.emitter.emit("pointerup", event);
        },
        onPointerCancel: (event) => {
          if (current()) this.emitter.emit("pointercancel", event);
        },
        onKey: (kind, event) => {
          this.emitter.emit(kind, event);
        },
      },
      path,
    );

    holder.view = view;
    // Applied to **every** document frond mounts, not only the one on screen, because a peek
    // becomes the page on screen without being mounted again (`takeTurn`). Setting it where the
    // frame is built is the only place that covers both without a list of the moments a frame
    // changes role.
    view.suppressSelection(!this.nativeSelection);
    return view;
  }

  private applyAnchor(view: SectionView, anchor: SectionAnchor): void {
    switch (anchor.kind) {
      case "first-page":
        view.goToPage(0);
        return;

      case "last-page":
        view.goToPage(view.pageCount - 1);
        return;

      case "fragment": {
        const target = view.elementById(anchor.id);
        // An anchor that points at nothing stops at the start of this section. A TOC
        // pointing at a non-existent id is a shape real books have, and turning it into an
        // error would break tapping the table of contents entirely.
        view.goToPage(target === null ? 0 : view.pageOf(view.rangeOfNode(target)));
        return;
      }

      case "cfi": {
        const range = rangeForCfi(view.document, anchor.cfi);
        // If it will not walk, stop at the start of this section. A new edition of the
        // book, or a CFI from a different reader, both arrive here, and the response to
        // them is not to throw and interrupt the reading flow.
        view.goToPage(range === undefined ? 0 : view.pageOf(range));
        return;
      }

      case "characters": {
        const position = positionAtCharacter(textNodesIn(view.document), anchor.characters);
        view.goToPage(position === undefined ? 0 : view.pageOf(view.rangeAt(position)));
        return;
      }
    }
  }

  /**
   * The whole-book index: read every section once and count characters.
   *
   * Done one section at a time, yielding the thread in between — parsing a 300-section book
   * in one go would freeze the first page, and the first page is already on screen with the
   * reader reading it.
   */
  private async buildIndex(): Promise<void> {
    const counts: number[] = [];
    const parser = new DOMParser();
    const decoder = new TextDecoder();

    for (const section of this.book.readingOrder) {
      if (this.destroyed) return;

      let characters = 0;
      try {
        const parsed = parser.parseFromString(
          decoder.decode(this.book.bytes(section.path)),
          "application/xhtml+xml",
        );
        // A section that will not parse counts as 0 characters. It will be an error event on
        // screen too, and letting one broken section keep the whole index from being built
        // would cost the position slider for the entire book.
        characters = parsed.querySelector("parsererror") === null ? countCharacters(parsed) : 0;
      } catch {
        characters = 0;
      }

      counts.push(characters);
      await yieldToBrowser();
    }

    if (this.destroyed) return;

    this.index = ProgressIndex.of(counts);
    this.emitter.emit("indexed", { characters: this.index.characters });
    this.emitRelocate();
  }

  private currentCfi(): Cfi | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) {
      // A section with not a single character (all images). A CFI pointing at the whole
      // section is still a valid position.
      return { kind: "point", path: [spineSegment(this.sectionIndex)] };
    }

    return cfiForRange(view.rangeAt(position), this.sectionIndex);
  }

  /**
   * The stretch of this section that the current page shows.
   *
   * The end boundary is **the start of the next page**, which is the first character the
   * reader cannot see. Asking for a page past the last one lands at the end of the section
   * (`positionAtPageStart`), so the final page needs no special case.
   *
   * Only the renderer can answer this: a page is a product of layout, and its extent moves
   * with the viewport and the type size. Nothing downstream can recompute it, which is why it
   * is emitted while the page is on screen rather than offered as a question to ask later.
   */
  private currentPageRange(): Cfi | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const start = view.positionAtPageStart(view.page);
    const end = view.positionAtPageStart(view.page + 1);
    // A section with not a single character. `currentCfi` still gives a point at the whole
    // section, but a range has no two positions to be built from.
    if (start === undefined || end === undefined) return undefined;

    // The two coincide when **this page** holds no characters, even though the section does —
    // a full-page image between two pages of prose. `cfiForRange` would serialize that as a
    // point, and a consumer reading this field would have no way to tell it apart from a
    // range: it would ask for "the text on this page" and be handed the whole rest of the
    // section, or nothing, depending on how it read the point.
    if (start.node === end.node && start.offset === end.offset) return undefined;

    return cfiForRange(view.rangeBetween(start, end), this.sectionIndex);
  }

  private describeLocation(): RenderLocation {
    const view = this.view;
    const section = this.book.readingOrder[this.sectionIndex];
    const cfi = this.currentCfi();
    const pageRange = this.currentPageRange();

    return {
      sectionIndex: this.sectionIndex,
      sectionPath: section?.path ?? "",
      page: view?.page ?? 0,
      pageCount: view?.pageCount ?? 1,
      cfi: cfi === undefined ? "" : serializeCfi(cfi),
      pageRange: pageRange === undefined ? undefined : serializeCfi(pageRange),
      fraction: this.currentFraction(),
      atStart: this.sectionIndex === 0 && (view?.page ?? 0) === 0,
      atEnd:
        this.sectionIndex === this.book.readingOrder.length - 1 &&
        (view?.page ?? 0) === (view?.pageCount ?? 1) - 1,
    };
  }

  private currentFraction(): number | undefined {
    const index = this.index;
    const view = this.view;
    if (index === undefined || view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) return index.fractionAt(this.sectionIndex, 0);

    return index.fractionAt(
      this.sectionIndex,
      charactersBefore(textNodesIn(view.document), position.node, position.offset),
    );
  }

  /**
   * "The geometry is valid again, recompute."
   *
   * **Deliberately not de-duplicated**, unlike `relocate`. The two guard different things:
   * `relocate` is a position, and repeating an unchanged position makes a consumer believe
   * the reader moved; `layout` is an invalidation, and a layout pass that happens to produce
   * the same page count still moved every rectangle. Suppressing it on "nothing looks
   * different" would silently drop exactly the case this event exists for — `applySettings({
   * margin })` on page 0 keeps the page count and moves every rectangle by the margin's
   * difference.
   */
  private emitLayout(view: SectionView): void {
    this.emitter.emit("layout", {
      writingMode: view.writingMode,
      pageCount: view.pageCount,
    });
  }

  private emitRelocate(): void {
    const location = this.describeLocation();

    // The same position is not emitted twice. Pressing "next page" again at the end of the
    // book changes nothing, and a duplicate relocate would make the consumer think the
    // position moved (syncing progress to the cloud, say).
    //
    // **The signature has to include the CFI.** Without it, a reflow that leaves the page
    // number unchanged while the position really did change (a different viewport fitting
    // different content on the same page) would be swallowed as unchanged — and that is
    // exactly the event the consumer most needs to receive: what gets stored as progress is
    // the CFI, not the page number.
    const signature = [
      location.sectionIndex,
      location.page,
      location.fraction ?? "",
      location.cfi,
    ].join(":");
    if (signature === this.lastEmitted) return;
    this.lastEmitted = signature;

    this.emitter.emit("relocate", location);
  }

  private emitLinkActivate(href: string): void {
    const section = this.book.readingOrder[this.sectionIndex];
    const resolved = resolveHref(href, section?.path ?? "");

    if (resolved.kind === "remote") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: resolved.url,
      });
      return;
    }

    if (resolved.kind === "outside-container") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: undefined,
      });
      return;
    }

    const index = this.book.readingOrder.findIndex((candidate) => candidate.path === resolved.path);

    this.emitter.emit("linkactivate", {
      href,
      sectionIndex: index === -1 ? undefined : index,
      fragment: resolved.fragment,
      externalUrl: undefined,
    });
  }

  private emitSelection(): void {
    const view = this.view;
    if (view === undefined) return;

    const range = view.selection();
    if (range === undefined) {
      this.emitter.emit("selection", { cfi: undefined, text: "", rects: [] });
      return;
    }

    this.emitter.emit("selection", {
      cfi: serializeCfi(cfiForRange(range, this.sectionIndex)),
      text: range.toString(),
      // Measured from the live `Range` rather than from the CFI just serialized: the two
      // answer the same question, and this one has not been through a round trip.
      //
      // Plain rectangles, unlike `rectsFor`: this event feeds the position of a toolbar, and
      // what a stretch of the selection covers has no bearing on where that toolbar goes.
      rects: view.rectsFor(range).map((marked) => marked.rect),
    });
  }
}

function tryParse(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

/**
 * Yields the thread once, letting the browser paint and handle input before we
 * parse the next section.
 *
 * Not `setTimeout(resolve, 0)`: HTML clamps timers nested more than five deep to
 * a 4ms minimum, and indexing is one long chain of them. On a 182-section book
 * that clamp alone costs 700-1300ms while the actual counting takes 21ms. A
 * `MessageChannel` message is also a fresh task, but carries no such floor, and
 * all three engines have it. (`scheduler.yield()` fits better but is
 * Chromium-only; see frond ADR-0004.)
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
