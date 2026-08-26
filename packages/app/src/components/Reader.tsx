import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EpubBook } from "@yurenju/frond/epub";
import {
  Renderer,
  type PageOffset,
  type RenderLocation,
  type TurnDirection,
  type TurnEdge,
  type TurnInProgress,
} from "@yurenju/frond/renderer";
import { db } from "../lib/db";
import { recallPosition, rememberPosition } from "../lib/position-store";
import { sortByBookOrder } from "../lib/export";
import {
  downloadBookFile,
  notePosition,
  scheduleSync,
  subscribePulledAnnotations,
  subscribePulledProgress,
} from "../lib/sync";
import { elapsedSince, positionFromElsewhere, type Elapsed } from "../lib/elsewhere";
import type { Annotation, Progress } from "../lib/types";
import {
  FONT_FAMILIES,
  frondLayout,
  frondSettings,
  readRootFontSize,
  type FontChoice,
  type ReaderSettings,
} from "../lib/settings";
import { detectScript, type Script } from "../lib/line-length";
import { detectVariant } from "../lib/chinese";
import { sampleText } from "../lib/epub";
import { needsWebFont, webFontsFor } from "../lib/web-font";
import {
  ensureWebFont,
  webFontAppliedNote,
  WEB_FONT_UNAVAILABLE_NOTE,
  type LoadedWebFont,
  type WebFontStatus,
} from "../lib/web-font-store";
import { createDirection, createNavigator, type Navigator } from "../lib/navigator";
import {
  createGestureMachine,
  type GestureEvent,
  type GestureIntent,
  type GestureMachine,
  type TurnFacts,
} from "../lib/gesture";
import { LONG_PRESS_MS } from "../lib/touch";
import {
  initialChrome,
  isPanel,
  nextChrome,
  type ChromeEvent,
  type PanelKind,
} from "../lib/chrome";
import { selectionEnds, type Point, type Rect, type SelectionEnds } from "../lib/selection-handles";
import {
  BOUNCE_FRACTION,
  BOUNCE_MS,
  easeInOut,
  easeOut,
  TURN_COMMAND_MS,
  TURN_SETTLE_MS,
} from "../lib/turn";
import {
  anchorFromRects,
  handleBoxes,
  placeSelectionToolbar,
  type SelectionAnchor,
  type ToolbarPlacement,
} from "../lib/toolbar-position";
import {
  chapterAt,
  chapterBoundaries,
  flattenToc,
  type ChapterBoundary,
  type FlatTocItem,
} from "../lib/toc";
import {
  boxesContain,
  hitBoxes,
  markStrips,
  markVar,
  DEFAULT_MARK,
  MARKS,
} from "../lib/highlights";
import Panel from "./Panel";
import TypographyForm from "./TypographyForm";
import HighlightLayer, { type PaintedHighlight } from "./HighlightLayer";
import SelectionLayer from "./SelectionLayer";
import Scrubber from "./Scrubber";

/**
 * What the one panel calls itself while it is showing each of the three.
 *
 * The state the three are is `lib/chrome.ts`'s; this is what they are *called*, which stays here
 * because moving it would move a catalog entry into `lib/`.
 *
 * The `data-testid` is here rather than at the call site because it is the same question the
 * title answers — which of the three is up — and answering it twice is how the two drift apart.
 * Naming the three ids keeps every existing spec pointing at the panel it was written for; the
 * merge below is a change to the shell, and a shell change should not rewrite five suites.
 */
const PANEL_FACES: Record<PanelKind, { title: MessageDescriptor; testId: string }> = {
  toc: {
    title: msg({
      message: "Contents",
      comment:
        "Title of the panel listing the book's chapters, and the label of the bar button that raises it.",
    }),
    testId: "panel-toc",
  },
  notes: {
    title: msg({
      message: "Notes",
      comment:
        "Title of the panel listing what the reader has marked in this book, and the label of the bar button that raises it.",
    }),
    testId: "panel-notes",
  },
  layout: {
    title: msg({
      message: "Type",
      comment:
        "Title of the panel holding the six typography settings, and the label of the bar button that raises it. It is about how the book is set, not about the book's contents.",
    }),
    testId: "panel-layout",
  },
};

// How long the applied/unavailable toast stays before it clears itself. Long enough to read a
// short line, short enough not to sit over the page.
const FONT_TOAST_MS = 2600;

// Where the page sits when no turn is moving it.
const AT_REST: PageOffset = { x: 0, y: 0 };

/**
 * Whether this device's own selection is the one the reader gets, or ours.
 *
 * **Asked of the device, not of each gesture.** ADR-0036 splits on the pointer — a finger gets
 * the selection we draw, a mouse gets the browser's — and the cheapest reading of that would be
 * to switch on every `pointerdown`. It is not the reading taken: turning `user-select` off is a
 * declaration inside the book's document, and flipping it mid-gesture is exactly the moment iOS
 * has already decided whether to raise a magnifier. So the question is put once, to the machine,
 * in the terms CSS puts it: is the primary pointer coarse.
 *
 * What that costs is an iPad with a trackpad, where the primary pointer is the finger and the
 * mouse therefore loses native selection too. Accepted for this round — the alternative is a
 * second selection mechanism switching under the reader's hand, and whether that is even safe on
 * iOS is one of the things only a real device can answer (ADR-0036's own note).
 *
 * `matchMedia` may be absent in a non-browser environment; a missing answer means the desk,
 * which is the arrangement that has never had any of these symptoms.
 */
const coarsePointer = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** The selection the app drew itself: what to wash, and the two ends to take hold of. */
interface DrawnSelection {
  readonly rects: readonly Rect[];
  readonly ends: SelectionEnds;
}

/**
 * Moves the highlight layer with the page a turn is sliding.
 *
 * A mark belongs to a passage of the book, not to the screen: the moment the page starts
 * moving, so must every mark on it. The boxes themselves are measured against the page's
 * resting place and are not remeasured during a turn — nothing about the page's *own* layout
 * changes while it slides, so one transform on the layer says the whole of it.
 */
function slideMarks(layer: HTMLElement | null, at: PageOffset): void {
  if (layer === null) return;
  layer.style.transform = at.x === 0 && at.y === 0 ? "" : `translate(${at.x}px, ${at.y}px)`;
}

// A rectangle frond reported, kept as a plain value. `DOMRect`s from a document that has since
// relaid out are not wrong so much as meaningless, and holding one in state invites reading it
// later; four numbers cannot be mistaken for a live measurement.
const toRect = (rect: DOMRect): Rect => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

// The reader-facing name of a font choice, from its one source. The toast names the face the
// download applied, and the dropdown is where that name is defined.
const fontFamilyLabel = (i18n: I18n, choice: FontChoice): string => {
  const found = FONT_FAMILIES.find((f) => f.value === choice);
  return found ? i18n._(found.label) : "";
};

/**
 * How long ago the other device wrote its position, in words.
 *
 * Coarse on purpose. The reading is taken once, when the banner appears, and never refreshed
 * (`lib/elsewhere.ts`) — a grain of minutes and hours is one a stale reading survives, where
 * "5 minutes ago" refreshed to the second would not.
 */
function elsewhereWhen(i18n: I18n, elapsed: Elapsed): string {
  if (elapsed.unit === "now") {
    return i18n._(
      msg({
        message: "Just now",
        comment:
          "On the banner about a position read on another device: that position was written less than a minute ago. Also what a position written slightly in the future says, since the two devices' clocks need not agree.",
      }),
    );
  }
  const { count } = elapsed;
  if (elapsed.unit === "minutes") {
    return i18n._(
      msg({
        message: plural(count, { one: "# minute ago", other: "# minutes ago" }),
        comment:
          "On the banner about a position read on another device: how long ago it was written. Whole minutes, under an hour.",
      }),
    );
  }
  if (elapsed.unit === "hours") {
    return i18n._(
      msg({
        message: plural(count, { one: "# hour ago", other: "# hours ago" }),
        comment:
          "On the banner about a position read on another device: how long ago it was written. Whole hours, under a day.",
      }),
    );
  }
  return i18n._(
    msg({
      message: plural(count, { one: "# day ago", other: "# days ago" }),
      comment:
        "On the banner about a position read on another device: how long ago it was written. Whole days.",
    }),
  );
}

/**
 * The three things that happen every time the reader's position changes, in the order they have
 * to happen in.
 *
 * Written once here because a page turn is not the only thing that moves the position: turning
 * down an offer from another device writes one too, and that write is the whole of what the
 * refusal means (`lib/elsewhere.ts`). Two call sites that must agree are one function.
 */
function recordPosition(position: Progress): void {
  // Not `db.progress.put` on its own: that write is unawaited, and a reload landing before it
  // commits used to come back holding the page before this one (#173).
  rememberPosition(position);
  // Also handed to sync as a plain value, so switching app can push it without waiting on an
  // IndexedDB read first (`beaconPositions`).
  notePosition(position);
  scheduleSync();
}

/** This book's marks as Dexie holds them, in the order the panel lists them. */
async function readAnnotations(bookId: string): Promise<Annotation[]> {
  const rows = await db.annotations.where("bookId").equals(bookId).toArray();
  return sortByBookOrder(rows.filter((a) => !a.deletedAt));
}

export default function Reader({
  bookId,
  onClose,
  onOpenAbout,
  settings,
  onSettingChange,
  onResetSettings,
  resolvedTheme,
}: {
  bookId: string;
  onClose: () => void;
  /** Opens 〈書的詳情〉 over the book (`#/book/<id>?d=about/<id>`). */
  onOpenAbout: () => void;
  /** The one record every book renders from. Adjusting it here adjusts every book (ADR-0026). */
  settings: ReaderSettings;
  onSettingChange: (patch: Partial<ReaderSettings>) => void;
  onResetSettings: () => void;
  resolvedTheme: "light" | "dark";
}) {
  const { t, i18n } = useLingui();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const navRef = useRef<Navigator | null>(null);
  /**
   * What a run of pointer events means, in the one place that decides it.
   *
   * A ref for the same reason the navigator is one: it is built inside the effect that opens the
   * book — it needs the book's direction — and read from listeners registered before that effect
   * has got there.
   */
  const machineRef = useRef<GestureMachine | null>(null);
  /**
   * A page button or an arrow key asking for the page on that side.
   *
   * The buttons are rendered down in the markup and the machine that answers them lives in the
   * effect, so this is the same arrangement as `handlesRef` and for the same reason.
   */
  const onSideRef = useRef<((side: "left" | "right") => void) | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [title, setTitle] = useState("");
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Named rather than read inline in the bar button, so the catalog carries `{markCount}`
  // instead of a bare `{0}` that says nothing to whoever translates it.
  const markCount = annotations.length;
  /**
   * Which of the reader's states is standing, which panel it last showed, and which note is being
   * written. One value with one writer: `lib/chrome.ts` owns every rule about how it changes, and
   * what is left here is naming the event that just happened (CONTEXT.md 〈chrome〉).
   */
  const [chromeState, setChromeState] = useState(initialChrome);
  const { chrome, panelKind, editing: editingId } = chromeState;
  const chromeUp = chrome !== "down";
  /** Hands one event to the chrome machine. */
  const sendChrome = (event: ChromeEvent) => setChromeState((now) => nextChrome(now, event));
  /**
   * Where this device has the reader, as the last `relocate` left it.
   *
   * A ref rather than state: nothing renders from it, and it is read from inside a sync
   * callback that closed over its scope long before the page turn it needs to know about.
   */
  const positionRef = useRef<Progress | null>(null);
  /**
   * A position from another device, offered but not taken, and how long ago it was written.
   *
   * **Held here, not read back from Dexie when the reader answers.** The pull has already
   * written it there, and the next page turn on this device writes over it — so by the time a
   * banner that has been on screen for a minute is answered, the row it is about may be gone.
   * A copy up here is what makes the offer outlive the sync that produced it.
   *
   * **The elapsed reading is taken once, here, rather than computed as the banner draws.** A
   * `Date.now()` in the markup would be re-read on every unrelated render — a page turn, the
   * chrome going up — so the wording would stand still and then jump a step at whatever moment
   * the reader happened to do something else, which is harder to explain than either a frozen
   * reading or a ticking one (`lib/elsewhere.ts`).
   */
  const [elsewhere, setElsewhere] = useState<{ position: Progress; elapsed: Elapsed } | null>(null);
  /**
   * Whether the section on screen lays out vertically, which the type panel needs in order to
   * take the column choice away: frond cannot paginate a vertically-written book in more than
   * one column at all. It stays in here because
   * this is the only place that knows — `resolveLayout` gets the mode from frond itself.
   */
  const [verticalBook, setVerticalBook] = useState(false);
  // Read from inside the open effect, which closed over its scope before the first section had
  // laid out. Which axis a selection's handles hang off depends on it.
  const verticalRef = useRef(false);
  verticalRef.current = verticalBook;
  /**
   * Whether this device gets the selection we draw. Decided once, at the top of the reader.
   *
   * Held in a ref rather than read where it is needed, because the answer must not change
   * halfway through a book: frond is told at `attach()` whether to leave the document
   * selectable, and a later disagreement between that and the gestures here is a book that
   * selects two ways at once.
   */
  const ownSelectionRef = useRef(coarsePointer());
  /**
   * What a pointer on a selection handle does, filled in by the effect that owns the gestures.
   *
   * A ref because the two live on opposite sides of the component: the handles are rendered
   * here, and everything that knows what dragging one means — the renderer, the anchor, the
   * page — is inside the effect that opened the book. Lifting that into state would re-render
   * the reader on every frame of a drag.
   */
  const handlesRef = useRef<
    ((kind: "down" | "move" | "up" | "cancel", end: "start" | "end", point: Point) => void) | null
  >(null);
  const [selection, setSelection] = useState<{
    cfiRange: string;
    text: string;
    anchor: SelectionAnchor;
    /**
     * The geometry of a selection we drew, or `null` for one the browser drew.
     *
     * Both arrive here because everything downstream — the colour row, saving a mark — is the
     * same either way. What differs is only who painted it, and that is one field rather than a
     * second piece of state that half the reader would have to consult as well.
     */
    drawn: DrawnSelection | null;
    /**
     * The finger is still down on it.
     *
     * 〈標〉 waits for that finger to lift (CONTEXT.md 〈chrome〉): a colour row raised mid-drag
     * appears under the finger that raised it and then chases the selection across the page.
     * Always false for a browser-drawn selection, which is only reported once it has settled.
     */
    live: boolean;
  } | null>(null);
  // Read from inside the open effect, which closed over its own scope before any selection
  // existed. A press landing in the margin has no `hasSelection` of its own to report — frond
  // answers that for the presses inside the book, and out here this is the same answer.
  const selectionRef = useRef<typeof selection>(null);
  selectionRef.current = selection;
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The reader's own box, which the panels are rendered into. Where a panel stops is then a box
  // rather than a pair of numbers kept in step with the height of two bars — see `Panel`.
  const panelHostRef = useRef<HTMLDivElement>(null);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPlacement | null>(null);
  const [fraction, setFraction] = useState(0);
  // The Scrubber stays disabled until frond has built the whole-book index: before that
  // `fraction` is undefined and a jump to one cannot be resolved.
  const [indexed, setIndexed] = useState(false);
  // Bumped whenever the geometry frond reports has moved — a page turn, a new section, a
  // settings change, a resize. Every measured rectangle is stale from that moment, which is
  // exactly what the highlight layer has to recompute against.
  const [geometry, setGeometry] = useState(0);
  const [painted, setPainted] = useState<PaintedHighlight[]>([]);
  // The same list the layer paints, for hit-testing a tap without waiting for a re-render.
  const paintedRef = useRef<PaintedHighlight[]>([]);
  // The layer itself, so a turn in progress can slide it with the page it is drawn over. Moved
  // by hand rather than through state: this runs once per animation frame, and re-rendering the
  // reader at 60Hz to move one box would be paying for the whole tree to move a transform.
  const marksRef = useRef<HTMLDivElement>(null);
  const [chapters, setChapters] = useState<ChapterBoundary[]>([]);
  // Which section is on screen. Unlike `fraction` this is known from the very first
  // `relocate`, before the whole-book index exists — so the panel can mark the current
  // chapter while the Scrubber is still disabled.
  const [sectionIndex, setSectionIndex] = useState(0);
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // The settings frond currently has, so the effect below can tell a real change from the
  // first render. Applying them again on mount is what used to reflow the book *after* the
  // saved position had been restored, and that reflow is what dropped the reader back to the
  // start of the section (#29).
  const appliedRef = useRef<string>("");
  // Which renderer the settings have already been laid out under. `attach()` takes them for
  // its own first layout, so the effect's first pass over a fresh renderer has nothing to do.
  const settledFor = useRef<Renderer | null>(null);
  // whether the book is Simplified Chinese; decided once at open, from the book's own bytes
  const [simplified, setSimplified] = useState(false);
  // whether the book's characters are one em wide, which sets the line-length ceiling
  // (ADR-0012). Decided once at open, from the same 5000-character sample as the variant.
  const [script, setScript] = useState<Script>("cjk");
  // whether this book has enough Han characters to be worth fetching a face for (ADR-0014).
  // The third answer read off that one sample, and deliberately not `script` — see
  // `web-font.ts`'s `needsWebFont`.
  const [wantsWebFont, setWantsWebFont] = useState(false);
  // The faces already on this device, which is what frond is handed. Empty until one arrives,
  // and empty for good when the reader is offline — the book renders in the platform's face
  // either way.
  const [webFonts, setWebFonts] = useState<readonly LoadedWebFont[]>([]);
  // What the settings panel says about the fetch. `null` until there is anything to say.
  const [webFontStatus, setWebFontStatus] = useState<WebFontStatus | null>(null);
  // Whether a face is on the network right now, which is what the Aa button traces its border
  // for. Set only once a fetch actually reaches the wire, so a face that comes back from the
  // device shows nothing — a cached switch is instant and silent, no trace, no toast.
  const [fontBusy, setFontBusy] = useState(false);
  // The one-off note that fires once at the end of the whole job — applied, or could not be
  // had. `null` when there is nothing to announce. Distinct from `webFontStatus`, which is the
  // running line in the panel; this is the toast that explains the reflow after the fact.
  const [fontToast, setFontToast] = useState<string | null>(null);
  // Read by the open path, which builds the first settings before any of this is in state.
  const webFontsRef = useRef(webFonts);
  webFontsRef.current = webFonts;
  // right-opening book: the next page is to the left. Decided once per book — see
  // `createDirection`; a section that lays out horizontally must not flip it.
  const [rtl, setRtl] = useState(false);
  // lazy download: epub body not local yet, or the download failed
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attached: Renderer | null = null;
    const startedAt = Date.now();

    // Where this sitting began and where it got to, so the shelf can say how long the book has
    // left in it (`stats.ts`). Only knowable here: a fraction is the whole-book index's answer,
    // and the index is built by the renderer that is about to be torn down. `null` until a
    // `relocate` carries one — until then the reader is in the book but not yet placed in it,
    // and 0 would be the claim that they are at the front of it.
    let openedAtFraction: number | null = null;
    let leftAtFraction: number | null = null;
    setIndexed(false);
    setFraction(0);
    setSectionIndex(0);
    setChapters([]);

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

    // The turn the finger is dragging, as frond made it. The machine names turns and is told back
    // what they measured; the object itself never crosses that line, because faking one for a
    // unit test would mean faking the parts hardest to be right about (`lib/gesture.ts`).
    let dragTurn: TurnInProgress | null = null;

    const turnFacts = (): TurnFacts | null =>
      dragTurn === null ? null : { extent: dragTurn.extent, atBoundary: dragTurn.atBoundary };

    /**
     * A turn from frond, with the highlight layer tied to the page it is drawn over.
     *
     * **Wrapped here rather than at each call site**, because a turn is put back by several
     * routes — released, bounced, swapped for the other page, cancelled by a press going
     * somewhere else — and every one of them ends at `cancel()`. A route added later gets this
     * without knowing it exists.
     *
     * **Committing is the one ending that does not put the layer back, and that is deliberate.**
     * The boxes on it were measured against the page that has just left; frond swaps the frames
     * at once, while the repaint that replaces those boxes waits for `relocate` to come back
     * through React. Snapping the layer home in between would draw the old page's marks over
     * the new page for a frame — the mark slides off the edge, blinks back at its old spot on
     * the wrong page, and then goes. Left where the turn carried them, the stale boxes are off
     * the side of the book and clipped until the repaint drops them.
     */
    const beginTurn = (
      towards: TurnDirection,
      from: TurnEdge,
      renderer: Renderer,
    ): TurnInProgress | undefined => {
      const turn = renderer.beginTurn(towards, from);
      if (turn === undefined) return undefined;

      return {
        extent: turn.extent,
        atBoundary: turn.atBoundary,
        hasPreview: turn.hasPreview,
        get live() {
          return turn.live;
        },
        moveTo: (distance) => {
          const at = turn.moveTo(distance);
          slideMarks(marksRef.current, at);
          return at;
        },
        commit: turn.commit,
        cancel: () => {
          turn.cancel();
          slideMarks(marksRef.current, AT_REST);
        },
      };
    };

    /**
     * Slides a turn from one distance to another, then hands over to `finish`.
     *
     * The one animation runner both routes into a turn use. What separates them is the easing
     * and the time, which is why both are arguments rather than constants read in here: a turn
     * that finishes a drag carries on at the speed the finger left it at, and one the reader
     * asked for by pressing something starts from a standstill.
     *
     * `prefers-reduced-motion: reduce` lands it instantly. Following a finger is not affected by
     * that — direct manipulation is not an animation — but everything through here is.
     */
    const slideTurn = (
      turn: TurnInProgress,
      span: {
        readonly from: number;
        readonly to: number;
        readonly ms: number;
        readonly ease: (t: number) => number;
      },
      finish: () => void,
    ): void => {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (still || span.from === span.to) {
        turn.moveTo(span.to);
        finish();
        return;
      }

      const startedAt = performance.now();
      const step = (now: number) => {
        // Something else moved the reader — a key, a jump, a resize. The turn is already over,
        // and frond has already put the frames back, so the marks go back with them.
        if (!turn.live) {
          slideMarks(marksRef.current, AT_REST);
          return;
        }
        const t = Math.min(1, (now - startedAt) / span.ms);
        turn.moveTo(span.from + (span.to - span.from) * span.ease(t));
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        finish();
      };
      requestAnimationFrame(step);
    };

    // The tail of the gesture: slide the rest of the way, then take the turn or put it back.
    // The reader has done the moving up to this point, so it starts at the speed they left it
    // at and eases out.
    const settleTurn = (turn: TurnInProgress, from: number, to: number, take: boolean): void =>
      slideTurn(turn, { from, to, ms: TURN_SETTLE_MS, ease: easeOut }, () =>
        take ? turn.commit() : turn.cancel(),
      );

    // Puts a selection away: the one this component is showing, and the browser's own if there
    // is one. The second half is frond's to do — a browser-drawn selection lives inside its
    // iframe — and it is harmless where the selection was ours, because there is nothing there
    // to clear.
    //
    // Called for a selection the reader did not ask for (a phone browser's tap-to-select), for
    // one they have asked to be rid of, and for one a page turn has carried off.
    const dropSelection = () => {
      setSelection(null);
      rendererRef.current?.clearSelection();
    };

    /**
     * Puts a range frond has just located on screen as the selection.
     *
     * The one route into 〈標〉 for a selection we drew, so everything that has to be true of one
     * is true here once: the chrome goes down, the geometry is converted into both systems that
     * need it — the container's, for the wash and the handles, and the top window's, for the
     * colour row — and `live` says whether the finger has finished.
     *
     * A range with no rectangles is dropped rather than shown: it is a selection that is not on
     * the page in front of the reader, and there is nothing to put a handle on.
     */
    const showRange = (
      facts: { cfi: string; text: string; rects: readonly DOMRect[] },
      live: boolean,
    ): void => {
      const container = mountRef.current?.getBoundingClientRect();
      if (!container) return;
      const anchor = anchorFromRects(facts.rects, container);
      const ends = selectionEnds(facts.rects, verticalRef.current);
      if (!anchor || !ends) return;

      // 〈標〉 displaces 〈找〉, same as the browser-drawn route below.
      sendChrome({ kind: "selectionArrived" });
      setSelection({
        cfiRange: facts.cfi,
        text: facts.text,
        anchor,
        drawn: { rects: facts.rects.map(toRect), ends },
        live,
      });
    };

    /**
     * Carries out one thing the gesture machine asked for.
     *
     * **Everything on the other side of the seam.** The machine decides *what* a run of pointer
     * events means and says so in intents; this is the only place that touches frond, React state
     * or a timer because of one. The switch is exhaustive over a flat union on purpose — a route
     * added to `GestureIntent` later fails to compile here rather than failing on a phone.
     */
    function runIntent(intent: GestureIntent): void {
      switch (intent.kind) {
        case "armLongPress":
          longPress = setTimeout(() => send({ kind: "longPressFired" }), LONG_PRESS_MS);
          return;
        case "cancelLongPress":
          cancelLongPress();
          return;
        case "beginTurn": {
          const renderer = rendererRef.current;
          // `undefined` from frond means there is no page that way. The machine hears about it on
          // the next move, as a turn that is not there, and gets to ask for one again.
          dragTurn =
            renderer === null ? null : (beginTurn(intent.towards, intent.from, renderer) ?? null);
          return;
        }
        case "moveTurn":
          dragTurn?.moveTo(intent.distance);
          return;
        case "dropTurn": {
          const held = dragTurn;
          dragTurn = null;
          held?.cancel();
          return;
        }
        case "commitTurn": {
          const held = dragTurn;
          dragTurn = null;
          if (held !== null) settleTurn(held, intent.from, intent.to, true);
          return;
        }
        case "cancelTurn": {
          const held = dragTurn;
          dragTurn = null;
          if (held !== null) settleTurn(held, intent.from, intent.to, false);
          return;
        }
        case "commandTurn":
          commandTurn(intent.towards);
          return;
        case "lowerChrome":
          sendChrome({ kind: "turned" });
          return;
        case "toggleChrome":
          sendChrome({ kind: "tapped" });
          return;
        case "beginSelection": {
          const facts = rendererRef.current?.rangeFromPoints(intent.at, intent.at, "word");
          // A press on a margin, a picture, the gap between paragraphs: nothing to select, and
          // the press carries on being whatever it would otherwise have been — which is what the
          // machine has to be told, or it would spend the rest of the press extending nothing.
          if (facts) showRange(facts, true);
          else send({ kind: "selectionRefused" });
          return;
        }
        case "extendSelection": {
          // `"char"` rather than `"word"`: the word granularity is spent on the first snap, and
          // from then on the reader is choosing where the passage ends. The two platforms differ
          // — iOS extends by character, Android snaps to words — and character is the one the
          // reader can always reach the other from. ⚠️ Whether it is fiddly on a real phone is one
          // for the device trip; changing it is changing this argument.
          const facts = rendererRef.current?.rangeFromPoints(intent.from, intent.to, "char");
          // A finger over a margin, a picture, or past the end of the column has moved off the
          // text rather than to the end of it — the selection stays where the reader last had it.
          if (facts) showRange(facts, true);
          return;
        }
        case "holdSelection":
          setSelection((now) => (now === null ? null : { ...now, live: true }));
          return;
        case "settleSelection":
          // 〈標〉 may stand up now the finger has finished (CONTEXT.md 〈chrome〉).
          setSelection((now) => (now === null ? null : { ...now, live: false }));
          return;
        case "dropSelection":
          dropSelection();
          return;
        case "openNote":
          sendChrome({ kind: "openNote", id: intent.annotationId });
          return;
      }
    }

    /** Hands one event to the machine and carries out what comes back. */
    function send(event: GestureEvent): boolean {
      const machine = machineRef.current;
      if (machine === null) return false;
      const answer = machine.send(event);
      for (const intent of answer.intents) runIntent(intent);
      return answer.preventDefault;
    }

    /**
     * What a press means, whichever surface it landed on.
     *
     * **Two surfaces, one gesture.** frond reports the presses inside the book's own frame; the
     * band of margin around it belongs to this component, and a finger landing there is no less
     * a page turn — on a phone it is 32px down each side, which is exactly where a thumb goes.
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

    const onMove = (event: { x: number; y: number }) => {
      send({ kind: "move", x: event.x, y: event.y, at: performance.now(), turn: turnFacts() });
    };

    const onCancel = () => {
      send({ kind: "cancel" });
    };

    const onRelease = (event: { x: number; y: number; isLink: boolean; hasSelection: boolean }) => {
      // A tap that lands on a highlight opens its note. The hit test is ours because the layer
      // takes no pointer events — frond's coordinates and the painted boxes are already in the
      // same system — and it is measured here, at the moment of the release, rather than held by
      // the machine: the boxes move with every page turn and every reflow.
      const hit = paintedRef.current.find((entry) =>
        boxesContain({ x: event.x, y: event.y }, entry.targets),
      );
      send({
        kind: "release",
        x: event.x,
        y: event.y,
        at: performance.now(),
        isLink: event.isLink,
        hasSelection: event.hasSelection,
        // frond's `hasSelection` is about the browser's own selection, and where this component
        // draws its own that answer is permanently no.
        showingSelection: selectionRef.current !== null,
        onHighlight: hit?.annotation.id ?? null,
        turn: turnFacts(),
      });
    };

    /**
     * A pointer on one of the two handles.
     *
     * **A third surface**, alongside the book's frame and the band of margin. It cannot go
     * through either: the handles are this component's own elements, drawn over frond's
     * container, so frond never sees the press and the margin's listeners are on a box the
     * press did not land in. The handle captures the pointer for the length of the drag, so
     * every move and the release come back here however far the finger travels.
     */
    handlesRef.current = (kind, end, point) => {
      const ends = selectionRef.current?.drawn?.ends;
      if (ends === undefined) return;

      switch (kind) {
        case "down":
          send({ kind: "handleDown", end, point, ends });
          return;
        case "move":
          send({ kind: "handleMove", point });
          return;
        case "up":
        case "cancel":
          send({ kind: "strayRelease" });
          return;
      }
    };

    // The margin band's own listeners: the part of the container the book's frame does not
    // cover. Their coordinates are converted into the container's system, which is the one
    // frond reports in and the one the highlight boxes are measured in.
    //
    // Nothing arrives here twice: an event inside the frame is dispatched in that document and
    // does not cross the boundary, and the highlight layer takes no pointer events at all.
    const mount = mountRef.current;
    const inContainer = (event: PointerEvent) => {
      const box = mount?.getBoundingClientRect();
      return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
    };
    const marginPress = (event: PointerEvent) =>
      onPress({
        ...inContainer(event),
        pointerType: event.pointerType,
        isLink: false,
        hasSelection: selectionRef.current !== null,
      });
    const marginMove = (event: PointerEvent) => onMove(inContainer(event));
    const marginRelease = (event: PointerEvent) =>
      onRelease({
        ...inContainer(event),
        isLink: false,
        hasSelection: selectionRef.current !== null,
      });

    mount?.addEventListener("pointerdown", marginPress);
    mount?.addEventListener("pointermove", marginMove);
    mount?.addEventListener("pointerup", marginRelease);
    mount?.addEventListener("pointercancel", onCancel);

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
    document.addEventListener("pointerup", strayRelease);
    document.addEventListener("pointercancel", strayRelease);

    // The turn a press is playing out, and whether it ends in a page or back where it started.
    // Held so that the next press can land this one rather than fight it: a reader leaning on
    // the arrow key repeats faster than a turn takes, and each `beginTurn` abandons the one
    // before it — so without this they would start a turn per repeat and finish none of them,
    // and the book would sit still under a held key.
    let commanded: { turn: TurnInProgress; take: boolean } | null = null;

    /** Puts the turn in flight where it was going, now, so a new one can begin behind it. */
    const landCommand = (): void => {
      const held = commanded;
      commanded = null;
      if (held === null || !held.turn.live) return;
      held.turn.moveTo(held.take ? held.turn.extent : 0);
      if (held.take) held.turn.commit();
      else held.turn.cancel();
    };

    /**
     * A page turn nobody dragged: the page slides off and the next one follows it in.
     *
     * **The same turn the finger drives**, played by the clock instead — which is the reason
     * this is not simply `next()`. A reader on a desktop had no way to see which way the book
     * went: the page was replaced between two frames, and two pages of the same book in the same
     * typeface look alike enough that turning forward and turning back were the same event
     * (docs/specs/desktop-page-turn/spec.md).
     */
    const commandTurn = (towards: TurnDirection): void => {
      landCommand();
      const renderer = rendererRef.current;
      const edge = navRef.current?.edgeFor(towards);
      if (!renderer || edge === undefined) return;

      const turn = beginTurn(towards, edge, renderer);
      if (turn === undefined) return;

      // A page to go to but nothing laid out behind the current one: sliding it across would
      // move the page off an empty screen and then cut to its destination. It turns the plain
      // way instead — the reader gets the page they asked for without watching it arrive, which
      // is the same trade `commit()` makes. This is the window right after the book opens or its
      // settings change, before the frames either side have caught up.
      if (!turn.hasPreview && !turn.atBoundary) {
        turn.cancel();
        void (towards === "next" ? renderer.next() : renderer.previous());
        return;
      }

      const take = !turn.atBoundary;
      commanded = { turn, take };
      const end = () => {
        if (commanded?.turn === turn) commanded = null;
        if (take) turn.commit();
        else turn.cancel();
      };

      if (take) {
        slideTurn(turn, { from: 0, to: turn.extent, ms: TURN_COMMAND_MS, ease: easeInOut }, end);
        return;
      }

      // The end of the book: out and back, with nothing behind it but the paper.
      const peak = turn.extent * BOUNCE_FRACTION;
      slideTurn(turn, { from: 0, to: peak, ms: BOUNCE_MS, ease: easeOut }, () =>
        slideTurn(turn, { from: peak, to: 0, ms: BOUNCE_MS, ease: easeOut }, end),
      );
    };

    // An arrow key, or one of the two page buttons standing either side of the book. Both are
    // rendered outside this effect, so they reach it the way the handles do.
    //
    // **A page turn puts the chrome away**, whichever route asked for it — that is one half of
    // how 〈找〉 ends (CONTEXT.md 〈chrome〉). It is decided in the machine along with the turn
    // itself, so a route found later cannot turn a page with the interface still up.
    onSideRef.current = (side) => {
      send({ kind: "side", side });
    };

    async function open() {
      const record = await db.books.get(bookId);
      if (cancelled) return;
      // Stale URL (e.g. refresh after the book was deleted): back to the library.
      if (!record || record.deletedAt) {
        onClose();
        return;
      }
      if (!mountRef.current) return;
      setTitle(record.title);

      // lazy download: the shelf synced only metadata; fetch the epub on first open
      let file = record.file;
      if (!file) {
        setDownloading(true);
        try {
          file = await downloadBookFile(bookId);
        } catch (e) {
          if (!cancelled)
            setLoadError(
              e instanceof Error
                ? e.message
                : t({
                    message: "Download failed",
                    comment:
                      "Shown in place of the book when its epub could not be fetched and the failure carried no reason of its own.",
                  }),
            );
          return;
        } finally {
          if (!cancelled) setDownloading(false);
        }
        if (cancelled) return;
      }

      let book: EpubBook;
      try {
        book = await EpubBook.open(file);
      } catch (e) {
        if (!cancelled)
          setLoadError(
            e instanceof Error
              ? e.message
              : t({
                  message: "This file will not open",
                  comment:
                    "Shown in place of the book when the epub is on the device but could not be parsed.",
                }),
          );
        return;
      }
      if (cancelled || !mountRef.current) return;

      // The first two have to be settled *before* the first layout — they are part of the
      // settings handed to `attach()`. The variant decides which CJK stack the fonts resolve
      // to; the script decides how long a line may be. One sample serves all three.
      const sample = sampleText(book);
      const variant = detectVariant(book.metadata.language, sample);
      const isSimplified = variant === "simplified";
      setSimplified(isSimplified);
      const bookScript = detectScript(sample);
      setScript(bookScript);
      // The third is not urgent in the same way: the face arrives when it arrives, and the
      // book is readable in the meantime.
      const wantsFace = needsWebFont(sample);
      setWantsWebFont(wantsFace);

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
        setRtl(direction.rtl);
        const nav = createNavigator({ rtl: direction.rtl });
        navRef.current = nav;
        machineRef.current = createGestureMachine(nav, { ownSelection: ownSelectionRef.current });
      };
      applyDirection();

      const flat = flattenToc(book.toc);
      setToc(flat);
      // Held as a local as well as in state: `relocate` names the chapter for the row it
      // writes, and it fires from inside `attach()` — before any state set here has come back
      // round as a render.
      const bounds = chapterBoundaries(
        flat,
        book.readingOrder.map((section) => section.path),
      );
      setChapters(bounds);

      const saved = await recallPosition(bookId);
      if (cancelled) return;
      // What a pull is compared against until the first `relocate` names a page — and, until
      // this line runs, what its absence means is "this device does not know where it is yet",
      // which is why the offer is held back rather than made against nothing.
      positionRef.current = saved ?? null;
      // The last percentage we knew, so a `relocate` arriving before the index is built does
      // not overwrite a real reading position with 0.
      let lastPercentage = saved?.percentage ?? 0;
      // And it is where this sitting starts from: the reader carries on from where they
      // stopped, so the ground covered is measured from there rather than from the first
      // fraction the index happens to report — which may not arrive until several pages in.
      openedAtFraction = saved?.percentage ?? null;

      const anns = await readAnnotations(bookId);
      if (cancelled) return;
      setAnnotations(anns);

      const initial = frondSettings(settingsRef.current, {
        theme: themeRef.current,
        simplified: isSimplified,
        script: bookScript,
        rootFontSize: readRootFontSize(),
        // Whatever is already on the device — normally nothing on the very first book, and
        // everything on the ones after it. Either way the fetch below settles it, and the
        // settings effect applies the result.
        //
        // **Withheld from a book that does not want one**, even when the device has it: an
        // English book would otherwise be set in a CJK face and shaped with a Chinese
        // language tag, neither of which anyone asked for.
        webFonts: wantsFace ? webFontsRef.current : [],
      });
      appliedRef.current = JSON.stringify(initial);

      // **Everything the first layout depends on goes in here**: the settings, the position
      // to open at, and the margin. `start` renders the saved section directly instead of
      // laying out section 0 and jumping afterwards, and `resolveLayout` supplies the margin
      // frond asks for once it has read the writing mode and before it lays a single line —
      // so nothing reflows after the position has been restored.
      attached = await Renderer.attach(book, mountRef.current, {
        settings: initial,
        // On a touch device the browser's own selection is off entirely and this component
        // draws its own (ADR-0036). It has to be said here rather than in a stylesheet: the
        // text is inside frond's iframe, and `user-select` on anything out here reaches none
        // of it — nor does `-webkit-touch-callout`, which is what iOS raises its own menu
        // from.
        nativeSelection: !ownSelectionRef.current,
        // The one thing the margin needs and nobody here can know before the book is on
        // screen: which axis the line lies along (ADR-0012). frond asks; this answers.
        resolveLayout: (facts) =>
          frondLayout(
            settingsRef.current,
            { script: bookScript, rootFontSize: readRootFontSize() },
            facts,
          ),
        ...(saved?.cfi ? { start: { cfi: saved.cfi } } : {}),
        on: {
          load: (event) => {
            setVerticalBook(event.writingMode === "vertical-rl");
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
            setSelection((now) => (now?.drawn ? null : now));
            const percentage = at.fraction ?? lastPercentage;
            lastPercentage = percentage;
            setFraction(percentage);
            setSectionIndex(at.sectionIndex);
            setGeometry((tick) => tick + 1);

            if (at.fraction !== undefined) {
              openedAtFraction ??= at.fraction;
              leftAtFraction = at.fraction;
            }

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
            positionRef.current = position;
            recordPosition(position);
          },
          // The geometry is valid again — a resize or a settings change moves every
          // rectangle without moving the reader, so `relocate` alone would miss it.
          layout: () => setGeometry((tick) => tick + 1),
          indexed: () => setIndexed(true),
          selection: (event) => {
            if (event.cfi === undefined || event.text.trim() === "") {
              setSelection(null);
              return;
            }
            // A word the tap selected, not a passage the reader chose (#36). It arrives on
            // either side of `pointerup` depending on the browser, so it is caught here as
            // well as in the tap branch below.
            if (machineRef.current?.blamesTapForSelection(performance.now()) === true) {
              dropSelection();
              return;
            }
            // 〈標〉 displaces 〈找〉, with no exception made for either. The colour row is placed
            // against the selection's own rectangles (`toolbar-position`), and one more layer
            // for it to dodge is one more way that placement comes out wrong.
            sendChrome({ kind: "selectionArrived" });
            const container = mountRef.current?.getBoundingClientRect();
            if (!container) return;
            // The rectangles come with the event, so there is no CFI round trip here.
            const anchor = anchorFromRects(event.rects, container);
            if (!anchor) return;
            // `drawn: null` — the browser painted this one, so there is nothing of ours to put
            // on screen over it, and no handles: adjusting it is the browser's gesture too.
            setSelection({
              cfiRange: event.cfi,
              text: event.text,
              anchor,
              drawn: null,
              live: false,
            });
          },
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
            if (event.key === "ArrowLeft") onSideRef.current?.("left");
            if (event.key === "ArrowRight") onSideRef.current?.("right");
          },
          // frond reports where a link points and navigates nowhere itself. The book's own
          // table-of-contents page is the common case, and it needs no href repair now:
          // resolution happened at the parsing layer.
          linkactivate: (event) => {
            if (event.sectionIndex === undefined) return;
            void rendererRef.current?.goToSection(
              event.sectionIndex,
              event.fragment === undefined
                ? { kind: "first-page" }
                : { kind: "fragment", id: event.fragment },
            );
          },
          error: (event) =>
            setLoadError(
              t({
                message: `This section will not render: ${{ reason: event.message }}`,
                comment:
                  "Shown when one section of an otherwise readable book fails. The value is the renderer's own message and is not translated.",
              }),
            ),
        },
      });

      if (cancelled) {
        attached.destroy();
        return;
      }
      rendererRef.current = attached;
      setRenderer(attached);
    }

    // Arrow keys with focus outside the iframe. frond forwards the ones inside it (where the
    // outer document receives nothing), and this covers the other half.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      // **Unless a control is using them.** Left and right belong to whatever has the focus
      // first: they move the size slider, they open and walk the line-height options, and they choose a
      // cell in the segmented settings. Turning a page as well means every adjustment made from
      // the keyboard also moves the reader, and 〈找〉 closing on the way out takes the panel
      // with it — so the reader watches the thing they were adjusting disappear.
      //
      // `closest` rather than a tag check, because a segmented cell is a `<button>` and only its
      // group says the arrows are spoken for. This is asked on the way *up*: `keydown` is where
      // those controls act, and by the time the key is released the value has already moved.
      const target = e.target as Element | null;
      if (target?.closest?.("input, select, textarea, [role='radiogroup']")) return;

      if (e.key === "ArrowLeft") onSideRef.current?.("left");
      if (e.key === "ArrowRight") onSideRef.current?.("right");
    };
    document.addEventListener("keyup", onKeyUp);

    void open();

    return () => {
      cancelled = true;
      document.removeEventListener("keyup", onKeyUp);
      mount?.removeEventListener("pointerdown", marginPress);
      mount?.removeEventListener("pointermove", marginMove);
      mount?.removeEventListener("pointerup", marginRelease);
      mount?.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("pointerup", strayRelease);
      document.removeEventListener("pointercancel", strayRelease);
      cancelLongPress();
      handlesRef.current = null;
      navRef.current = null;
      machineRef.current = null;
      onSideRef.current = null;
      rendererRef.current = null;
      setRenderer(null);
      attached?.destroy();
      const endedAt = Date.now();
      // ponytail: <1s sessions dropped, filters StrictMode double-mount noise
      if (endedAt - startedAt >= 1000) {
        // Both ends or neither. One end alone is a displacement measured from a place nobody
        // recorded, and half of it would be read as ground covered.
        const placed = openedAtFraction !== null && leftAtFraction !== null;
        db.readingSessions.add({
          id: crypto.randomUUID(),
          bookId,
          startedAt,
          endedAt,
          startFraction: placed ? openedAtFraction : null,
          endFraction: placed ? leftAtFraction : null,
          dirtyAt: endedAt,
        });
        scheduleSync();
      }
    };
    // `t` is deliberately not a dependency. What it feeds is an error message stored in state,
    // and re-running this to refresh that wording would re-open the book — a reader who changed
    // language while looking at a failure would be sent back to page one of one that worked.
    // The cost of leaving it out is that a message already on screen keeps the language it was
    // written in until the next attempt, and changing language is a once-ever act.
  }, [bookId]);

  // Reader settings after the first layout. The comparison against what frond already has is
  // what keeps this from reflowing the book on mount (see `appliedRef`).
  useEffect(() => {
    if (!renderer) return;
    // The basis is read on every pass rather than held in state: there is no event for "the
    // reader changed their browser's default font", so the next thing that touches the
    // settings is when a change to it reaches the book. Changing it mid-book is rare enough
    // that a listener would cost more than it buys.
    const next = frondSettings(settings, {
      theme: resolvedTheme,
      simplified,
      script,
      rootFontSize: readRootFontSize(),
      webFonts: wantsWebFont ? webFonts : [],
    });
    const serialised = JSON.stringify(next);

    // This pass is the one that merely followed `attach()` — those settings, and the
    // resolver's answer from them, are already in force for the layout it just did. Laying
    // out again here would be the second layout this whole design exists to avoid.
    const observing = settledFor.current !== renderer;
    settledFor.current = renderer;

    // **The two halves of a settings change go different ways.** What is written into the
    // document goes through `applySettings`, which rebuilds it. The margin and the column
    // count do not: the resolver answers those, reading these same settings through a ref,
    // so moving the margin slider changes nothing frond can see — `relayout()` is what says
    // so, and it lays out again without a rebuild.
    if (serialised === appliedRef.current) {
      if (!observing) void renderer.relayout();
      return;
    }
    appliedRef.current = serialised;
    // No `relayout()` alongside: a rebuild ends in a mount, and a mount asks the resolver.
    void renderer.applySettings(next);
  }, [renderer, settings, resolvedTheme, simplified, script, webFonts, wantsWebFont]);

  /**
   * Fetching the face this book needs, in the background.
   *
   * Deliberately its own effect rather than part of opening the book: the book is readable
   * while this runs, and 16 MB on a phone connection is not something to hold a page turn
   * for. What applies the result is the settings effect above — `webFonts` is in its
   * dependencies, so a face arriving is a settings change like any other.
   *
   * It runs again when the reader switches serif to sans or back, because that is when the
   * other face
   * becomes the one they are looking at. A face already on the device comes back from Dexie
   * without touching the network.
   */
  useEffect(() => {
    if (!wantsWebFont) return;
    let cancelled = false;

    void (async () => {
      // Whether a face both came down the wire *and* applied, and whether one could not be
      // had. These decide the one-off toast at the end: nothing for a job that was all cache
      // (instant, silent), an applied note once a downloaded face is on the page, a failure
      // note only when nothing the reader picked could be had.
      let netApplied = false;
      let failed = false;
      try {
        // A loop over what is now one file per kind. It used to be two — Regular first, so the
        // body text arrived before the headings — and the loop is kept because the shape of
        // "fetch what this setting needs" is the setting's business rather than the count's.
        for (const font of webFontsFor(settings.fontFamily)) {
          let downloading = false;
          const loaded = await ensureWebFont(font, (status) => {
            if (cancelled) return;
            setWebFontStatus(status);
            // The trace comes up the moment a fetch reaches the wire, and is cleared once, in
            // `finally`. That used to matter across two faces, so the indicator did not flicker
            // off between Regular finishing and Bold starting; with one file it is simply where
            // the clearing belongs.
            if (status.state === "downloading") {
              downloading = true;
              setFontBusy(true);
            }
          });
          if (cancelled) return;
          if (!loaded) {
            // offline; the platform stack stands, and there is no second try this pass
            failed = true;
            break;
          }
          // Only a face that reached the wire earns the applied toast, so a cached switch stays
          // silent; a face that came from the device applies without setting this.
          if (downloading) netApplied = true;
          setWebFonts((held) => [...held.filter((f) => f.family !== loaded.family), loaded]);
        }
      } finally {
        if (!cancelled) setFontBusy(false);
      }
      if (cancelled) return;
      // One toast for the whole job. The applied note wins whenever a downloaded face is on
      // the page: the reader is reading in the face they picked, so a failure note would
      // contradict what is on screen. It is for when nothing they picked could be had at all.
      if (netApplied)
        setFontToast(webFontAppliedNote(i18n, fontFamilyLabel(i18n, settings.fontFamily)));
      else if (failed) setFontToast(i18n._(WEB_FONT_UNAVAILABLE_NOTE));
    })();

    return () => {
      cancelled = true;
    };
    // `i18n` is left out for the same reason as above: this effect fetches 16 MB, and the only
    // thing the locale feeds is the wording of a toast that clears itself after 2.6 seconds.
  }, [wantsWebFont, settings.fontFamily]);

  // The toast says its piece and clears itself: it explains the reflow, it is not a control.
  useEffect(() => {
    if (fontToast === null) return;
    const id = setTimeout(() => setFontToast(null), FONT_TOAST_MS);
    return () => clearTimeout(id);
  }, [fontToast]);

  /**
   * Listen for a position arriving from another device while this book is open.
   *
   * **An offer already standing is never taken away by a later pull** — only replaced by a
   * fresher one. It is the reader's to answer, and a banner that vanished on its own would take
   * the other device's position with it (`lib/elsewhere.ts`).
   */
  useEffect(() => {
    setElsewhere(null);
    // The previous book's position is not a yardstick for this one, and the open below will not
    // replace it for a while. Left standing, a pull landing in between would measure the new
    // book's position against the old book's page.
    positionRef.current = null;
    return subscribePulledProgress((rows) => {
      const arrived = rows.find((row) => row.bookId === bookId);
      const here = positionRef.current;
      // Nothing to measure against yet — the open is still downloading or parsing. Saying
      // nothing is right: the position is about to be picked up by the open itself, and a
      // refusal would have nothing of this device's to write in its place.
      if (arrived === undefined || here === null) return;
      const offer = positionFromElsewhere(here, arrived);
      if (offer === null) return;
      setElsewhere({ position: offer, elapsed: elapsedSince(offer.lastReadAt, Date.now()) });
    });
  }, [bookId]);

  /**
   * Re-read this book's marks when a pull has written some.
   *
   * The reader's copy was read **once**, when the book opened, so a note made on another device
   * landed in Dexie with nothing on screen mentioning it until the page was reloaded — the
   * position banner would appear and the notes stay missing, which reads as sync half working.
   *
   * **The whole table for this book**, rather than the rows that arrived: a mark deleted elsewhere
   * has to leave the panel too, and that is an absence no arriving row can express.
   *
   * **Only when something arrived**, which is what `subscribePulledAnnotations` is for. Sync
   * rounds are frequent — app open, every return to the foreground, three seconds after every page
   * turn — and nearly all of them pull nothing. Replacing the state on each would hand the
   * highlight layer a fresh array several times a minute, sending it to measure a rectangle per
   * mark and to put the layer back at rest, which mid-turn is a visible snap.
   */
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribePulledAnnotations((bookIds) => {
      if (!bookIds.has(bookId)) return;
      // Guarded like the open above: the unsubscribe below cannot recall a read already in
      // flight, and one resolving after the reader has moved to another book would list that
      // book's marks under this one.
      readAnnotations(bookId)
        .then((marks) => {
          if (!cancelled) setAnnotations(marks);
        })
        .catch(() => {
          // The next round that writes a mark re-reads, and the panel is not worth a failure the
          // reader can do nothing about.
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bookId]);

  /** Take the offer. The `relocate` that follows writes the position, as it does for any move. */
  const goElsewhere = () => {
    if (elsewhere === null) return;
    void rendererRef.current?.goToCfi(elsewhere.position.cfi);
    setElsewhere(null);
  };

  /**
   * Turn the offer down — **by writing where the reader is**, not by hiding the banner.
   *
   * The pull put the other device's position into Dexie before this banner ever appeared. Close
   * the banner without writing and the reader who said "stay here" gets that other position
   * back the next time they open the book, which is the opposite of what they pressed. Staying
   * here has to be a write, and it is the same write a page turn makes.
   */
  const stayHere = () => {
    const here = positionRef.current;
    // Never null while a banner is up — the offer is only made once this device knows where it
    // is (above), which is the same guard that keeps this from being a button that does nothing.
    if (here === null) return;
    const now = Date.now();
    const kept = { ...here, lastReadAt: now, dirtyAt: now };
    positionRef.current = kept;
    recordPosition(kept);
    setElsewhere(null);
  };

  // There is no relayout when the chrome comes up, and there must not be one: the bars are laid
  // over the book rather than beside it, so the viewer keeps its size and the book keeps its
  // pagination. Shrinking the page to make room would repaginate it under the reader — asking
  // where you are would move you.

  // The row the panel marks as "you are here", or null in the front matter before the first
  // chapter — the cover is not a chapter, and marking the first one there would be a lie.
  //
  // Exactly one row, the deepest that applies: reading a subsection marks the subsection and
  // leaves its parent chapter alone. Marking the ancestors too would put three marks on a
  // three-level book, and the reader is in one place.
  const currentTocIndex = chapterAt(sectionIndex, chapters)?.tocIndex ?? null;
  const currentItemRef = useRef<HTMLButtonElement>(null);

  // A mark nobody scrolls to is no mark at all: a long list opens at the top. Runs on open and
  // whenever the chapter changes under an open panel.
  useEffect(() => {
    if (chrome !== "toc") return;
    currentItemRef.current?.scrollIntoView({ block: "center" });
  }, [chrome, currentTocIndex]);

  // Which highlight rectangles are on the page in front of the reader.
  //
  // A layout effect because it measures: it runs after the DOM is in its new shape and
  // before the browser paints, so a page turn never shows a highlight at its old position.
  useLayoutEffect(() => {
    // **The page, not the container this layer is drawn on.** frond reports rectangles in the
    // container's coordinates, but the page is inset within it by the reader's margin, and
    // two pages are only `COLUMN_GAP` apart — so on a wide screen the head of the next page
    // lands inside the container and would be painted in this page's margin (#41). Only frond
    // can say where the page is: it is the one that turns a margin into insets and floors the
    // sizes. No page box means no section is mounted, which is also when `rectsFor` is empty.
    const page = renderer?.pageBox();
    if (!renderer || !page) {
      setPainted([]);
      paintedRef.current = [];
      return;
    }

    const next: PaintedHighlight[] = [];
    for (const annotation of annotations) {
      const marked = renderer.rectsFor(annotation.cfiRange);
      // **Two sets of boxes, and they are deliberately different.** What is painted is the
      // strip of wave beside the text, one per line; what a tap counts against is the text
      // itself, every rectangle of it — including the ruby annotation and the paragraph
      // indent, which carry no mark and are still part of the passage the reader marked.
      //
      // Highlights outside this section come back with no rectangles at all, and ones on
      // another page fall outside the page box — both are dropped by the clipping inside.
      // Keyed on the targets, not the strips: a passage whose text has all been clipped away
      // is on another page, and a mark drawn beside text that is not there is the floating
      // highlight the clipping exists to prevent.
      const targets = hitBoxes(marked, page);
      if (targets.length > 0) {
        next.push({ annotation, strips: markStrips(marked, page, verticalBook), targets });
      }
    }

    setPainted(next);
    paintedRef.current = next;
    // Freshly measured boxes are measured against the page at rest, so whatever a turn left on
    // the layer is spent. This is also the backstop for a turn abandoned from inside frond — a
    // resize or a jump ends it without the code that started it hearing about it, and both of
    // those arrive here.
    slideMarks(marksRef.current, AT_REST);
    // `verticalBook` is in here because the placement depends on it now: which edge of the
    // text a mark runs along is the axis, and a book whose writing mode arrives after the
    // first paint would otherwise keep its marks on the wrong side of the line.
  }, [renderer, annotations, geometry, verticalBook]);

  // Place the highlight toolbar once it has rendered: its measured size is what decides which
  // sides of the passage it fits beside, and where the resting line falls when none of them do.
  useLayoutEffect(() => {
    if (!selection || !toolbarRef.current) {
      setToolbarPos(null);
      return;
    }
    const el = toolbarRef.current;
    const container = mountRef.current?.getBoundingClientRect();
    // Where the two beads are, so the row can be placed off them. Only a selection we drew has
    // handles; a browser-drawn one on the desk has none to avoid.
    const ends = selection.drawn?.ends;
    setToolbarPos(
      placeSelectionToolbar(
        selection.anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        {
          vertical: verticalBook,
          handles: ends && container ? handleBoxes(ends, container) : [],
        },
      ),
    );
  }, [selection, verticalBook]);

  /**
   * Puts a selection away, in the document as well as in this component's state.
   *
   * Both halves, always. The passage is marked now (or the reader said no), and what stays
   * behind otherwise is the browser's own selection sitting under the colour — invisible as a
   * decision and very much alive as a fact: the next press reports `hasSelection`, and a press
   * that lands on a selection is the reader adjusting it, so the page would not follow it.
   */
  function dismissSelection() {
    setSelection(null);
    rendererRef.current?.clearSelection();
  }

  async function addAnnotation(color: string, withNote: boolean) {
    if (!selection) return;
    const now = Date.now();
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      bookId,
      cfiRange: selection.cfiRange,
      text: selection.text,
      note: "",
      color,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dirtyAt: now,
    };
    await db.annotations.put(annotation);
    scheduleSync();
    setAnnotations((prev) => sortByBookOrder([...prev, annotation]));
    dismissSelection();
    if (withNote) sendChrome({ kind: "openNote", id: annotation.id });
  }

  async function saveNote(id: string, note: string) {
    const now = Date.now();
    await db.annotations.update(id, { note, updatedAt: now, dirtyAt: now });
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
    sendChrome({ kind: "noteSaved" });
    scheduleSync();
  }

  async function removeAnnotation(a: Annotation) {
    // tombstone, not hard delete: otherwise the highlight resurrects on next pull
    const now = Date.now();
    await db.annotations.update(a.id, { deletedAt: now, updatedAt: now, dirtyAt: now });
    setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
    scheduleSync();
  }

  // What the top bar says the reader is in, or null in the front matter — the cover is not a
  // chapter, and naming the first one there would be a lie.
  const chapterLabel = chapterAt(sectionIndex, chapters)?.label ?? null;

  /** Raises a panel, or drops it back to the bare bar if it was already the one showing. */
  const togglePanel = (panel: PanelKind) => sendChrome({ kind: "togglePanel", panel });
  // `styles/reader.css` draws both arrangements; this only says which state the reader is in.
  const panelOpen = isPanel(chrome);

  // Where each chapter begins on the axis, for a finger to land on. The TOC says which section
  // a chapter starts at; turning that into a position takes the character counts behind the
  // whole-book index, which only frond has (`Renderer.fractionAt`). Empty until the index
  // exists, which is also while the Scrubber is disabled.
  const chapterStarts = useMemo(
    () =>
      indexed
        ? chapters
            .map((chapter) => renderer?.fractionAt(chapter.startSection))
            .filter((start): start is number => start !== undefined)
        : [],
    [chapters, renderer, indexed],
  );

  return (
    // `data-indexed` is the one fact about the whole-book index that is readable whatever state
    // the reader is in. It used to be legible from the header's percentage, and the header is
    // not on screen any more.
    <div className="reader" data-indexed={indexed} data-panel={panelOpen || undefined}>
      {/* The book. **The bars are laid over it, and a panel is laid beside it** — raising 〈找〉
          leaves the page exactly where it was, opening one of the three gives up a column and
          repaginates.

          That asymmetry is the trade ADR-0026 asks for. The six settings apply as they are
          dragged and the book above them is the preview, so a panel that covered the page was
          hiding the one thing it was opened to show. Contents and Notes pay for it: open one and the
          page numbers move, close it and they move back. If that reads badly on a real book the
          retreat is to push for Type only — and the cost of the retreat is two layouts, which is
          two sets of bugs (docs/specs/ux-replan/spec.md). */}
      <div className="reader-body">
        <div className="viewer-wrap">
          <button
            className="page-btn"
            onClick={() => onSideRef.current?.("left")}
            aria-label={
              rtl
                ? t({
                    message: "Next page",
                    comment:
                      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'next' flips for a right-opening book, so the two are chosen by direction rather than by position.",
                  })
                : t({
                    message: "Previous page",
                    comment:
                      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'previous' flips for a right-opening book, so the two are chosen by direction rather than by position.",
                  })
            }
          >
            ‹
          </button>
          <div className="viewer">
            {downloading && (
              <p className="empty">
                <Trans comment="Stands in for the book while its epub is being fetched from the server. The ellipsis is one character.">
                  Downloading the book…
                </Trans>
              </p>
            )}
            {loadError && <p className="error">{loadError}</p>}
            {/* frond's container. It sizes and paginates itself from this box. */}
            <div ref={mountRef} className="viewer-mount" />
            <HighlightLayer ref={marksRef} painted={painted} vertical={verticalBook} />
            {/* Only for a selection we drew: where the browser drew one it is already on
                screen, and a second wash over it would be twice the colour. */}
            {selection?.drawn && (
              <SelectionLayer
                rects={selection.drawn.rects}
                ends={selection.drawn.ends}
                vertical={verticalBook}
                onHandlePointer={(kind, end, event) => {
                  const box = mountRef.current?.getBoundingClientRect();
                  handlesRef.current?.(kind, end, {
                    x: event.clientX - (box?.left ?? 0),
                    y: event.clientY - (box?.top ?? 0),
                  });
                }}
              />
            )}
          </div>
          <button
            className="page-btn"
            onClick={() => onSideRef.current?.("right")}
            aria-label={
              rtl
                ? t({
                    message: "Previous page",
                    comment:
                      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'previous' flips for a right-opening book, so the two are chosen by direction rather than by position.",
                  })
                : t({
                    message: "Next page",
                    comment:
                      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'next' flips for a right-opening book, so the two are chosen by direction rather than by position.",
                  })
            }
          >
            ›
          </button>
        </div>
      </div>

      {/* 〈找〉, laid over the book in one box. The three pieces are ordered by CSS rather than
          by this file: the entries sit above the Scrubber on a hand-held and up in the top bar
          everywhere else, and neither arrangement is a different component (ADR-0023).

          **It stays in the tree while 〈讀〉 stands**, parked off the edges it came from, because
          a state that is unmounted cannot leave: the bars would blink out mid-slide. `data-up`
          is the whole of the state as CSS reads it — down, they are outside the reader's box and
          `visibility: hidden`, so nothing on this layer is reachable by a pointer, by the
          keyboard or by a screen reader (`styles/reader.css`). */}
      <div className="chrome" data-up={chromeUp || undefined}>
        {/* Which book, and the way back to the shelf. **Not which chapter** — that went down to
            the Scrubber's row, where "where am I" is already being answered by a rail; the two
            were the same question asked at opposite edges of the screen. What is left here is
            the pair that does not change while the book is open, which is also why this bar and
            the entries below it can share one line once the window is wide enough. */}
        <header className="chrome-top" data-testid="chrome-top">
          <button className="ghost" onClick={onClose}>
            <Trans comment="The way out of the reader, in the top bar. The ‹ is part of the label. 'Shelf' is the screen listing every book — the app's home.">
              ‹ Shelf
            </Trans>
          </button>
          <strong className="reader-title">{title}</strong>
        </header>

        <nav className="chrome-nav" data-testid="chrome-nav">
          <button
            className={chrome === "toc" ? "ghost active" : "ghost"}
            onClick={() => togglePanel("toc")}
          >
            <Trans comment="Bar button raising the panel that lists the book's chapters. Same word as that panel's own title.">
              Contents
            </Trans>
          </button>
          <button
            className={chrome === "notes" ? "ghost active" : "ghost"}
            onClick={() => togglePanel("notes")}
          >
            <Trans comment="Bar button raising the panel that lists what the reader has marked. The number in brackets is how many marks this book carries.">
              Notes ({markCount})
            </Trans>
          </button>
          <button
            className={`ghost${chrome === "layout" ? " active" : ""}`}
            onClick={() => togglePanel("layout")}
          >
            {/* A line sweeping under the word, only while a face is on the wire and the panel
                is shut. With it open the running line inside carries the progress, and two
                indicators for one download would be two frames fighting.

                Under this button rather than around it because what it is busy doing is
                resetting type, and a line travelling under a word is what that looks like. */}
            <span className={fontBusy && chrome !== "layout" ? "busy-underline" : undefined}>
              <Trans comment="Bar button raising the panel holding the six typography settings. Same word as that panel's own title.">
                Type
              </Trans>
            </span>
          </button>
          {/* The same drawer the shelf's ⋯ opens, over the book instead of over the shelf. It
              carries the book id even here (`#/book/abc?d=about/abc`), so reading the hash never
              means looking at what is underneath it.

              It travels with the three entries rather than with the title: it is a fourth door,
              not a piece of the heading. That also keeps the top bar down to two things, which
              is what lets a phone give the title a whole line (#D14). */}
          <button
            className="ghost reader-about"
            onClick={onOpenAbout}
            aria-label={t({
              message: "About this book",
              comment:
                "Screen-reader name for the button in the reader's bar that opens the drawer describing the open book.",
            })}
            data-testid="reader-about"
          >
            ⋯
          </button>
        </nav>

        {/* A position from another device, and the two ways of answering it.

            **In the chrome's grid but not one of its bars**: it never slides, never hides, and
            is not part of 〈找〉 — the reader did not ask for it and cannot dismiss it with a
            tap on the page. It sits in a row of its own under the top bar, which is a fixed
            place in both states, so raising the chrome does not move it and lowering the chrome
            does not put it under anything. The cost is a bar's worth of space above it while
            the chrome is down, which reads as an inset from the top edge.

            `role="status"` rather than an alert: it is worth reading out when the reader gets
            to it, and worth nothing interrupting them for. */}
        {elsewhere !== null && (
          <div className="elsewhere" role="status" data-testid="elsewhere">
            <p className="elsewhere-line">
              {elsewhere.position.chapterLabel === null ? (
                <Trans comment="Banner over the book, when the same book was read to a different place on another of the reader's devices and that place cannot be named as a chapter. The value is a whole number. 'somewhere else' is deliberately vague — Tidemarks does not know which device it was.">
                  You were reading at {Math.round(elsewhere.position.percentage * 100)}% somewhere
                  else
                </Trans>
              ) : (
                <Trans comment="Banner over the book, when the same book was read to a different place on another of the reader's devices. The value is the chapter's own name, taken from the book — it is in the book's language and is never translated. 'somewhere else' is deliberately vague: Tidemarks does not know which device it was.">
                  You were reading “{elsewhere.position.chapterLabel}” somewhere else
                </Trans>
              )}
            </p>
            {/* **How long ago goes, how far in stays** — the span is what a narrow screen drops
                (`styles/reader.css`). The sentence names a chapter, and a chapter can run for
                thirty pages: without the percentage a reader already inside that chapter is
                offered a move to somewhere the words on screen cannot tell apart from where they
                are. How long ago is the part that can be spared, and it is also the part whose
                length decides whether this fits beside the answers.

                Beside the sentence rather than under it, which is a row saved everywhere — and
                on a phone it is the row that keeps the banner off a fifth of the screen. */}
            <p className="elsewhere-when">
              <span className="elsewhere-elapsed">{elsewhereWhen(i18n, elsewhere.elapsed)} · </span>
              {Math.round(elsewhere.position.percentage * 100)}%
            </p>
            {/* **The pair is one thing and wraps as one.** Left loose among the other pieces, a
                393px screen fitted the timestamp and 〈Go there〉 on one row and pushed 〈Stay
                here〉 onto another — two answers to one question, on separate lines, one of them
                looking like the answer to something else. */}
            <div className="elsewhere-actions">
              <button className="primary" onClick={goElsewhere}>
                <Trans comment="Button on the banner about a position read on another device: moves the book to that position. Short — it sits beside 'Stay here'.">
                  Go there
                </Trans>
              </button>
              <button className="ghost" onClick={stayHere}>
                <Trans comment="Button on the banner about a position read on another device: keeps the page currently on screen, and makes this device's position the one that wins. Short — it sits beside 'Go there'.">
                  Stay here
                </Trans>
              </button>
            </div>
          </div>
        )}

        {/* The book, between the two bars. It catches nothing — the pointer goes through to
            the page underneath, which is what lets a tap anywhere put the chrome away. */}
        <div className="chrome-gap" />

        {/* Where the reader is, in the two ways it can be said: the rail, and the chapter in
            words underneath it. They were at opposite edges of the screen and they are one
            question, so they are one bar now.

            **The rail takes the top of the bar and the chapter takes the bottom**, which is the
            order that keeps a draggable control out of the strip both hand-held platforms own
            for their own gestures — and Android will not give that strip back for the asking
            (docs/specs/reader-chrome-layers/spec.md). Written as DOM order rather than as CSS
            `order`, so what a thumb reaches for and what a tab stop or a screen reader arrives
            at stay the same sequence. The chapter is the one that can sit low: nothing drags it,
            so a stray swipe across it costs nothing.

            **It keeps its place under a panel on a desk and steps aside for one on a phone.**
            Never displacing it was the rule, and the reason still holds where there is room for
            both — the Scrubber and Contents answer "where do I want to be" two ways, and taking one
            away to offer the other makes the reader hold on to a percentage they only glanced
            at. On a hand-held there is no version of "both" that leaves either legible: three
            stacked layers left the book a quarter of the screen and the panel still scrolling
            (#160). So the rule is the desk's now (docs/specs/ux-replan/spec.md). */}
        <div className="chrome-bottom" data-testid="chrome-bottom">
          <Scrubber
            fraction={fraction}
            rtl={rtl}
            disabled={!indexed}
            chapterFor={(f) => {
              const at = renderer?.locate(f);
              return at ? (chapterAt(at.sectionIndex, chapters)?.label ?? null) : null;
            }}
            chapterStarts={chapterStarts}
            onCommit={(f) => void renderer?.goToFraction(f)}
          />
          {/* **The row is always here; the words are not.** Saying nothing when there is nothing
              to say still holds — a cover
              belongs to no chapter and this says nothing there — but it says nothing in a line
              that is already the right height, rather than by taking the line away.

              Two things break if the row can vanish. The bar loses a line, which drops the rail
              back into the strip the whole arrangement exists to clear; and it does so exactly
              as the reader turns off the cover into the first chapter, so the control under
              their thumb jumps while they are reaching for it. Neither is visible in a
              screenshot of either state on its own. */}
          <span
            className="reader-chapter"
            data-testid="reader-chapter"
            aria-hidden={chapterLabel === null || undefined}
          >
            {chapterLabel}
          </span>
        </div>
      </div>

      {/* The room a panel is drawn into, and the one thing about it that is not CSS: it is a
          box of the reader's own rather than the shelf's `<body>`, so a panel's edges are this
          reader's edges in both arrangements.

          It used to be `.chrome-gap` — the book's room between the bars — because a panel then
          had to stop short of the Scrubber. Neither arrangement wants that now: on a desk the
          panel is a full-height column beside the bars, and on a hand-held the bars have gone.
          Naming its own box also keeps it out of `.chrome`, which is the layer that slides. */}
      <div className="panel-host" ref={panelHostRef} />

      {/* **One panel, three faces.** It used to be three `<Panel>`s, and the three were exclusive
          in `chrome` but not in the DOM: pressing Notes while Type stood left two drawers changing
          state in the same frame, and the outgoing one's `onClose` — which did not ask whether it
          was still the one showing — wrote `"up"` over the panel that had just opened. What the
          reader saw was the whole column closing, and a second press to get where they asked to
          go the first time.

          Merging them ends that by construction rather than by a guard: switching never closes
          anything now (`open` stays true across it), so there is no close for a stale handler to
          send. It is also what makes switching free — the popup is not remounted, so it does not
          replay its entrance, and the column it stands in never moves. */}
      <Panel
        open={panelOpen}
        onClose={() => sendChrome({ kind: "panelDismissed" })}
        title={PANEL_FACES[panelKind].title}
        testId={PANEL_FACES[panelKind].testId}
        container={panelHostRef}
      >
        {panelKind === "toc" && (
          <div className="panel-list">
            {toc.map((item, i) => {
              const isCurrent = i === currentTocIndex;
              return (
                <button
                  key={i}
                  ref={isCurrent ? currentItemRef : undefined}
                  className={isCurrent ? "toc-item current" : "toc-item"}
                  aria-current={isCurrent ? "location" : undefined}
                  style={{ paddingLeft: `${0.75 + item.depth * 1}rem` }}
                  disabled={item.path === ""}
                  onClick={() => {
                    void renderer?.goTo({ path: item.path, fragment: item.fragment });
                    sendChrome({ kind: "jumped" });
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {panelKind === "notes" && (
          <div className="panel-list">
            {annotations.length === 0 && (
              <p className="empty">
                <Trans comment="The whole of the notes panel when nothing has been marked in this book. Two short sentences: what is true, then what to do about it.">
                  This book is unmarked. Select a passage to leave a mark.
                </Trans>
              </p>
            )}
            {annotations.map((a) => (
              <AnnotationItem
                key={a.id}
                annotation={a}
                editing={editingId === a.id}
                onJump={() => {
                  void renderer?.goToCfi(a.cfiRange);
                  sendChrome({ kind: "jumped" });
                }}
                onEdit={() => sendChrome({ kind: "editNote", id: a.id })}
                onSave={(note) => saveNote(a.id, note)}
                onRemove={() => removeAnnotation(a)}
              />
            ))}
          </div>
        )}

        {/* Six settings, one record, every book. They are in the reader's panel rather than only
            in 〈設定〉 because this is the one place with a preview: what the panel leaves showing
            is the real page, resetting as the reader drags (ADR-0026). */}
        {panelKind === "layout" && (
          <TypographyForm
            settings={settings}
            onChange={onSettingChange}
            onReset={onResetSettings}
            verticalBook={verticalBook}
            webFontStatus={wantsWebFont ? webFontStatus : null}
          />
        )}
      </Panel>

      {/* 〈標〉 waits for the finger to lift. While it is still down the reader has the wash and
          the two handles and nothing else — a colour row raised mid-drag would sit under the
          finger that raised it and chase the selection across the page (CONTEXT.md 〈chrome〉). */}
      {selection && !selection.live && (
        <div
          ref={toolbarRef}
          className="highlight-toolbar"
          style={
            toolbarPos ? { left: toolbarPos.left, top: toolbarPos.top } : { visibility: "hidden" }
          }
        >
          {/* Two groups rather than six children, so the rule between them has a side to sit on
              whichever way the bar is laid out. On a phone the bar is two rows and the rule is
              the seam between them; wider, it is one row and the rule stands up (`styles/book.css`). */}
          <div className="mark-inks">
            {MARKS.map(({ name, label }) => {
              const inkLabel = t({
                message: `Mark in ${{ ink: i18n._(label) }}`,
                comment:
                  "Name of one of the four ink swatches on the selection bar. The value is a pigment name — Indigo, Ochre, Moss or Soot as translated elsewhere in this catalog.",
              });
              return (
                <button
                  key={name}
                  className="swatch"
                  style={{ "--mark": markVar(name) } as CSSProperties}
                  title={inkLabel}
                  aria-label={inkLabel}
                  onClick={() => addAnnotation(name, false)}
                />
              );
            })}
          </div>
          <div className="mark-actions">
            <button onClick={() => addAnnotation(DEFAULT_MARK, true)}>
              <Trans comment="Button on the selection bar: mark the passage and open a note on it in one action, rather than marking and then reopening it to write.">
                Mark and note
              </Trans>
            </button>
            <button onClick={dismissSelection}>
              <Trans comment="Button on the selection bar: drop the selection without marking anything.">
                Cancel
              </Trans>
            </button>
          </div>
        </div>
      )}
      {/* The one-off note that explains the reflow after the fact — applied, or could not be
          had. `role="status"` so a screen reader hears it; it clears itself (FONT_TOAST_MS). */}
      {fontToast !== null && (
        <div className="font-toast" role="status">
          {fontToast}
        </div>
      )}
    </div>
  );
}

function AnnotationItem({
  annotation,
  editing,
  onJump,
  onEdit,
  onSave,
  onRemove,
}: {
  annotation: Annotation;
  editing: boolean;
  onJump: () => void;
  onEdit: () => void;
  onSave: (note: string) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(annotation.note);
  useEffect(() => {
    if (editing) setDraft(annotation.note);
  }, [editing, annotation.note]);

  return (
    <div className="annotation-item" style={{ borderLeftColor: markVar(annotation.color) }}>
      {/* **A real button, and the panel it sits in is why.** Base UI's drawer claims a press
          that does not land on something interactive, so that a swipe anywhere on the panel
          dismisses it — and claiming it means capturing the pointer, which retargets the
          `click` to the panel. A quote that was only a styled `<blockquote>` therefore never
          heard its own click on a desk. It still worked under a finger, because the swipe
          takes no pointer capture there, and that is the shape the report had: jumping works
          on a phone and does nothing on a desktop.

          `button` is one of the elements the drawer stands aside for
          (`button,a,input,select,textarea,label,[role="button"]`), so this is the fix and the
          keyboard route in one — the quote was not reachable by tab either. */}
      <button
        type="button"
        className="annotation-quote"
        onClick={onJump}
        title={t({
          message: "Jump to this passage",
          comment:
            "Tooltip on a quoted passage in the notes panel. Clicking it takes the reader to where that passage is in the book.",
        })}
      >
        {annotation.text}
      </button>
      {editing ? (
        <div className="note-editor">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t({
              message: "Note…",
              comment:
                "Placeholder in the empty note box under a marked passage. The ellipsis is one character.",
            })}
            autoFocus
          />
          <button onClick={() => onSave(draft)}>
            <Trans comment="Button that commits the note being typed under a marked passage.">
              Save
            </Trans>
          </button>
        </div>
      ) : (
        annotation.note && <p className="note-text">{annotation.note}</p>
      )}
      <div className="annotation-actions">
        {!editing && (
          <button onClick={onEdit}>
            {annotation.note ? (
              <Trans comment="Button under a marked passage that already carries a note: opens it for changing.">
                Edit note
              </Trans>
            ) : (
              <Trans comment="Button under a marked passage with no note yet: opens an empty note box.">
                Add note
              </Trans>
            )}
          </button>
        )}
        <button onClick={onRemove}>
          <Trans comment="Button under a marked passage: removes the mark and any note on it.">
            Delete
          </Trans>
        </button>
      </div>
    </div>
  );
}
