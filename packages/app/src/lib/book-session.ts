import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { RefObject } from "react";
import { EpubBook, parseCfi, sectionIndexOf } from "@yurenju/frond/epub";
import {
  Renderer,
  type PageOffset,
  type RenderLocation,
  type RendererStart,
} from "@yurenju/frond/renderer";
import { db } from "./db";
import { recallPosition } from "./position-store";
import { sortByBookOrder } from "./export";
import { downloadBookFile, scheduleSync } from "./sync";
import type { At, Select } from "./route";
import type { Annotation } from "./types";
import { frondLayout, frondSettings, readRootFontSize, type ReaderSettings } from "./settings";
import { detectScript, type Script } from "./line-length";
import { detectVariant } from "./chinese";
import { sampleText } from "./epub";
import { needsWebFont } from "./web-font";
import type { LoadedWebFont } from "./web-font-store";
import { createDirection, createNavigator, type Navigator } from "./navigator";
import {
  createGestureMachine,
  type GestureEvent,
  type GestureIntent,
  type GestureMachine,
} from "./gesture";
import { LONG_PRESS_MS } from "./touch";
import type { ChromeEvent } from "./chrome";
import { createTurnRunner } from "./turn";
import type { SelectionCommands } from "./useSelection";
import {
  chapterAt,
  chapterBoundaries,
  flattenToc,
  type ChapterBoundary,
  type FlatTocItem,
} from "./toc";
import type { PlaceEvent } from "./place";
import type { Ground } from "./usePlace";

/**
 * One sitting with one book: opening it, holding it open, and putting it away again.
 *
 * It has a beginning, an end, and a pile of things to collect on the way out — seven pointer
 * listeners across three surfaces, a timer, a navigator, a gesture machine and frond's renderer.
 * That is a lifetime, and until this file it had no name: it was an 873-line `useEffect` in
 * `Reader.tsx` whose registrations sat in the first half and whose teardown sat in a cleanup
 * function eight hundred lines below them (#173).
 *
 * ⚠️ **Teardown is the fragile half, and the shape is what protects it now.** Nothing turns red
 * when a listener is registered and never taken off; what happens instead is that the reader
 * switches books and the last book's listeners are still live, so two machines fight over one
 * finger. Every `add` in here therefore writes its `remove` into `closers` on the line below it,
 * and `destroy()` runs the pile. **Registering without pushing a closer is the one mistake to
 * watch for**, and it is now one line apart rather than eight hundred.
 *
 * ## What this owns and what it hands up
 *
 * It owns everything with a lifetime or a coordinate system: the three pointer surfaces and the
 * one gesture machine they feed, the turn runner, the long-press clock, and frond itself. It also
 * carries out every intent the machine produces, so the exhaustive switch that guarantees no
 * intent goes unrouted lives in one place (CONTEXT.md [[Gesture]]).
 *
 * What it hands up is what only the reader can answer: the chrome events three of those intents
 * mean, and the facts the screen is drawn from. Those go through `on` — one callback per fact,
 * because the reader holds them as separate pieces of React state.
 *
 * ⚠️ **`on` is read once per book**, at the moment the session opens, so every callback in it has
 * to be one that keeps working when it is a render or two old. `Reader.tsx` fills it with state
 * setters, which are stable by construction. Everything that is *not* stable — the settings, the
 * theme, the selection's commands, the place's dispatch — arrives as a ref instead and is read
 * through `.current` at the moment of the call. `lib/useSelection.ts` opens with the long version
 * of why that distinction is the one thing here that turns nothing red when it is got wrong.
 */

/** Everything read off the book itself, settled before the first layout. */
export interface BookFacts {
  toc: FlatTocItem[];
  chapters: ChapterBoundary[];
  /** Whether the book is Simplified Chinese, which decides the CJK stack the fonts resolve to. */
  simplified: boolean;
  /** Whether the characters are one em wide, which sets the line-length ceiling (ADR-0012). */
  script: Script;
  /** Whether there are enough Han characters to be worth fetching a face for (ADR-0014). */
  wantsWebFont: boolean;
}

/**
 * The facts the reader draws from, as the book fills them in.
 *
 * One call per fact rather than one object, because each is a separate piece of state over in
 * `Reader.tsx` — collapsing them here would only mean unpacking them there.
 */
export interface BookSessionReport {
  /** A new book is arriving: everything the last one left on screen is stale. */
  opening(): void;
  /** The book's own name, from its record — before the epub body is anywhere near. */
  title(title: string): void;
  /** Whether the epub body is on the wire (the shelf synced metadata only). */
  downloading(is: boolean): void;
  /** The book will not open, or one section of it will not render. */
  failed(message: string): void;
  /** There is no such book any more — a stale address, or one deleted since. */
  missing(): void;
  /** The book has parsed. Everything the first layout is settled against. */
  opened(facts: BookFacts): void;
  /** Which way the book opens. Settled at open, and at most once more (see `createDirection`). */
  direction(rtl: boolean): void;
  /** Whether the section on screen lays out vertically. */
  vertical(is: boolean): void;
  /** This book's marks as Dexie holds them, read once as the book opens. */
  annotations(marks: Annotation[]): void;
  /** The page moved: which section, and how far through the whole book. */
  located(at: { fraction: number; sectionIndex: number }): void;
  /** Every rectangle frond reported is stale — a turn, a reflow, a resize. */
  moved(): void;
  /** The whole-book index is built, so a fraction can be resolved. */
  indexed(): void;
  /** The book is on screen, or (with `null`) is not any more. */
  ready(renderer: Renderer | null): void;
  /** Every jump the address asked for has landed. */
  arrived(): void;
  /** One of the three things a gesture means that only the reader can carry out. */
  chrome(event: ChromeEvent): void;
}

export interface BookSessionOptions {
  bookId: string;
  /** For the three messages this can put on screen. Read once — see the note at the top. */
  i18n: I18n;
  /** frond's container, and the band of margin around the book's own frame. */
  mount: RefObject<HTMLDivElement | null>;
  /** Filled in the moment the book is on screen and cleared on the way out. */
  renderer: RefObject<Renderer | null>;
  /** Where the address asked the book to open (`?at=`). */
  openAt?: At;
  /** A passage to arrive with already selected (`?select=`). */
  select?: Select;
  /** Draw that selection ourselves rather than letting the browser (`?handles=1`). */
  handles: boolean;
  settings: RefObject<ReaderSettings>;
  theme: RefObject<"light" | "dark">;
  /** The faces already on this device, which is what frond is handed at open. */
  webFonts: RefObject<readonly LoadedWebFont[]>;
  /**
   * The settings frond currently has, written here with the ones the first layout used.
   *
   * Shared rather than reported because the reader's settings effect writes it too, and it has
   * to hold the first layout's answer before that effect's first pass: applying them again on
   * mount is what used to reflow the book *after* the saved position had been restored, and that
   * reflow is what dropped the reader back to the start of the section (#29).
   */
  applied: RefObject<string>;
  selection: RefObject<SelectionCommands>;
  /** Where the reader is in this book (`lib/usePlace.ts`, over `lib/place.ts`'s reducer). */
  place: RefObject<(event: PlaceEvent) => void>;
  /** Where this sitting began and where it got to, for the reading session written on the way out. */
  ground: RefObject<Ground>;
  /** Moves whatever is drawn over the page — the highlight layer — with the page a turn slides. */
  slide: (at: PageOffset) => void;
  /**
   * Which mark is painted under a point, in the container's coordinates, or `null` for none.
   *
   * The reader's to answer rather than frond's: the highlight layer takes no pointer events, so
   * frond's coordinates and the painted boxes are already in the same system. It is asked at the
   * moment of the release rather than held, because the boxes move with every turn and reflow.
   */
  markAt: (point: { x: number; y: number }) => string | null;
  on: BookSessionReport;
}

/** What the reader can ask of the book while it is open. */
export interface BookSession {
  /**
   * The page on that side, asked for by an arrow key or by one of the two page buttons.
   *
   * **A page turn puts the chrome away**, whichever route asked for it — that is one half of how
   * [[Find]] ends (CONTEXT.md [[chrome]]). It is decided in the machine along with the turn
   * itself, so a route found later cannot turn a page with the interface still up.
   */
  turnPage(side: "left" | "right"): void;
  /**
   * A pointer on one of the two selection handles, in client coordinates.
   *
   * **A third surface**, alongside the book's frame and the band of margin. It cannot go through
   * either: the handles are the reader's own elements, drawn over frond's container, so frond
   * never sees the press and the margin's listeners are on a box the press did not land in. The
   * handle captures the pointer for the length of the drag, so every move and the release come
   * back here however far the finger travels.
   */
  handlePointer(
    kind: "down" | "move" | "up" | "cancel",
    end: "start" | "end",
    at: { clientX: number; clientY: number },
  ): void;
  /** Whether a selection appearing now should be blamed on the last tap rather than on the reader. */
  blamesTap(at: number): boolean;
  /**
   * Puts the book away: every listener off, every resource released, and the sitting written down.
   *
   * Safe to call before the book has finished arriving — half an open is the ordinary case when
   * the reader changes their mind, and what has not been built yet has nothing to collect.
   */
  destroy(): void;
}

/**
 * What the first layout can be told about where to open, out of the address and the saved
 * position.
 *
 * Two of the three addresses answer nothing here and are absent on purpose. `chars:` has its
 * section — that much `start` can take — and its offset inside the section is applied right
 * after, while `frac:` has to wait for the whole-book index to exist at all. Both jump once the
 * book is up; frond's `RendererStart` says why it offers no `{ fraction }` of its own.
 *
 * **A `cfi:` this book cannot answer falls back to the saved position**, rather than being handed
 * to frond anyway. frond's own fallback for an address it cannot resolve is the front of the
 * book, and that is the wrong one here: an address is what somebody typed, and a typo in it
 * should cost the jump, not the reader's place (`lib/route.ts` makes the same choice one layer
 * up, for the spellings it can check). This is where every `cfi:` arrives — `?at=cfi:`,
 * `?select=` naming a CFI, the shelf's revisit card — so it is the one place the guard has to be.
 *
 * "Cannot answer" is both of frond's two ways of giving up: a CFI that does not parse, and one
 * that parses but names a section this book does not have. The second is why `sections` is a
 * parameter — a CFI copied from another book is well-formed and points at nothing, and without
 * the count here it would look exactly like a good one.
 */
function startFor(
  at: At | undefined,
  savedCfi: string | undefined,
  sections: number,
): { start?: RendererStart } {
  if (at?.kind === "cfi" && answerable(at.cfi, sections)) return { start: { cfi: at.cfi } };
  if (at?.kind === "chars") return { start: { sectionIndex: at.sectionIndex } };
  if (at?.kind === "fraction") return {};
  return savedCfi ? { start: { cfi: savedCfi } } : {};
}

/** Whether this book can act on a CFI at all: it parses, and it names a section that is here. */
function answerable(cfi: string, sections: number): boolean {
  try {
    const index = sectionIndexOf(parseCfi(cfi));
    return index !== undefined && index < sections;
  } catch {
    return false;
  }
}

/** This book's marks as Dexie holds them, in the order the panel lists them. */
export async function readAnnotations(bookId: string): Promise<Annotation[]> {
  const rows = await db.annotations.where("bookId").equals(bookId).toArray();
  return sortByBookOrder(rows.filter((a) => !a.deletedAt));
}

/**
 * A sitting under this is not one. It is StrictMode mounting the effect twice in development, and
 * a pair of them a millisecond apart would be two rows in the stats for one book never read.
 */
// ponytail: <1s sessions dropped, filters StrictMode double-mount noise
const SHORTEST_SITTING_MS = 1000;

export function openBookSession(options: BookSessionOptions): BookSession {
  const { bookId, i18n, mount, renderer, openAt, select, settings, selection, place, ground, on } =
    options;

  let cancelled = false;
  let attached: Renderer | null = null;
  const startedAt = Date.now();
  /**
   * How to undo everything registered below, in registration order.
   *
   * The order carries no meaning — `destroy()` runs the pile in one synchronous pass, so nothing
   * can arrive part-way through it. What matters is only that every registration has an entry.
   */
  const closers: (() => void)[] = [];

  let navigator: Navigator | null = null;
  let machine: GestureMachine | null = null;

  ground.current = { from: null, to: null };
  // Everything about where the reader is belongs to the book it was learnt in. Naming the new
  // book here — before the first `await` — is also what lets a sync round landing mid-open be
  // ignored rather than measured against the book that has just been closed (`lib/place.ts`).
  place.current({ kind: "opened", bookId });
  on.opening();

  // The clock that turns a still finger into a selection. A timer rather than a test inside
  // `pointermove`, because a finger that is holding perfectly still sends no moves at all —
  // the one gesture this has to recognise is the one that would never be asked about.
  //
  // **It lives out here because the machine holds no timers** (`lib/gesture.ts`). Its firing is
  // an event like any other, so every route that has to call it off is a transition with a name
  // rather than a `clearTimeout` someone has to remember at six separate call sites.
  let longPress: ReturnType<typeof setTimeout> | undefined;

  const cancelLongPress = (): void => {
    if (longPress !== undefined) clearTimeout(longPress);
    longPress = undefined;
  };
  closers.push(cancelLongPress);

  // Plays turns out: the hand that carries out what the machine decided. It is asked for the
  // renderer and the navigator each time rather than handed them, because both change under it
  // — a renderer arrives when the book opens, and the navigator is replaced the moment the
  // book's direction is settled by a section that lays out vertically.
  const turns = createTurnRunner({
    renderer: () => renderer.current,
    navigator: () => navigator,
    slide: options.slide,
  });

  /**
   * Carries out one thing the gesture machine asked for.
   *
   * **Everything on the other side of the seam.** The machine decides *what* a run of pointer
   * events means and says so in intents; this is the only place that touches frond, a timer or
   * the reader's own state because of one. The switch is exhaustive over a flat union on purpose
   * — a route added to `GestureIntent` later fails to compile here rather than failing on a phone.
   */
  function runIntent(intent: GestureIntent): void {
    switch (intent.kind) {
      case "armLongPress":
        longPress = setTimeout(() => send({ kind: "longPressFired" }), LONG_PRESS_MS);
        return;
      case "cancelLongPress":
        cancelLongPress();
        return;
      // Everything that moves a page goes to the runner as it stands (`lib/turn.ts`). Handing
      // the intent over whole rather than unpacking it here is what stops the two settle cases
      // getting `from` and `to` the wrong way round — nothing out here takes them apart.
      case "beginTurn":
      case "moveTurn":
      case "dropTurn":
      case "commitTurn":
      case "cancelTurn":
      case "commandTurn":
        turns.run(intent);
        return;
      case "lowerChrome":
        on.chrome({ kind: "turned" });
        return;
      case "toggleChrome":
        on.chrome({ kind: "tapped" });
        return;
      // The five the selection carries out for itself (`lib/useSelection.ts`). Only one of them
      // has anything to say back: a press on a margin, a picture, the gap between paragraphs
      // has nothing to select, and the machine has to be told, or it would spend the rest of
      // the press extending nothing.
      case "beginSelection":
      case "extendSelection":
      case "holdSelection":
      case "settleSelection":
      case "dropSelection":
        if (!selection.current.apply(intent)) send({ kind: "selectionRefused" });
        return;
      case "openNote":
        on.chrome({ kind: "openNote", id: intent.annotationId });
        return;
      default:
        // An intent the machine can send and nothing here routes is an action the reader asks
        // for and never gets, and nothing reports that. This is what makes it a compile error
        // instead — the guarantee CONTEXT.md claims for this switch, spelled out.
        intent satisfies never;
    }
  }

  /** Hands one event to the machine and carries out what comes back. */
  function send(event: GestureEvent): boolean {
    if (machine === null) return false;
    const answer = machine.send(event);
    for (const intent of answer.intents) runIntent(intent);
    return answer.preventDefault;
  }

  /**
   * What a press means, whichever surface it landed on.
   *
   * **Two surfaces, one gesture.** frond reports the presses inside the book's own frame; the
   * band of margin around it belongs to the reader's container, and a finger landing there is no
   * less a page turn — on a phone it is 32px down each side, which is exactly where a thumb goes.
   * The events cannot arrive by one route: an iframe's boundary does not let them out, and
   * the container never sees the ones inside it. So both routes call these.
   */
  const onPress = (event: {
    x: number;
    y: number;
    pointerType: string;
    isLink: boolean;
    hasSelection: boolean;
    preventTapDefault?: () => void;
  }) => {
    selection.current.notePointer(event.pointerType);
    const prevent = send({
      kind: "press",
      x: event.x,
      y: event.y,
      at: performance.now(),
      pointerType: event.pointerType,
      isLink: event.isLink,
      hasSelection: event.hasSelection,
    });
    // The browser does not get to act on this press as a tap of its own — that is the search
    // bar in #36, and this is the only moment early enough to stop it. Must stay synchronous:
    // frond hands this over for the duration of the listener.
    if (prevent) event.preventTapDefault?.();
  };

  // `pointerType` is read here and not only at the press because a mouse drag selects from its
  // `mousedown`, and a document made selectable at that instant is a document the drag has
  // already started over. A mouse crosses the text to reach the word it wants, so the move is
  // where it announces itself — comfortably before the press that has to act on it.
  const onMove = (event: { x: number; y: number; pointerType: string }) => {
    selection.current.notePointer(event.pointerType);
    send({ kind: "move", x: event.x, y: event.y, at: performance.now(), turn: turns.facts() });
  };

  const onCancel = () => {
    send({ kind: "cancel" });
  };

  const onRelease = (event: { x: number; y: number; isLink: boolean; hasSelection: boolean }) => {
    // A tap that lands on a highlight opens its note. The hit test belongs to the reader — frond's
    // coordinates and the painted boxes are already in the same system — and it is asked here, at
    // the moment of the release, rather than held by the machine: the boxes move with every page
    // turn and every reflow.
    send({
      kind: "release",
      x: event.x,
      y: event.y,
      at: performance.now(),
      isLink: event.isLink,
      hasSelection: event.hasSelection,
      // frond's `hasSelection` is about the browser's own selection, and where the reader draws
      // its own that answer is permanently no.
      showingSelection: selection.current.hasSelection(),
      onHighlight: options.markAt({ x: event.x, y: event.y }),
      turn: turns.facts(),
    });
  };

  // The margin band's own listeners: the part of the container the book's frame does not
  // cover. Their coordinates are converted into the container's system, which is the one
  // frond reports in and the one the highlight boxes are measured in.
  //
  // Nothing arrives here twice: an event inside the frame is dispatched in that document and
  // does not cross the boundary, and the highlight layer takes no pointer events at all.
  const band = mount.current;
  const inContainer = (event: PointerEvent) => {
    const box = band?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const marginPress = (event: PointerEvent) =>
    onPress({
      ...inContainer(event),
      pointerType: event.pointerType,
      isLink: false,
      hasSelection: selection.current.hasSelection(),
    });
  const marginMove = (event: PointerEvent) =>
    onMove({ ...inContainer(event), pointerType: event.pointerType });
  const marginRelease = (event: PointerEvent) =>
    onRelease({
      ...inContainer(event),
      isLink: false,
      hasSelection: selection.current.hasSelection(),
    });

  listen(closers, band, "pointerdown", marginPress);
  listen(closers, band, "pointermove", marginMove);
  listen(closers, band, "pointerup", marginRelease);
  listen(closers, band, "pointercancel", onCancel);

  /**
   * A finger that let go somewhere neither surface can see.
   *
   * A long press begins inside frond's frame and then follows the finger, and the finger is
   * free to leave: on a tablet the page buttons stand either side of the book, and a release
   * over one of those reaches neither frond's listeners nor the margin's. The handles take a
   * pointer capture and have no such gap; this route cannot, because at the moment the press
   * lands there is nothing yet to capture with — it is not a selection until half a second
   * later.
   *
   * Without this the selection stays `live` for good: the colour row never appears, and the
   * only way out is a tap, which throws the selection away.
   */
  const strayRelease = () => {
    send({ kind: "strayRelease" });
  };
  listen(closers, document, "pointerup", strayRelease);
  listen(closers, document, "pointercancel", strayRelease);

  // Arrow keys with focus outside the iframe. frond forwards the ones inside it (where the
  // outer document receives nothing), and this covers the other half.
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.isComposing) return;

    // **Unless a control is using them.** Left and right belong to whatever has the focus
    // first: they move the size slider, they open and walk the line-height options, and they
    // choose a cell in the segmented settings. Turning a page as well means every adjustment
    // made from the keyboard also moves the reader, and [[Find]] closing on the way out takes
    // the panel with it — so the reader watches the thing they were adjusting disappear.
    //
    // `closest` rather than a tag check, because a segmented cell is a `<button>` and only its
    // group says the arrows are spoken for. This is asked on the way *up*: `keydown` is where
    // those controls act, and by the time the key is released the value has already moved.
    const target = e.target as Element | null;
    if (target?.closest?.("input, select, textarea, [role='radiogroup']")) return;

    if (e.key === "ArrowLeft") send({ kind: "side", side: "left" });
    if (e.key === "ArrowRight") send({ kind: "side", side: "right" });
  };
  listen(closers, document, "keyup", onKeyUp);

  async function open(): Promise<void> {
    // Resolved by the `indexed` listener below, and awaited only by a `frac:` address. A
    // promise rather than a flag read after `attach()` returns, because which of the two
    // happens first is frond's business: the index is built in the background from inside
    // `attach()`, so a short book can be indexed before this function has its renderer back.
    let indexIsBuilt = () => {};
    const indexBuilt = new Promise<void>((resolve) => {
      indexIsBuilt = resolve;
    });

    const record = await db.books.get(bookId);
    if (cancelled) return;
    // Stale URL (e.g. refresh after the book was deleted): back to the library.
    if (!record || record.deletedAt) {
      on.missing();
      return;
    }
    if (!mount.current) return;
    on.title(record.title);

    // lazy download: the shelf synced only metadata; fetch the epub on first open
    let file = record.file;
    if (!file) {
      on.downloading(true);
      try {
        file = await downloadBookFile(bookId);
      } catch (e) {
        if (!cancelled)
          on.failed(
            e instanceof Error
              ? e.message
              : i18n._(
                  msg({
                    message: "Download failed",
                    comment:
                      "Shown in place of the book when its epub could not be fetched and the failure carried no reason of its own.",
                  }),
                ),
          );
        return;
      } finally {
        if (!cancelled) on.downloading(false);
      }
      if (cancelled) return;
    }

    let book: EpubBook;
    try {
      book = await EpubBook.open(file);
    } catch (e) {
      if (!cancelled)
        on.failed(
          e instanceof Error
            ? e.message
            : i18n._(
                msg({
                  message: "This file will not open",
                  comment:
                    "Shown in place of the book when the epub is on the device but could not be parsed.",
                }),
              ),
        );
      return;
    }
    if (cancelled || !mount.current) return;

    // The first two have to be settled *before* the first layout — they are part of the
    // settings handed to `attach()`. The variant decides which CJK stack the fonts resolve
    // to; the script decides how long a line may be. One sample serves all three.
    const sample = sampleText(book);
    const isSimplified = detectVariant(book.metadata.language, sample) === "simplified";
    const bookScript = detectScript(sample);
    // The third is not urgent in the same way: the face arrives when it arrives, and the
    // book is readable in the meantime.
    const wantsFace = needsWebFont(sample);

    const flat = flattenToc(book.toc);
    // Held as a local as well as reported: `relocate` names the chapter for the row it
    // writes, and it fires from inside `attach()` — before anything reported here has come
    // back round as a render.
    const bounds = chapterBoundaries(
      flat,
      book.readingOrder.map((section) => section.path),
    );
    on.opened({
      toc: flat,
      chapters: bounds,
      simplified: isSimplified,
      script: bookScript,
      wantsWebFont: wantsFace,
    });

    // Wired straight away rather than on the first `load`, so a gesture arriving before any
    // section has laid out still turns a page. For a book that declares its direction this
    // is already the final answer; for one that does not, it is left-to-right until a
    // section lays out vertically, and `load` rebuilds it that once.
    const direction = createDirection(book.metadata.pageProgressionDirection);
    // The navigator and the machine are made together and replaced together: the machine asks
    // the navigator which page a drag or a key is reaching for, and two of them disagreeing
    // about which way the book opens is a book that turns forward one way by hand and the other
    // way by key. Rebuilt at most once per book, when an undeclared one reveals itself vertical.
    const applyDirection = () => {
      on.direction(direction.rtl);
      navigator = createNavigator({ rtl: direction.rtl });
      machine = createGestureMachine(navigator, {
        ownSelection: () => selection.current.ownsSelection(),
      });
    };
    applyDirection();

    const saved = await recallPosition(bookId);
    if (cancelled) return;
    // The last percentage we knew, so a `relocate` arriving before the index is built does
    // not overwrite a real reading position with 0.
    let lastPercentage = saved?.percentage ?? 0;
    // The position the last `relocate` reported, so the next one can be asked whether anything
    // actually moved. See the note in that handler.
    let lastCfi: string | undefined;
    // And it is where this sitting starts from: the reader carries on from where they
    // stopped, so the ground covered is measured from there rather than from the first
    // fraction the index happens to report — which may not arrive until several pages in.
    ground.current.from = saved?.percentage ?? null;

    // What this device knows about the book, and — where the address named a passage — the
    // visit that knowledge opens. **Both settled here, before `attach()`**, because the
    // layout it is about emits the `relocate` that would otherwise write the passage over
    // the reader's progress (`lib/place.ts`).
    //
    // The page compared against is the stored one, and this is the single place that has no
    // choice: the book has not laid out yet, so there is no `renderer.location` to ask. It
    // describes whichever device and window last read this book, which is close enough for
    // the question being asked — whether the passage is somewhere the reader had got to.
    place.current({ kind: "recalled", bookId, saved, at: openAt });

    const anns = await readAnnotations(bookId);
    if (cancelled) return;
    on.annotations(anns);

    const initial = frondSettings(settings.current, {
      theme: options.theme.current,
      simplified: isSimplified,
      script: bookScript,
      rootFontSize: readRootFontSize(),
      // Whatever is already on the device — normally nothing on the very first book, and
      // everything on the ones after it. Either way the fetch elsewhere settles it, and the
      // reader's settings effect applies the result.
      //
      // **Withheld from a book that does not want one**, even when the device has it: an
      // English book would otherwise be set in a CJK face and shaped with a Chinese
      // language tag, neither of which anyone asked for.
      webFonts: wantsFace ? options.webFonts.current : [],
    });
    options.applied.current = JSON.stringify(initial);

    // **Everything the first layout depends on goes in here**: the settings, the position
    // to open at, and the margin. `start` renders the saved section directly instead of
    // laying out section 0 and jumping afterwards, and `resolveLayout` supplies the margin
    // frond asks for once it has read the writing mode and before it lays a single line —
    // so nothing reflows after the position has been restored.
    attached = await Renderer.attach(book, mount.current, {
      settings: initial,
      // Where the selection we draw is the one in force, the browser's own is off entirely
      // (ADR-0036). It has to be said here rather than in a stylesheet: the text is inside
      // frond's iframe, and `user-select` on anything out here reaches none of it — nor does
      // `-webkit-touch-callout`, which is what iOS raises its own menu from. This is only the
      // opening answer; `notePointer` moves it as the reader changes hands.
      nativeSelection: !selection.current.ownsSelection(),
      // The one thing the margin needs and nobody here can know before the book is on
      // screen: which axis the line lies along (ADR-0012). frond asks; this answers.
      resolveLayout: (facts) =>
        frondLayout(
          settings.current,
          { script: bookScript, rootFontSize: readRootFontSize() },
          facts,
        ),
      // An address beats the saved position, and only for this layout: the place above
      // still holds where the reader actually was, so the sitting and the next pull are
      // measured against that and not against where they looked.
      ...startFor(openAt, saved?.cfi, book.readingOrder.length),
      on: {
        load: (event) => {
          on.vertical(event.writingMode === "vertical-rl");
          // Only a book that declared no direction gets anything from here, and only once.
          // This used to be rebuilt on every section, which is how a full-page image
          // divider — horizontal, because it links no stylesheet — swapped the tap zones
          // halfway through a right-to-left book and trapped the reader on it.
          if (direction.observeSection(event.writingMode)) applyDirection();
        },
        relocate: (at: RenderLocation) => {
          // The page under a selection we drew has moved, so its rectangles are measurements
          // of somewhere the reader can no longer see. A dragged turn has already dropped it
          // at the moment the drag began; this is every other way of leaving a page — a
          // button, an arrow key, a jump from the Scrubber or the contents.
          //
          // Only ours: a browser-drawn selection is frond's to report on, and it says so
          // itself through `selection` when the page it was on goes.
          //
          // ⚠️ **Only when the position really changed**, because one `relocate` reports no
          // movement at all: frond emits a second one the moment the whole-book index is
          // built, same section and same CFI, differing only in that the fraction has stopped
          // being `undefined`. Clearing on that one took the selection away from `?select=`
          // for `?at=chars:` and left it alone for `?at=frac:` — the same address either
          // keeping or losing its selection depending on which spelling asked for the page,
          // because `frac:` waits for that index and so has already had its no-op relocate by
          // the time the passage is selected.
          //
          // The CFI is the position; frond never repeats a signature, so a changed CFI is a
          // real move. What this gives up is a reflow that rebuilt the page around the same
          // first character — the wash would stay put with rectangles measured before it, and
          // nothing recomputes them (the reader's `geometry` effect covers painted marks
          // only). Visible rather than silent, and far rarer than the case it fixes.
          if (at.cfi !== lastCfi) selection.current.dropDrawn();
          lastCfi = at.cfi;
          const percentage = at.fraction ?? lastPercentage;
          lastPercentage = percentage;
          on.located({ fraction: percentage, sectionIndex: at.sectionIndex });

          const now = Date.now();
          const position = {
            bookId,
            cfi: at.cfi,
            // The one fact that is knowable here and nowhere else: which stretch of the book
            // this page covers. Ask for it later and there is nothing to ask.
            pageRange: at.pageRange ?? null,
            percentage,
            // Named here for the same reason: the shelf would have to open the epub to say
            // "Read to 第七章", and it has twenty of them to draw.
            chapterLabel: chapterAt(at.sectionIndex, bounds)?.label ?? null,
            lastReadAt: now,
            dirtyAt: now,
          };
          // **A visit moves the screen and nothing else**, and whether this move ends one is
          // the reducer's to say (`lib/place.ts`). Everything above this line is what the
          // reader can see and has to keep up; from here on it is the claim that this is
          // where they are in the book, and going back to a marked passage is not that claim.
          //
          // **Ending one takes nothing off the book**: all a visit puts on screen is the
          // Scrubber's mark (ADR-0040), which goes when the visit does. A banner standing at
          // this moment arrived from another device while the visit was on, and it is an
          // offer nobody has answered — reading on is not an answer to it.
          place.current({ kind: "relocated", bookId, position, fraction: at.fraction });
        },
        // The geometry is valid again — a resize or a settings change moves every
        // rectangle without moving the reader, so `relocate` alone would miss it.
        layout: () => on.moved(),
        indexed: () => {
          on.indexed();
          indexIsBuilt();
        },
        selection: (event) => selection.current.acceptNative(event),
        pointerdown: onPress,
        // The page follows the finger from here (ADR-0024). Every frame of it comes through
        // frond, because the container hears nothing from inside the iframe.
        pointermove: onMove,
        // The system took the touch away — an edge gesture, a call coming in. No release
        // follows, so without this the page stays parked halfway across the screen.
        pointercancel: onCancel,
        pointerup: onRelease,
        keyup: (event) => {
          if (event.isComposing) return;
          if (event.key === "ArrowLeft") send({ kind: "side", side: "left" });
          if (event.key === "ArrowRight") send({ kind: "side", side: "right" });
        },
        // frond reports where a link points and navigates nowhere itself. The book's own
        // table-of-contents page is the common case, and it needs no href repair now:
        // resolution happened at the parsing layer.
        linkactivate: (event) => {
          if (event.sectionIndex === undefined) return;
          void renderer.current?.goToSection(
            event.sectionIndex,
            event.fragment === undefined
              ? { kind: "first-page" }
              : { kind: "fragment", id: event.fragment },
          );
        },
        error: (event) =>
          on.failed(
            i18n._(
              msg({
                message: `This section will not render: ${{ reason: event.message }}`,
                comment:
                  "Shown when one section of an otherwise readable book fails. The value is the renderer's own message and is not translated.",
              }),
            ),
          ),
      },
    });

    if (cancelled) {
      attached.destroy();
      return;
    }
    renderer.current = attached;
    // Whatever the pointers said while the book was being built. The margin's listeners are
    // live from the first render, but `notePointer` had no renderer to tell — and the answer
    // frond opened with was read at the top of `attach`, several hundred ms of iframe, fonts
    // and first layout ago. A reader who clicked a book in the library has their cursor over
    // this very area while it loads, so the disagreement this closes is the ordinary case,
    // not a contrived one. No-ops when nothing moved.
    attached.setNativeSelection(!selection.current.ownsSelection());
    on.ready(attached);
    // **There is a book under the banner now**, which is the earliest a position from another
    // device can be offered. `attach()` is an iframe, a stylesheet and a first layout — a sync
    // round landing inside it used to raise the banner over a blank viewer, where [[Go there]]
    // reached a renderer that did not exist yet, navigated nothing, and cleared the offer for
    // good. Any offer that arrived in the meantime has been held, and standing it up is all
    // this does (`lib/place.ts`).
    place.current({ kind: "ready", bookId });

    // The two addresses the first layout could not settle on its own. `chars:` is already in
    // the right section and only moves inside it; `frac:` is a whole-book number, so it waits
    // for the index and then asks frond which section that falls in.
    if (openAt?.kind === "chars" && openAt.characters > 0) {
      await attached.goToSection(openAt.sectionIndex, {
        kind: "characters",
        characters: openAt.characters,
      });
    }
    if (openAt?.kind === "fraction") {
      await indexBuilt;
      if (cancelled) return;
      await attached.goToFraction(openAt.fraction);
    }
    if (cancelled) return;

    // **After the jumps, not with them.** A selection is geometry, and `showRange`
    // (`lib/useSelection.ts`) drops a range with no rectangles — until the two jumps above have
    // landed, the passage is not on the page in front of anyone and both routes would come back
    // empty.
    if (select) selection.current.applyAddress(select, options.handles);

    // The address has been spent. Read by `tests/browser/support/library.ts`, which otherwise
    // has no way to tell a book that opened where it was asked from one still on its way
    // there — the two jumps above land after the first layout has already settled.
    on.arrived();
  }

  void open();

  return {
    turnPage: (side) => {
      send({ kind: "side", side });
    },
    handlePointer: (kind, end, at) => {
      const event = selection.current.handlePointer(kind, end, at);
      if (event !== null) send(event);
    },
    blamesTap: (at) => machine?.blamesTapForSelection(at) === true,
    destroy: () => {
      cancelled = true;
      for (const close of closers) close();
      closers.length = 0;
      navigator = null;
      // **The second belt**, and the reason a listener left on is survivable rather than fatal:
      // `send` answers nothing without a machine, so a stray press reaches no intent. It is not a
      // reason to be careless with `closers` — a listener with state of its own would not be
      // covered by it — but it is why the failure mode is a silent leak rather than a crash.
      machine = null;
      renderer.current = null;
      on.ready(null);
      attached?.destroy();
      writeSitting();
    },
  };

  /** The sitting that has just ended, for the stats on the shelf (`lib/stats.ts`). */
  function writeSitting(): void {
    const endedAt = Date.now();
    if (endedAt - startedAt < SHORTEST_SITTING_MS) return;
    // Both ends or neither. One end alone is a displacement measured from a place nobody
    // recorded, and half of it would be read as ground covered.
    const { from, to } = ground.current;
    const placed = from !== null && to !== null;
    db.readingSessions.add({
      id: crypto.randomUUID(),
      bookId,
      startedAt,
      endedAt,
      startFraction: placed ? from : null,
      endFraction: placed ? to : null,
      dirtyAt: endedAt,
    });
    scheduleSync();
  }
}

/**
 * Registers one listener and writes its removal down in the same breath.
 *
 * ⚠️ **This pairing is the whole point of the file.** A listener left on outlives the book it was
 * registered for, and the reader who opens another one then has two sessions fighting over one
 * finger — with nothing red anywhere to say so. Adding a surface means calling this, not calling
 * `addEventListener` and remembering the other half further down.
 *
 * `target` is nullable because the container is read out of a ref, and a ref can be empty.
 */
function listen<K extends keyof GlobalEventHandlersEventMap>(
  closers: (() => void)[],
  target: EventTarget | null | undefined,
  type: K,
  handler: (event: GlobalEventHandlersEventMap[K]) => void,
): void {
  if (!target) return;
  target.addEventListener(type, handler as EventListener);
  closers.push(() => target.removeEventListener(type, handler as EventListener));
}
