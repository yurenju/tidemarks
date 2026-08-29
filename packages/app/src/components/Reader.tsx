import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EpubBook, parseCfi, sectionIndexOf } from "@yurenju/frond/epub";
import {
  Renderer,
  type PageOffset,
  type RenderLocation,
  type RendererStart,
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
import { entersVisit, leavesVisit } from "../lib/visit";
import type { At, Select } from "../lib/route";
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
import { BOOK_KEEPS_A_COLUMN, useMediaQuery } from "../lib/media";
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
  textBoxes,
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
 * The opening guess at whether the reader's selection is ours to draw, before any pointer has
 * said anything (`notePointer` is what settles it after that).
 *
 * **A guess, because no media query can do better.** A machine with both a touchscreen and a
 * mouse reports `(pointer: coarse)`, and — measured on one — `(any-pointer: fine)` false as
 * well: as far as CSS is concerned that mouse does not exist, so no query tells such a machine
 * from a phone. Which is why the question is not settled here.
 *
 * It is still asked, and coarse still means ours, because the first gesture happens before the
 * first answer: on a phone that gesture is a long press, and a long press over a selectable
 * document is the iOS magnifier ADR-0036 exists to remove. Guessing coarse costs a desk nothing —
 * the mouse corrects it on its way to the text — while guessing fine would cost a phone the one
 * gesture that cannot be taken back.
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
          "On the banner naming the reader's place in the book: that place was read less than a minute ago. Also what a position written slightly in the future says, since two devices' clocks need not agree.",
      }),
    );
  }
  const { count } = elapsed;
  if (elapsed.unit === "minutes") {
    return i18n._(
      msg({
        message: plural(count, { one: "# minute ago", other: "# minutes ago" }),
        comment:
          "On the banner naming the reader's place in the book: how long ago it was read. Whole minutes, under an hour.",
      }),
    );
  }
  if (elapsed.unit === "hours") {
    return i18n._(
      msg({
        message: plural(count, { one: "# hour ago", other: "# hours ago" }),
        comment:
          "On the banner naming the reader's place in the book: how long ago it was read. Whole hours, under a day.",
      }),
    );
  }
  return i18n._(
    msg({
      message: plural(count, { one: "# day ago", other: "# days ago" }),
      comment:
        "On the banner naming the reader's place in the book: how long ago it was read. Whole days.",
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
async function readAnnotations(bookId: string): Promise<Annotation[]> {
  const rows = await db.annotations.where("bookId").equals(bookId).toArray();
  return sortByBookOrder(rows.filter((a) => !a.deletedAt));
}

export default function Reader({
  bookId,
  openAt,
  select,
  handles,
  onAt,
  onClose,
  onOpenAbout,
  settings,
  onSettingChange,
  onResetSettings,
  resolvedTheme,
  onChromeChange,
}: {
  bookId: string;
  /**
   * Where to open, when the address named somewhere in particular (`?at=`, `lib/route.ts`).
   *
   * Tapping a passage on the shelf's revisit card means "put me back where this came from",
   * which the saved position cannot answer — it is wherever they stopped reading, and the
   * passage may be a hundred pages behind it. A hand-written address is the same question asked
   * by whoever wants a particular page on screen without turning to it.
   *
   * A `cfi:` is given to frond's `start`, so the page arrives already in the right place. The
   * other two cannot be: a chapter offset and a whole-book fraction are both anchors frond only
   * applies once a section is mounted, and a fraction needs the whole-book index as well. Those
   * two jump after the first layout, which is a second layout of the same section rather than
   * the mount-then-jump `start` exists to avoid.
   *
   * `undefined` for every other way in, and the saved position stands. **It does not become the
   * saved position**: opening a card is a visit, and the reader's place in the book is still
   * where they left it until they read past it (`lib/visit.ts`).
   */
  openAt?: At;
  /**
   * A passage to arrive with already selected (`?select=`, `lib/route.ts`), applied once the
   * book has finished arriving wherever `openAt` sent it.
   *
   * What it is for is everything downstream of a selection — the colour row, and the mark a
   * press on it draws. Reaching that state otherwise means simulating a drag, and a drag lands
   * on a different number of characters every time it runs.
   */
  select?: Select;
  /**
   * Draw the selection ourselves, handles and all, instead of letting the browser select
   * (`?handles=1`). Nothing without `select`.
   */
  handles?: boolean;
  /**
   * Reports a place the reader jumped to inside the book, so the address bar can follow it and
   * the page on screen is one they can copy out and send to someone.
   *
   * Only the jumps that name a passage — a note's source. Page turns say nothing: the address is
   * read once when the book opens (`lib/route.ts`), and a bar that rewrote itself every turn
   * would fill the history with pages.
   */
  onAt?: (at: At) => void;
  onClose: () => void;
  /** Opens 〈書的詳情〉 over the book (`#/book/<id>?d=about/<id>`). */
  onOpenAbout: () => void;
  /** The one record every book renders from. Adjusting it here adjusts every book (ADR-0005). */
  settings: ReaderSettings;
  onSettingChange: (patch: Partial<ReaderSettings>) => void;
  onResetSettings: () => void;
  resolvedTheme: "light" | "dark";
  /**
   * Says whether the chrome is standing, so the platform's system bar can take the colour of
   * whatever is under it (`App.tsx`). Reported rather than read from here because that colour
   * has to have one writer, and on every other screen the answer is `false`.
   */
  onChromeChange: (up: boolean) => void;
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
  // Whether the book is still on screen with a panel up. Only `notePressed` asks (`lib/media.ts`).
  const bookKeepsAColumn = useMediaQuery(BOOK_KEEPS_A_COLUMN);
  const { chrome, panelKind, editing: editingId, selected: selectedNoteId } = chromeState;
  const chromeUp = chrome !== "down";
  // Told upward so the system bar can match what is under it, and told on the way out too: a
  // reader who leaves a book with the chrome up is going back to a shelf that has no chrome.
  useEffect(() => {
    onChromeChange(chromeUp);
    return () => onChromeChange(false);
  }, [chromeUp, onChromeChange]);

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
   * The progress a visit is defending, or `null` while the reader is simply reading.
   *
   * Set when they go back to a marked passage, and it holds what they had reached until they
   * read past it again (`lib/visit.ts`). While it is set, `positionRef` above is frozen on it:
   * the screen has moved, the reader's place in the book has not, and it is the place that a
   * position arriving from another device is measured against.
   */
  const visitRef = useRef<Progress | null>(null);
  /**
   * The same visit again, in the one form the screen can draw from.
   *
   * A ref cannot raise a mark on the Scrubber — nothing renders when it changes — so the visit
   * is held twice, and `setVisit` below is the only writer of either. Two names for one fact is
   * a thing to be suspicious of; the alternative is worse. `visitRef` is read inside frond's
   * `relocate`, a callback that closed over its scope pages ago and needs the value as it is
   * *now*, which is exactly what state cannot give it.
   */
  const [visit, setVisitState] = useState<Progress | null>(null);
  /** Enter a visit, or leave one. Both copies move together or neither does. */
  const setVisit = (kept: Progress | null) => {
    visitRef.current = kept;
    setVisitState(kept);
  };
  /**
   * The last position the screen reported, visit or not.
   *
   * Two refs rather than one because a visit splits the question in two: `positionRef` is what
   * this device claims about the book, and this is where the reader is looking. 〈Stay here〉
   * needs the second — during a visit the first is a hundred pages away, and writing it back
   * would be the button doing nothing at all.
   */
  const screenRef = useRef<Progress | null>(null);
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
   * Whether the pointer in the reader's hand gets the selection we draw (ADR-0036).
   *
   * The opening guess, from the media query, and then whatever the pointers have said since
   * (`notePointer`). A ref rather than state because nothing renders from it — it decides what a
   * gesture means and what the book's `user-select` is, and both of those are read at the moment
   * the pointer moves, not at the next paint.
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
  // Whether the book has reached the place the address asked for. Only interesting while an
  // `?at=` is in play, and it is published on the reader as `data-at` because **there is no
  // other way to ask**: a `frac:` lands two layouts after the one `attach()` resolves on, so a
  // book that has arrived and one still on its way look identical from outside. Both readers of
  // it are automated — `tests/browser/support/library.ts` and whoever is driving the app by hand
  // (`docs/agents/verify.md`) — and neither can wait for a moment nothing announces.
  const [arrived, setArrived] = useState(false);
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
    // A visit belongs to the book it was made in. Left standing, the next book would open with
    // the last one's page as the progress it was defending, and nothing in it would ever be
    // written.
    setVisit(null);
    screenRef.current = null;
    setIndexed(false);
    setArrived(false);
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
     * Puts the passage `?select=` named on screen already selected, so the colour row is up and
     * the next press draws a mark (#128, `lib/route.ts`).
     *
     * This half is only about **finding the passage**; `placeSelection` below puts it on screen.
     * A phrase has to be looked for and can fail to be there at all, which a CFI cannot — that
     * is the whole of the difference between the two spellings, and one line later they meet.
     *
     * Which route draws it is `handles`, and the default is the browser's own **at every window
     * size**. On a phone-sized window that overrides what the media query decided, which is the
     * point: the alternative default puts nothing on screen and says nothing about why.
     *
     * ⚠️ **The route this forces holds only until the next press.** `notePointer` flips it back
     * on any pointer event, so a tap after this takes the selection away on a touch window.
     * Nothing guards against it: the caller here is an address nobody types while also using the
     * book, and a guard would be a second answer to "which route are we on" for the reader's own
     * finger to disagree with.
     *
     * Failures say so in the console and leave the book open where it is. Nothing is put on
     * screen: the only way to ask for this is to type it, so whoever gets it wrong is looking at
     * the console already — and a message on screen would be app text, which means three
     * catalogues (ADR-0031) for a path no reader ever reaches.
     */
    function applySelect(renderer: Renderer, select: Select, handles: boolean): void {
      if (select.kind === "text") {
        const found = renderer.findText(select.text);
        if (found === undefined) {
          console.warn(`?select=: "${select.text}" is not in the section on screen`);
          return;
        }
        return placeSelection(renderer, found, handles);
      }
      placeSelection(renderer, select.cfi, handles);
    }

    /**
     * Puts a passage on screen as a selection, by whichever of the two routes was asked for.
     *
     * **The geometry is asked for first on both routes**, so a range that resolves to nothing at
     * all is reported rather than handed on: `showRange` drops a range with no rectangles, and it
     * does so *after* having put 〈找〉 away, which would leave a bare page and no account of why.
     *
     * ⚠️ **It does not tell "on this page" from "further down this section".** `rectsFor` reports
     * true geometry wherever the passage is — clipping is the consumer's policy (frond ADR-0002)
     * — so a phrase found three pages on comes back with rectangles and gets selected, with the
     * colour row anchored off the page. Measured, both routes behave that way. Which page the
     * reader lands on is `?at=`'s answer, not this one's, so nothing here overrides it.
     */
    function placeSelection(renderer: Renderer, cfi: string, handles: boolean): void {
      const facts = renderer.rangeFactsFor(cfi);
      if (facts === undefined || facts.rects.length === 0) {
        console.warn(`?select=: ${cfi} names nothing in the section on screen`);
        return;
      }

      // **Whichever route is asked for is forced on**, rather than only the native one. The two
      // are chosen by pointer type, and neither answer is the one this address wants: on a fine
      // pointer the drawn route would lay our wash over a document the browser can still select
      // natively, and the reader's next drag would paint a second selection under the first —
      // the "book selecting two ways at once" `notePointer` exists to prevent.
      ownSelectionRef.current = handles;
      renderer.setNativeSelection(!handles);

      if (handles) {
        // The one entry the reader's own long press goes through, so what is on screen is what a
        // finger produces — the collapse of 〈找〉, both coordinate systems, the handles.
        showRange(facts, false);
        return;
      }

      renderer.selectRange(cfi);
    }

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
     * Which of the two selections this pointer gets, from the pointer itself.
     *
     * ADR-0036 splits on the pointer — a finger gets the one we draw, a mouse gets the browser's,
     * and a machine with both takes each gesture as it comes. This is the only place that can see
     * which is in the reader's hand. The media query cannot: a touchscreen desktop reports no
     * fine pointer at all, so it reads as a phone, and a reader with a mouse there was left with
     * neither selection — the book unselectable, and the long press answering only to a finger.
     *
     * **Turning it back on is the direction that has to be earned, and only a mouse earns it.**
     * A selectable document under a finger is the iOS magnifier this all exists to remove, and
     * iOS raises none for a mouse. The other direction is closed at the finger's own
     * `pointerdown`, half a second before the long press it would spoil.
     *
     * A pen counts as a finger, which the `!==` decides and ADR-0036 does not: it splits finger
     * from mouse and a stylus is neither. It goes this side because a stylus on a tablet is held
     * like a finger and reaches the same book — and because this side is the one that is safe to
     * be wrong about, being the side that makes nothing selectable.
     *
     * **Turning off is not the same as undoing.** ⚠️ Whether `user-select: none` collapses a
     * selection that is already standing is **unmeasured across the three engines** — the same
     * caveat frond carries on the neighbouring question (`section-view.ts`'s `suppressSelection`,
     * where the documentation turned out to be wrong once already). So the browser's own
     * selection is cleared on the way in rather than assumed gone, or a long press would paint
     * our wash and beads over a highlight that is still there, which is the book selecting two
     * ways at once. The clear costs nothing where an engine had already collapsed it, and it is
     * the whole of the fix where one had not. Nothing is cleared on the way out: the reader who
     * chose a passage with a finger reaches for the mouse to press a colour, and that reach
     * crosses the book — dropping it there would take the passage away on the way to marking it.
     */
    const notePointer = (pointerType: string) => {
      const ours = pointerType !== "mouse";
      if (ours === ownSelectionRef.current) return;
      ownSelectionRef.current = ours;
      rendererRef.current?.setNativeSelection(!ours);
      if (ours) rendererRef.current?.clearSelection();
    };

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
      notePointer(event.pointerType);
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
      notePointer(event.pointerType);
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
    const marginMove = (event: PointerEvent) =>
      onMove({ ...inContainer(event), pointerType: event.pointerType });
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
        machineRef.current = createGestureMachine(nav, {
          ownSelection: () => ownSelectionRef.current,
        });
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
      // The position the last `relocate` reported, so the next one can be asked whether anything
      // actually moved. See the note in that handler.
      let lastCfi: string | undefined;
      // And it is where this sitting starts from: the reader carries on from where they
      // stopped, so the ground covered is measured from there rather than from the first
      // fraction the index happens to report — which may not arrive until several pages in.
      openedAtFraction = saved?.percentage ?? null;

      // **A passage asked for from the shelf opens a visit** — what they had reached is still
      // theirs (`lib/visit.ts`). Decided here, before `attach()`, because the layout it is
      // about emits the `relocate` that would otherwise write the passage over it.
      //
      // The page compared against is the stored one, and this is the single place that has no
      // choice: the book has not laid out yet, so there is no `renderer.location` to ask. It
      // describes whichever device and window last read this book, which is close enough for
      // the question being asked — whether the passage is somewhere the reader had got to.
      //
      // Only a `cfi:` address: it is the one that names a passage. A chapter or a fraction is a
      // place, and going to a place is reading, not visiting one of your own marks.
      if (
        openAt?.kind === "cfi" &&
        saved !== undefined &&
        entersVisit(saved.pageRange, openAt.cfi)
      ) {
        setVisit(saved);
      }

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
        // Where the selection we draw is the one in force, the browser's own is off entirely
        // (ADR-0036). It has to be said here rather than in a stylesheet: the text is inside
        // frond's iframe, and `user-select` on anything out here reaches none of it — nor does
        // `-webkit-touch-callout`, which is what iOS raises its own menu from. This is only the
        // opening answer; `notePointer` moves it as the reader changes hands.
        nativeSelection: !ownSelectionRef.current,
        // The one thing the margin needs and nobody here can know before the book is on
        // screen: which axis the line lies along (ADR-0012). frond asks; this answers.
        resolveLayout: (facts) =>
          frondLayout(
            settingsRef.current,
            { script: bookScript, rootFontSize: readRootFontSize() },
            facts,
          ),
        // An address beats the saved position, and only for this layout: `positionRef` above
        // still holds where the reader actually was, so the sitting and the next pull are
        // measured against that and not against where they looked.
        ...startFor(openAt, saved?.cfi, book.readingOrder.length),
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
            // nothing recomputes them (the `geometry` effect covers painted marks only). Visible
            // rather than silent, and far rarer than the case it fixes.
            if (at.cfi !== lastCfi) setSelection((now) => (now?.drawn ? null : now));
            lastCfi = at.cfi;
            const percentage = at.fraction ?? lastPercentage;
            lastPercentage = percentage;
            setFraction(percentage);
            setSectionIndex(at.sectionIndex);
            setGeometry((tick) => tick + 1);

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
            screenRef.current = position;

            // **A visit moves the screen and nothing else.** Everything above this line is
            // what the reader can see and has to keep up; everything below it is the claim
            // that this is where they are in the book, and going back to a marked passage is
            // not that claim (`lib/visit.ts`). Turning pages around the passage lands here
            // too, and is refused for the same reason.
            //
            // **Ending one takes nothing off the book**: all a visit puts on screen is the
            // Scrubber's mark (ADR-0040), which goes when `visit` does, one line below. A banner
            // standing at this moment arrived from another device while the visit was on, and it
            // is an offer nobody has answered — reading on is not an answer to it.
            const kept = visitRef.current;
            if (kept !== null) {
              if (!leavesVisit(kept, position)) return;
              setVisit(null);
            }

            // Under the same gate: a visit is not ground covered, and counting the minutes
            // spent in it against a displacement of zero would make the shelf report the
            // reader as slower than they are (`lib/stats.ts`). A sitting spent entirely in one
            // leaves both ends null, which is the shape that file already drops.
            if (at.fraction !== undefined) {
              openedAtFraction ??= at.fraction;
              leftAtFraction = at.fraction;
            }

            positionRef.current = position;
            recordPosition(position);
          },
          // The geometry is valid again — a resize or a settings change moves every
          // rectangle without moving the reader, so `relocate` alone would miss it.
          layout: () => setGeometry((tick) => tick + 1),
          indexed: () => {
            setIndexed(true);
            indexIsBuilt();
          },
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
      // Whatever the pointers said while the book was being built. The margin's listeners are
      // live from the first render, but `notePointer` had no renderer to tell — and the answer
      // frond opened with was read at the top of `attach`, several hundred ms of iframe, fonts
      // and first layout ago. A reader who clicked a book in the library has their cursor over
      // this very area while it loads, so the disagreement this closes is the ordinary case,
      // not a contrived one. No-ops when nothing moved.
      attached.setNativeSelection(!ownSelectionRef.current);
      setRenderer(attached);

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

      // **After the jumps, not with them.** A selection is geometry, and `showRange` drops a
      // range with no rectangles — until the two jumps above have landed, the passage is not on
      // the page in front of anyone and both routes would come back empty.
      if (select) applySelect(attached, select, handles === true);

      // The address has been spent. Read by `tests/browser/support/library.ts`, which otherwise
      // has no way to tell a book that opened where it was asked from one still on its way
      // there — the two jumps above land after the first layout has already settled.
      setArrived(true);
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
    // ⚠️ **`openAt`, `select` and `handles` are deliberately not dependencies either, and that is
    // what "read once" means.**
    // `openAt` changes while the book stays open — jumping to a note's source moves the address
    // to the passage — so depending on it would re-open the book onto the last note the reader
    // looked at, every time they looked at one. The other two are carried out once as the book
    // opens and never again. The linter asks for all three; the answer is no.
    //
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

  /**
   * Go back to a marked passage from the notes panel, holding on to where the reader had read.
   *
   * ⚠️ **The page is read from `renderer.location`, not from `positionRef`.** `relocate`
   * de-duplicates on section, page, fraction and CFI, and `pageRange` is in none of them — so a
   * reflow that leaves the reader on the same page of the same CFI is swallowed, and the stored
   * range still describes the layout before it. Opening this very panel is that reflow on a
   * desk, where the book gives up a column for it. Asking the stored range there would answer
   * "somewhere else" about a passage in front of the reader's eyes, and freeze the reader's
   * progress for a jump that never happened.
   *
   * The progress being defended still comes from `positionRef`: it is the whole row, and it is
   * what a `relocate` has to be measured against to say the visit is over.
   *
   * **A visit itself draws nothing over the book.** All it raises is the mark on the Scrubber
   * (ADR-0040) — the way back to where reading stopped. The wash that does appear over the
   * passage is not the visit's and does not answer the same question: it says *which mark the
   * panel is pointing at*, it is gone the moment the panel is, and it appears whether or not a
   * visit was entered at all. What ADR-0040 refuses is a banner announcing the jump, and there
   * is still none.
   */
  const visitPassage = (target: string) => {
    // A second passage during a visit is still the same visit. What is being kept is where the
    // reader stopped reading, and that did not change when they tapped another mark.
    if (visitRef.current !== null) return;
    const here = positionRef.current;
    const at = rendererRef.current?.location;
    // Nothing to defend, or nothing to measure against. Both mean the jump writes the passage
    // as the position, the way it did before any of this existed — which is wrong, but it is
    // the answer with the fewest moving parts for a case that needs a book on screen and no
    // position in hand. `here` is null only before the first `relocate` of a book that has
    // never been read, and there is no progress to lose there.
    if (here === null || at === undefined) return;
    if (!entersVisit(at.pageRange ?? null, target)) return;
    setVisit(here);
  };

  /**
   * Take the offer. The `relocate` that follows writes the position, as it does for any move.
   *
   * **It ends a visit as well**, and has to. A visit can be on while this banner stands — the
   * reader went back to a marked passage, and a pull landed on top of it — and pressing this is
   * them saying that other place is where they are. Left standing, the visit would swallow the
   * very `relocate` this navigation causes whenever the offer is behind what is being kept: the
   * reader accepts a position and this device records nothing.
   */
  const goElsewhere = () => {
    if (elsewhere === null) return;
    setVisit(null);
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
   *
   * **It ends a visit too, and that is the one move that carries progress backwards** — the
   * only one left in the app, since the one thing a visit does put on screen carries the reader
   * forward to their progress rather than the progress back to them (ADR-0040). It is only
   * reachable while a banner from another device happens to be standing. The rule
   * during a visit is that progress only goes forward (`lib/visit.ts`), which is a rule about
   * what happens on its own; a reader who presses this has said where they are, and being told
   * "no, you are still a hundred pages on" is the button doing nothing.
   */
  const stayHere = () => {
    // Where the reader is looking, which during a visit is not what this device claims. Outside
    // one the two are the same row.
    const here = screenRef.current ?? positionRef.current;
    // Never null while a banner is up — the offer is only made once this device knows where it
    // is (above), which is the same guard that keeps this from being a button that does nothing.
    if (here === null) return;
    const now = Date.now();
    const kept = { ...here, lastReadAt: now, dirtyAt: now };
    setVisit(null);
    positionRef.current = kept;
    screenRef.current = kept;
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
      // **Three sets of boxes, and they are deliberately different.** What is painted is the
      // strip of wave beside the text, one per line; what a tap counts against is the text
      // itself, every rectangle of it — including the ruby annotation and the paragraph
      // indent, which carry no mark and are still part of the passage the reader marked; and
      // what the notes panel fills in when it points here is the words alone, ruby and blanks
      // dropped (`lib/highlights.ts` says why each one wants a different answer).
      //
      // Highlights outside this section come back with no rectangles at all, and ones on
      // another page fall outside the page box — both are dropped by the clipping inside.
      // Keyed on the targets, not the strips: a passage whose text has all been clipped away
      // is on another page, and a mark drawn beside text that is not there is the floating
      // highlight the clipping exists to prevent.
      const targets = hitBoxes(marked, page);
      if (targets.length > 0) {
        next.push({
          annotation,
          strips: markStrips(marked, page, verticalBook),
          targets,
          wash: textBoxes(marked, page),
        });
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
    <div
      className="reader"
      data-indexed={indexed}
      // Absent unless the address asked for something — a place, a passage to select, or both —
      // and `arrived` once every one of them has been carried out.
      data-at={openAt || select ? (arrived ? "arrived" : "opening") : undefined}
      data-panel={panelOpen || undefined}
    >
      {/* The book. **The bars are laid over it, and a panel is laid beside it** — raising 〈找〉
          leaves the page exactly where it was, opening one of the three gives up a column and
          repaginates.

          That asymmetry is the trade ADR-0005 asks for. The six settings apply as they are
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
            {/* `selectedId` is passed straight through: `chrome.ts` has already made it `null`
                for everything that is not the notes panel standing open, so a second condition
                here would only be a second opinion to disagree with it. */}
            <HighlightLayer
              ref={marksRef}
              painted={painted}
              vertical={verticalBook}
              selectedId={selectedNoteId}
            />
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

        {/* Where the reader's place in this book is, when it is not what is on screen, and the
            two ways of answering that.

            **One source: a position that arrived from another device** (`lib/elsewhere.ts`).
            Going back to a marked passage moves the reader too, and it used to raise this same
            banner — it marks the Scrubber instead now (ADR-0040). The two look alike and are
            not: the
            position from another device is unanswered and would be overwritten by the next page
            turn, while a visit is the reader's own tap a moment ago with nothing at stake.

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
                <Trans comment="Banner over the book, naming the reader's place in it when that place is not what is on screen, and it cannot be named as a chapter. The value is a whole number. The place was written somewhere else while this device had the book open, and the sentence does not say where on purpose: Tidemarks cannot tell which device wrote a position, or even whether it was another browser on this one.">
                  You were reading at {Math.round(elsewhere.position.percentage * 100)}%
                </Trans>
              ) : (
                <Trans comment="Banner over the book, naming the reader's place in it when that place is not what is on screen. The value is the chapter's own name, taken from the book — it is in the book's language and is never translated. The place was written somewhere else while this device had the book open, and the sentence does not say where on purpose: Tidemarks cannot tell which device wrote a position, or even whether it was another browser on this one.">
                  You were reading “{elsewhere.position.chapterLabel}”
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
                <Trans comment="Button on the banner naming the reader's place in the book: moves the book to that place. Short — it sits beside 'Stay here'.">
                  Go there
                </Trans>
              </button>
              <button className="ghost" onClick={stayHere}>
                <Trans comment="Button on the banner naming the reader's place in the book: makes the page on screen the reader's place, whatever the banner named. Short — it sits beside 'Go there'.">
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
            markAt={visit?.percentage}
            /* **The CFI, not the fraction the mark is drawn at.** A fraction is rounded to a
               page boundary on the way in — measured: a mark standing at 47% landed at 43% —
               and the reader pressing this is asking for the page they left, not for a page
               four per cent away from it. It is the same jump 〈Go there〉 makes, for the same
               reason.

               Nothing here ends the visit: arriving is what ends it. The `relocate` this
               causes reaches the gate above with a position at or past what is being kept, and
               `leavesVisit` says so (`lib/visit.ts`). */
            onMarkPress={() => {
              if (visit !== null) void renderer?.goToCfi(visit.cfi);
            }}
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
                pointedAt={selectedNoteId === a.id}
                onJump={() => {
                  visitPassage(a.cfiRange);
                  void renderer?.goToCfi(a.cfiRange);
                  // And the address bar follows, so the passage on screen is one the reader can
                  // copy out and send. The jump itself has already happened — this names it.
                  onAt?.({ kind: "cfi", cfi: a.cfiRange });
                  // **Not `jumped`, unlike the table of contents.** A chapter is a place to be
                  // left at; a note is one of a list the reader is working through, and closing
                  // the panel under them costs a press per passage to get back to it. So the
                  // panel stays and the passage is washed instead — but only where the book
                  // still has a column of its own to be seen in, which is what `keepPanel`
                  // carries and `lib/media.ts` explains.
                  sendChrome({ kind: "notePressed", id: a.id, keepPanel: bookKeepsAColumn });
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
            is the real page, resetting as the reader drags (ADR-0005). */}
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
  pointedAt,
  onJump,
  onEdit,
  onSave,
  onRemove,
}: {
  annotation: Annotation;
  editing: boolean;
  /** Whether the book is showing this passage filled in — see `aria-current` below. */
  pointedAt: boolean;
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
      {/* `aria-current` because the wash is the only other answer, and it is drawn on a layer
          that is `aria-hidden` — the boxes are decoration over text a screen reader already
          reads from the book. Before the panel started staying open, "that press landed" was
          the whole column closing, which every reader got. What replaced it is a colour, so
          the same fact has to be said in the tree as well (ADR-0021). */}
      <button
        type="button"
        className="annotation-quote"
        aria-current={pointedAt || undefined}
        onClick={onJump}
        title={t({
          message: "Jump to this passage",
          comment:
            "Tooltip on a quoted passage in the notes panel. Clicking it takes the reader to where that passage is in the book.",
        })}
      >
        {/* The passage is cut to three lines, and the cut is on this span rather than on the
            button around it — WebKit clamps nothing set on a control (`styles/book.css`). */}
        <span className="annotation-quote-text">{annotation.text}</span>
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
