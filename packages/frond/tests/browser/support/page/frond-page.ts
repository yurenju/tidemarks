import { parseCfi, serializeCfi } from "../../../../src/epub/cfi.ts";
import { cfiForRange, rangeForCfi } from "../../../../src/renderer/cfi-dom.ts";
import {
  CURRENT_FRAME_ATTRIBUTE,
  MemoryBook,
  PEEK_FRAME_ATTRIBUTE,
  Renderer,
  type ReaderSettings,
  type RenderableBook,
  type TurnInProgress,
} from "../../../../src/renderer/index.ts";
import { LAYOUT_STYLE_ID, READER_STYLE_ID } from "../../../../src/renderer/layout.ts";
import {
  charactersBefore,
  positionAtCharacter,
  textNodesIn,
} from "../../../../src/renderer/text-index.ts";
import type {
  AddressedSection,
  EventRecord,
  FrameSnapshot,
  FrondHarness,
  LayoutCall,
  MountOptions,
  MarkedRectSnapshot,
  Rect,
  SectionAtSnapshot,
  SettingsPatch,
  Snapshot,
  TurnSnapshot,
} from "../harness.ts";

/**
 * The browser side's operating surface.
 *
 * It runs inside the page, so it can see `Renderer`'s actual objects; the spec side only
 * gets serializable snapshots. That division is deliberate — sending a `Renderer`
 * instance across `page.evaluate`'s boundary is impossible, and letting each spec write
 * its own `page.evaluate` to poke at it would scatter "how to measure" across a dozen
 * places, which then drift apart.
 *
 * Beyond the public surface (`src/renderer/index.ts`), this also imports two internal
 * modules (`cfi-dom.ts`, `text-index.ts`). Those are for measurement, not for product:
 * they answer "what text does this CFI point at", and that question should not become a
 * public API for the tests' sake.
 */

const VIEWPORT_ID = "viewport";

/**
 * The frame holding the page the reader is on.
 *
 * There are three frames in the container now — the page, and the two waiting either side of
 * it for a turn in progress (frond ADR-0013) — so "the iframe" is no longer an address. frond
 * marks the one that is the page, and everything here asks for that one.
 */
const PAGE_FRAME = `iframe[${CURRENT_FRAME_ATTRIBUTE}]`;

let renderer: Renderer | undefined;
/** The turn the harness has begun, standing in for the finger a consumer would be tracking. */
let turn: TurnInProgress | undefined;
let recorded: EventRecord[] = [];
/** The frame's computed `visibility` as each event was emitted, by event name. */
let frameVisibility: Record<string, string> = {};
/** The facts of every `resolveLayout` call since the mount. */
let layoutCalls: LayoutCall[] = [];
let indexed: Promise<number> | undefined;

// Whether the `pointerdown` listener below asks frond to cancel the browser's own action for
// the press, and what became of the touch that ended it. A test cannot read the second from
// the outside: `defaultPrevented` belongs to an event that is gone by the time the tap has
// returned.
let cancelsTapDefault = false;
let touchEndPrevented: boolean | null = null;

const harness: FrondHarness = {
  async mount(fixture, options: MountOptions): Promise<Snapshot> {
    return attach(await loadBook(fixture), options);
  },

  async mountInline(sections, options: MountOptions): Promise<Snapshot> {
    return attach(
      MemoryBook.of({
        sections: sections.map((content, index) => ({
          path: `inline-${index + 1}.xhtml`,
          content,
        })),
        resources: Object.entries(options.resources ?? {}).map(([path, text]) => ({
          path,
          mediaType: path.endsWith(".css") ? "text/css" : "application/octet-stream",
          bytes: new TextEncoder().encode(text),
        })),
      }),
      options,
    );
  },

  async next(): Promise<Snapshot> {
    await active().next();
    return snapshot();
  },

  async walkNext(times): Promise<readonly Snapshot[]> {
    const renderer = active();
    const landings: Snapshot[] = [];
    for (let index = 0; index < times; index += 1) {
      await renderer.next();
      landings.push(snapshot());
    }
    return landings;
  },

  async previous(): Promise<Snapshot> {
    await active().previous();
    return snapshot();
  },

  async goToSection(index): Promise<Snapshot> {
    await active().goToSection(index);
    return snapshot();
  },

  async goTo(path, fragment): Promise<Snapshot> {
    await active().goTo({ path, fragment });
    return snapshot();
  },

  async goToCfi(cfi): Promise<Snapshot> {
    await active().goToCfi(cfi);
    return snapshot();
  },

  async goToFraction(fraction): Promise<Snapshot> {
    await active().goToFraction(fraction);
    return snapshot();
  },

  async applySettings(patch): Promise<Snapshot> {
    await active().applySettings(toSettings(patch));
    return snapshot();
  },

  /**
   * **Deliberately not awaited one at a time.** They are all fired first and awaited
   * together, because what is being measured is precisely "the next one arrives before the
   * previous has landed" — awaiting each in turn leaves the queue with a single occupant.
   */
  async rapidNext(times): Promise<Snapshot> {
    const renderer = active();
    const turns: Promise<void>[] = [];
    for (let index = 0; index < times; index += 1) turns.push(renderer.next());
    await Promise.all(turns);
    return snapshot();
  },

  async rapidApplySettings(patches): Promise<Snapshot> {
    const renderer = active();
    await Promise.all(patches.map((patch) => renderer.applySettings(toSettings(patch))));
    return snapshot();
  },

  locate(fraction): SectionAtSnapshot | null {
    return active().locate(fraction) ?? null;
  },

  frameBox(): Rect {
    const container = document.getElementById(VIEWPORT_ID);
    const frame = container?.querySelector(PAGE_FRAME);
    if (!(frame instanceof HTMLIFrameElement)) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: frame.offsetLeft,
      y: frame.offsetTop,
      width: frame.clientWidth,
      height: frame.clientHeight,
    };
  },

  frameVisibility(): string {
    return currentFrameVisibility();
  },

  frameVisibilityWhen(event): string | null {
    return frameVisibility[event] ?? null;
  },

  async resize(width, height): Promise<Snapshot> {
    const container = document.getElementById(VIEWPORT_ID);
    if (container === null) throw new Error("the shell page has no container element");

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    await active().relayout();
    return snapshot();
  },

  async relayout(): Promise<Snapshot> {
    await active().relayout();
    return snapshot();
  },

  layoutCalls(): readonly LayoutCall[] {
    return layoutCalls;
  },

  snapshot,

  async waitForIndex(): Promise<number> {
    if (indexed === undefined) throw new Error("no book has been mounted yet");
    return indexed;
  },

  textAt(cfi, length): string | null {
    const document = contentDocument();
    if (document === undefined) return null;

    const range = rangeForCfi(document, parseCfi(cfi));
    if (range === undefined) return null;

    const nodes = textNodesIn(document);
    const startIndex = nodes.indexOf(range.startContainer as Text);
    if (startIndex === -1) return null;

    let text = (nodes[startIndex]?.data ?? "").slice(range.startOffset);
    for (let index = startIndex + 1; text.length < length && index < nodes.length; index += 1) {
      text += nodes[index]?.data ?? "";
    }

    return text.slice(0, length);
  },

  textInRange(cfi): string | null {
    const document = contentDocument();
    if (document === undefined) return null;

    const range = rangeForCfi(document, parseCfi(cfi));
    if (range === undefined) return null;

    const nodes = textNodesIn(document);
    const text = nodes.map((node) => node.data).join("");

    return text.slice(
      charactersBefore(nodes, range.startContainer, range.startOffset),
      charactersBefore(nodes, range.endContainer, range.endOffset),
    );
  },

  addressEveryCharacter(xml, sectionIndex): AddressedSection {
    // Nothing is mounted. The question is what the browser's XML parser builds and what the
    // addressing walk makes of it; rendering the section would only add layout as a variable,
    // and layout has no say in where a CFI points.
    const document = new DOMParser().parseFromString(xml, "application/xhtml+xml");
    const nodes = textNodesIn(document);
    const text = nodes.map((node) => node.data).join("");

    const cfis: string[] = [];
    const resolved: [number, number][] = [];

    for (let at = 0; at < text.length; at += 1) {
      const from = positionAtCharacter(nodes, at);
      const to = positionAtCharacter(nodes, at + 1);
      if (from === undefined || to === undefined) break;

      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);

      const cfi = serializeCfi(cfiForRange(range, sectionIndex));
      cfis.push(cfi);

      // Round-tripped through the string, so this measures what a consumer actually stores
      // and hands back, rather than an object that never left the process.
      const back = rangeForCfi(document, parseCfi(cfi));
      resolved.push(
        back === undefined
          ? [-1, -1]
          : [
              charactersBefore(nodes, back.startContainer, back.startOffset),
              charactersBefore(nodes, back.endContainer, back.endOffset),
            ],
      );
    }

    return { text, cfis, resolved };
  },

  rectsFor(cfi): readonly Rect[] {
    return active()
      .rectsFor(cfi)
      .map((marked) => plainRect(marked.rect));
  },

  rangeFromPoints(anchor, focus, granularity) {
    const facts = active().rangeFromPoints(anchor, focus, granularity);
    if (facts === null) return null;
    return { cfi: facts.cfi, text: facts.text, rects: facts.rects.map(plainRect) };
  },

  markedRectsFor(cfi): readonly MarkedRectSnapshot[] {
    return active()
      .rectsFor(cfi)
      .map((marked) => ({
        role: marked.role,
        rect: plainRect(marked.rect),
        ink: plainRect(marked.ink),
      }));
  },

  containerSize(): { width: number; height: number } {
    const container = document.getElementById(VIEWPORT_ID);
    return {
      width: container?.clientWidth ?? 0,
      height: container?.clientHeight ?? 0,
    };
  },

  computed(selector, property): string {
    const document = contentDocument();
    if (document === undefined) return "";

    const element = document.querySelector(selector);
    if (element === null) return "";

    const view = document.defaultView;
    if (view === null) return "";

    return view.getComputedStyle(element).getPropertyValue(property);
  },

  objectUrl(base64, type): string {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type }));
  },

  async faceLoads(family): Promise<boolean> {
    const document = contentDocument();
    if (document === undefined) return false;

    // The face's own `status`, not `fonts.check()`: `check` answers "is anything still
    // pending for this text", which is `true` for a family that was never declared at all —
    // it would pass whether or not the rule reached the document.
    // Compared with the quotes stripped from both sides: whether a `FontFace` reports its
    // family with the quotes it was declared with is each engine's own business.
    const unquote = (name: string): string => name.replace(/^["']|["']$/g, "");
    const face = [...document.fonts].find(
      (candidate) => unquote(candidate.family) === unquote(family),
    );
    if (face === undefined) return false;

    try {
      await face.load();
    } catch {
      return false;
    }

    return face.status === "loaded";
  },

  html(): string {
    return contentDocument()?.documentElement.outerHTML ?? "";
  },

  scrollOffset(): number {
    const document = contentDocument();
    if (document === undefined) return 0;

    return active().writingMode === "vertical-rl"
      ? document.documentElement.scrollTop
      : document.documentElement.scrollLeft;
  },

  bookStylesheets(): readonly string[] {
    const document = contentDocument();
    if (document === undefined) return [];
    return [...document.querySelectorAll("style")]
      .filter((style) => style.id !== LAYOUT_STYLE_ID && style.id !== READER_STYLE_ID)
      .map((style) => style.textContent ?? "");
  },

  events(): readonly EventRecord[] {
    return recorded;
  },

  selectText(selector): void {
    const document = contentDocument();
    if (document === undefined) return;

    const element = document.querySelector(selector);
    if (element === null) return;

    const range = document.createRange();
    range.selectNodeContents(element);

    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  },

  selectAcross(startSelector, endSelector): void {
    const document = contentDocument();
    if (document === undefined) return;

    const start = document.querySelector(startSelector);
    const end = document.querySelector(endSelector);
    if (start === null || end === null) return;

    const range = document.createRange();
    const first = firstTextIn(start);
    const last = lastTextIn(end);

    // Anchored **inside** the text wherever there is any, because that is the shape a
    // reader's drag produces and the shape a range CFI round-trips back to. Wrapping the
    // elements instead would make the first and last ones fully contained as well, which is
    // a different range covering different rectangles. An element with no text at all (the
    // image-only section) has nowhere inside to anchor, so there it is wrapped.
    if (first === undefined) range.setStartBefore(start);
    else range.setStart(first, 0);
    if (last === undefined) range.setEndAfter(end);
    else range.setEnd(last, last.data.length);

    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  },

  setNativeSelection(allowed): void {
    active().setNativeSelection(allowed);
  },

  clearSelection(): void {
    renderer?.clearSelection();
  },

  selectRange(cfi): boolean {
    return active().selectRange(cfi);
  },

  rangeFactsFor(cfi) {
    const facts = active().rangeFactsFor(cfi);
    if (facts === undefined) return null;
    return { cfi: facts.cfi, text: facts.text, rects: facts.rects.map(plainRect) };
  },

  findText(text): string | null {
    return active().findText(text) ?? null;
  },

  preventTapDefaultOnPress(on): void {
    cancelsTapDefault = on;
    touchEndPrevented = null;
  },

  touchEndDefaultPrevented(): boolean | null {
    return touchEndPrevented;
  },

  clickLink(selector): void {
    const document = contentDocument();
    if (document === undefined) return;

    const element = document.querySelector(selector);
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  },

  beginTurn(towards, from): TurnSnapshot | null {
    turn = active().beginTurn(towards, from);
    if (turn === undefined) return null;
    return { extent: turn.extent, atBoundary: turn.atBoundary, hasPreview: turn.hasPreview };
  },

  moveTurn(distance): void {
    turn?.moveTo(distance);
  },

  turnEnding(): { live: boolean; stranded: boolean } | null {
    return turn === undefined ? null : { live: turn.live, stranded: turn.stranded };
  },

  commitTurn(): Snapshot {
    turn?.commit();
    turn = undefined;
    return snapshot();
  },

  cancelTurn(): Snapshot {
    turn?.cancel();
    turn = undefined;
    return snapshot();
  },

  frames(): readonly FrameSnapshot[] {
    const container = document.getElementById(VIEWPORT_ID);
    if (container === null) return [];

    return [...container.querySelectorAll("iframe")].map((frame) => {
      const transform = getComputedStyle(frame).transform;
      // Both spellings, because WebKit resolves only the prefixed one — asking for `userSelect`
      // alone reports `undefined` there, which would read as selectable on every frame.
      const root = frame.contentDocument?.documentElement;
      const style =
        root == null
          ? undefined
          : (getComputedStyle(root) as CSSStyleDeclaration & { webkitUserSelect?: string });
      return {
        offset: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41,
        visible: getComputedStyle(frame).visibility === "visible",
        page: frame.hasAttribute(CURRENT_FRAME_ATTRIBUTE),
        peek: frame.hasAttribute(PEEK_FRAME_ATTRIBUTE),
        selectable: (style?.userSelect ?? style?.webkitUserSelect) !== "none",
      };
    });
  },

  destroy(): void {
    turn = undefined;
    renderer?.destroy();
    renderer = undefined;
  },
};

Object.defineProperty(window, "frond", { value: harness, configurable: true });

/** Mounts a book. Shared by `mount` and `mountInline` — they differ only in where the book comes from. */
async function attach(book: RenderableBook, options: MountOptions): Promise<Snapshot> {
  renderer?.destroy();
  recorded = [];
  layoutCalls = [];
  frameVisibility = {};

  const container = document.getElementById(VIEWPORT_ID);
  if (container === null) throw new Error("the shell page has no container element");

  if (options.viewport !== undefined) {
    container.style.width = `${options.viewport.width}px`;
    container.style.height = `${options.viewport.height}px`;
  }

  let resolveIndexed = (_characters: number): void => {};
  indexed = new Promise<number>((resolve) => {
    resolveIndexed = resolve;
  });

  const record =
    (name: string) =>
    (payload: unknown): void => {
      recorded.push({ name, payload: JSON.parse(JSON.stringify(payload)) });
      frameVisibility[name] = currentFrameVisibility();
    };

  // Hooked up through `options.on` rather than `on()` after attaching: the first section's
  // load and relocate are emitted inside attach, and a listener added afterwards misses
  // them.
  const answers = options.resolveLayout;

  renderer = await Renderer.attach(book, container, {
    settings: toSettings(options.settings),
    start: options.start,
    ...(options.nativeSelection === undefined ? {} : { nativeSelection: options.nativeSelection }),
    // No table, no resolver at all — that is the path every other spec runs on, and it has
    // to stay the one frond sees rather than a resolver that answers nothing.
    ...(answers === undefined
      ? {}
      : {
          resolveLayout: (facts) => {
            layoutCalls.push({
              writingMode: facts.writingMode,
              viewport: { width: facts.viewport.width, height: facts.viewport.height },
            });
            return answers[facts.writingMode] ?? {};
          },
        }),
    on: {
      relocate: record("relocate"),
      load: (event) => {
        record("load")(event);
        watchTouchEnd();
      },
      layout: record("layout"),
      linkactivate: record("linkactivate"),
      error: record("error"),
      selection: record("selection"),
      pointerdown: (event) => {
        record("pointerdown")(event);
        if (cancelsTapDefault) event.preventTapDefault();
      },
      pointerup: record("pointerup"),
      keydown: record("keydown"),
      keyup: record("keyup"),
      indexed: (event) => {
        record("indexed")(event);
        resolveIndexed(event.characters);
      },
    },
  });

  return snapshot();
}

function active(): Renderer {
  if (renderer === undefined) throw new Error("no book has been mounted yet");
  return renderer;
}

function snapshot(): Snapshot {
  const current = active();
  const location = current.location;

  return {
    writingMode: current.writingMode,
    sectionIndex: location.sectionIndex,
    sectionPath: location.sectionPath,
    page: location.page,
    pageCount: location.pageCount,
    cfi: location.cfi,
    // `undefined` disappears entirely across `page.evaluate`'s boundary, so the absence has
    // to be carried as a value the spec can still see.
    pageRange: location.pageRange ?? null,
    fraction: location.fraction ?? null,
    atStart: location.atStart,
    atEnd: location.atEnd,
  };
}

/**
 * Records what became of the `touchend` that ends a press.
 *
 * Registered from the `load` hook, which the renderer emits **after** the section view has
 * wired its own listeners — so this one runs second and sees `defaultPrevented` as frond
 * left it. Registered per section, because each one brings a new content document.
 */
function watchTouchEnd(): void {
  const document = contentDocument();
  if (document === undefined) return;

  touchEndPrevented = null;
  document.addEventListener("touchend", (event) => {
    touchEndPrevented = event.defaultPrevented;
  });
}

function contentDocument(): Document | undefined {
  const frame = document.querySelector(`#${VIEWPORT_ID} ${PAGE_FRAME}`);
  if (!(frame instanceof HTMLIFrameElement)) return undefined;
  return frame.contentDocument ?? undefined;
}

/**
 * The page frame's computed `visibility`, or `"none"` when there is no frame.
 *
 * Marked frames only, and the last of those: during a section change the container holds the
 * outgoing one and the incoming one at once, and the incoming one is appended last. The two
 * peek frames are never marked, so they cannot answer this by accident — they are hidden
 * between turns, which is the very reading being asked for.
 */
function currentFrameVisibility(): string {
  const frames = document.querySelectorAll(`#${VIEWPORT_ID} ${PAGE_FRAME}`);
  const frame = frames[frames.length - 1];
  if (!(frame instanceof HTMLIFrameElement)) return "none";
  return getComputedStyle(frame).visibility;
}

/** This element's first text node, or `undefined` when it holds no text (an `<img>`). */
function firstTextIn(element: Element): Text | undefined {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return (walker.nextNode() as Text | null) ?? undefined;
}

function lastTextIn(element: Element): Text | undefined {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  let last: Text | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    last = node as Text;
  }
  return last;
}

/**
 * The plain object the spec sends over is already a partial setting, passed straight
 * down.
 *
 * **Do not fill it out into a complete setting here**: `applySettings` means "replace
 * only the fields mentioned", and filling it out would reset the unmentioned fields to
 * their defaults — so in a spec with two `applySettings` calls in a row, the second would
 * silently undo the first.
 */
function toSettings(patch: SettingsPatch | undefined): Partial<ReaderSettings> {
  return patch === undefined ? {} : (patch as Partial<ReaderSettings>);
}

/**
 * Fetches a book file by file from the harness's routes and assembles a `MemoryBook`.
 *
 * The book was opened with `EpubBook` on the Node side, so what arrives here is **a real
 * book after a real parsing layer** — obfuscated fonts already restored, hrefs already
 * normalized — while this browser side needs no decompression and no XML parsing.
 */
async function loadBook(fixture: string): Promise<RenderableBook> {
  const manifest = (await (await fetch(`/book/${fixture}/manifest.json`)).json()) as {
    readingOrder: Array<{ path: string; mediaType: string; linear: boolean }>;
    resources: Array<{ path: string; mediaType: string }>;
  };

  const bytesFor = async (path: string): Promise<Uint8Array> =>
    new Uint8Array(
      await (await fetch(`/book/${fixture}/bytes?path=${encodeURIComponent(path)}`)).arrayBuffer(),
    );

  const sectionPaths = new Set(manifest.readingOrder.map((section) => section.path));

  const sections = await Promise.all(
    manifest.readingOrder.map(async (section) => ({
      path: section.path,
      mediaType: section.mediaType,
      linear: section.linear,
      content: await bytesFor(section.path),
    })),
  );

  const resources = await Promise.all(
    manifest.resources
      .filter((resource) => !sectionPaths.has(resource.path))
      .map(async (resource) => ({
        path: resource.path,
        mediaType: resource.mediaType,
        bytes: await bytesFor(resource.path),
      })),
  );

  return MemoryBook.of({ sections, resources });
}

function plainRect(rect: DOMRect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
