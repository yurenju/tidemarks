import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type PageOffset, type Renderer } from "@yurenju/frond/renderer";
import { db } from "../lib/db";
import { sortByBookOrder } from "../lib/export";
import { scheduleSync, subscribePulledAnnotations } from "../lib/sync";
import {
  openBookSession,
  readAnnotations,
  type BookSession,
  type BookSessionReport,
} from "../lib/book-session";
import { usePlace } from "../lib/usePlace";
// `Panel` here is the address's spelling of one, aliased because the component of that name is
// the shell it is drawn in — two halves of the same thing, and both are in this file.
import { samePanel, type At, type Panel as PanelAddress, type Select } from "../lib/route";
import type { Annotation } from "../lib/types";
import {
  FONT_FAMILIES,
  frondSettings,
  readRootFontSize,
  type FontChoice,
  type ReaderSettings,
} from "../lib/settings";
import type { Script } from "../lib/line-length";
import { webFontsFor } from "../lib/web-font";
import {
  ensureWebFont,
  webFontAppliedNote,
  WEB_FONT_UNAVAILABLE_NOTE,
  type LoadedWebFont,
  type WebFontStatus,
} from "../lib/web-font-store";
import { BOOK_KEEPS_A_COLUMN, PANEL_NEEDS, useMediaQuery } from "../lib/media";
import {
  chromeShowing,
  isPanel,
  nextChrome,
  type ChromeEvent,
  type PanelKind,
} from "../lib/chrome";
import { AT_REST } from "../lib/turn";
import { useSelection } from "../lib/useSelection";
import { chapterAt, type ChapterBoundary, type FlatTocItem } from "../lib/toc";
import { boxesContain, hitBoxes, markStrips, textBoxes } from "../lib/highlights";
import Panel from "./Panel";
import AnnotationItem from "./AnnotationItem";
import TypographyForm from "./TypographyForm";
import HighlightLayer, { type PaintedHighlight } from "./HighlightLayer";
import SelectionLayer from "./SelectionLayer";
import SelectionToolbar from "./SelectionToolbar";
import Scrubber from "./Scrubber";
import ElsewhereBanner from "./ElsewhereBanner";

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

// The reader-facing name of a font choice, from its one source. The toast names the face the
// download applied, and the dropdown is where that name is defined.
const fontFamilyLabel = (i18n: I18n, choice: FontChoice): string => {
  const found = FONT_FAMILIES.find((f) => f.value === choice);
  return found ? i18n._(found.label) : "";
};

/** The reader's own three faces as the address spells them (`lib/route.ts`). */
type ReaderPanel = PanelAddress & { kind: PanelKind };

export default function Reader({
  bookId,
  openAt,
  select,
  handles,
  panel,
  onPanel,
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
   * Which of the reader's three faces the address has standing, and `null` for none of them —
   * including while [[About]] is up, since one `?d=` holds one panel (`lib/route.ts`).
   *
   * **The address is the chrome's mirror, not the other way round** (ADR-0046). This prop is
   * what the mirror currently shows: the state machine below is still the one deciding, and the
   * two effects further down write to whichever of the two is behind.
   */
  panel: ReaderPanel | null;
  /** Reports the chrome's panel layer moving, so the address can follow it. `App.tsx` decides
   *  what that does to the history stack — it is the one place that touches it. */
  onPanel: (next: ReaderPanel | null) => void;
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
  /** Opens [[About]] over the book (`#/book/<id>?d=about/<id>`). */
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
  /**
   * The sitting with the book that is open: frond, the gesture machine, and the three pointer
   * surfaces they are fed from (`lib/book-session.ts`).
   *
   * A ref because the reader's markup and the session are on opposite sides of the component —
   * the page buttons and the selection handles are rendered below, and the session is built in
   * an effect that runs once per book. `null` before the book opens and after it closes, which
   * is why every call through it is optional: a press on a handle after the reader has left is
   * a press with nothing behind it.
   */
  const sessionRef = useRef<BookSession | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [title, setTitle] = useState("");
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /**
   * Whether the list above has been read out of Dexie yet.
   *
   * Only one question needs it, and it is the difference between "this book has no marks" and
   * "nobody has looked yet": an address naming a note is checked against this list, and an empty
   * list a moment after the book opened would condemn a note that is about to arrive.
   */
  const [annotationsRead, setAnnotationsRead] = useState(false);
  // Named rather than read inline in the bar button, so the catalog carries `{markCount}`
  // instead of a bare `{0}` that says nothing to whoever translates it.
  const markCount = annotations.length;
  /**
   * Which of the reader's states is standing, which panel it last showed, and which note is being
   * written. One value with one writer: `lib/chrome.ts` owns every rule about how it changes, and
   * what is left here is naming the event that just happened (CONTEXT.md [[chrome]]).
   */
  const [chromeState, setChromeState] = useState(() =>
    chromeShowing(panel?.kind ?? null, panel?.kind === "notes" ? (panel.noteId ?? null) : null),
  );
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
   * The mirror, chrome → address.
   *
   * ⚠️ **Compared before written**, or this and its twin below would take turns telling each
   * other the same news forever.
   *
   * ⚠️ **It stands aside on the pass where the address is what moved**, which is what
   * `mirrored` is for. React runs this before its twin below, so on the render that follows a
   * back press it would otherwise see a chrome still showing the panel the address has just
   * dropped, call that a disagreement, and **push the panel straight back on** — the back button
   * would do nothing at all, and the entry it popped would be replaced by a new one. Measured:
   * every back-button case in `tests/browser/reader/panel-address.spec.ts` failed exactly that
   * way. Identity is the right test here: a new object is what App hands down when, and only
   * when, the route has moved.
   *
   * ⚠️ **And it says nothing more until the address has answered**, which is what `asked` is
   * for. Going a storey shallower is a `history.back()`, and that is asynchronous: for the frame
   * or so until the browser announces the new address, the chrome and the address still
   * disagree. **One press of the reader's often moves the chrome twice in that window** — a
   * press on the page button beside a standing panel is an outside press *and* a page turn, so
   * the chrome goes `notes → up → down` in two commits — and each commit would ask for a
   * `back()` of its own. Measured: one press walked the reader out of the panel, out of the
   * book, and onto the shelf, and `reader/visit.spec.ts` was the only thing that saw it.
   *
   * `onPanel` is read through a ref for the same reason, one layer down: a new callback identity
   * on every render of `App` must not be a reason to ask again either.
   */
  const onPanelRef = useRef(onPanel);
  onPanelRef.current = onPanel;
  const mirrored = useRef(panel);
  const asked = useRef(false);
  useEffect(() => {
    if (mirrored.current !== panel || asked.current) return;
    // The book id rides along even though the screen underneath is that same book, because that
    // is the rule for every panel: reading the hash never means looking at what is below it.
    const showing: ReaderPanel | null = isPanel(chrome)
      ? {
          kind: chrome,
          bookId,
          ...(chrome === "notes" && editingId !== null ? { noteId: editingId } : {}),
        }
      : null;
    if (samePanel(showing, panel)) return;
    asked.current = true;
    onPanelRef.current(showing);
  }, [chrome, editingId, bookId, panel]);

  /**
   * The mirror, address → chrome. Back, forward, and a hand-typed address all arrive here.
   *
   * **Translated into the events the machine already has**, rather than writing the state: a
   * panel going away is a `panelDismissed` whether the reader pressed the ✕ or Android's back
   * button, and a machine with a second way to be closed is a machine with two rules to keep in
   * step (`lib/chrome.ts` says what that cost the last time).
   */
  useEffect(() => {
    // Noted before anything is sent, so the twin above knows the address has answered and may
    // speak again on the renders that follow. **Every route the address can move by comes
    // through here** — `history.back()` by way of `hashchange`, and the two writes App makes by
    // way of the state it sets alongside them — so there is no way for it to be left waiting on
    // an answer that never arrives.
    mirrored.current = panel;
    asked.current = false;
    if (panel === null) {
      if (isPanel(chrome)) sendChrome({ kind: "panelDismissed" });
      return;
    }
    if (chrome !== panel.kind) sendChrome({ kind: "togglePanel", panel: panel.kind });
    const noteId = panel.kind === "notes" ? (panel.noteId ?? null) : null;
    if (noteId !== null && noteId !== editingId) sendChrome({ kind: "openNote", id: noteId });
    // Stepping back out of a note and into the list it came from. `noteSaved` is the machine's
    // name for "the editor is finished with", which is what this is: a note commits when its box
    // loses the focus, so there is nothing left to save by the time the address has moved.
    if (noteId === null && editingId !== null) sendChrome({ kind: "noteSaved" });
    // ⚠️ **Keyed on the address alone**, though `chrome` and `editingId` are read inside. They
    // are read to decide whether anything has to be *sent*, never to decide what: this direction
    // of the mirror only has something to say when the address has moved, and re-running it on
    // every move the chrome makes of its own accord would have it answering its own twin.
  }, [panel]);

  /**
   * A `?d=notes/<book>/<note>` naming a mark this book no longer has.
   *
   * The address is whatever somebody pasted, and a mark can have been deleted on another device
   * since. **Losing one note should not cost the whole list**, which is what `lib/route.ts` does
   * with every other unreadable address — so the editor closes, the panel stays, and the mirror
   * above writes the shorter address back.
   *
   * It waits for the marks to arrive rather than checking at the first render: they are read out
   * of Dexie a moment after the book opens, and an empty list before then is not an answer.
   */
  useEffect(() => {
    if (!annotationsRead) return;
    if (editingId === null || annotations.some((a) => a.id === editingId)) return;
    sendChrome({ kind: "noteSaved" });
  }, [annotationsRead, annotations, editingId]);
  /**
   * Where the reader is in this book — what this device claims, what is on screen, whether a
   * visit is holding, whether another device has offered a position — and everything that acts
   * on it (`lib/usePlace.ts`, over `lib/place.ts`'s reducer).
   *
   * ⚠️ **`dispatch` is read through `.current`**, for the same reason the selection's commands
   * are: the effect that opens the book runs once per book, and frond's `relocate` fires from
   * inside it, so what it closes over has to be something that always points at now.
   */
  const {
    visit,
    offer: elsewhere,
    dispatch: dispatchPlace,
    ground,
    goElsewhere,
    stayHere,
    visitPassage,
  } = usePlace({ bookId, renderer: rendererRef });
  /**
   * Whether the section on screen lays out vertically, which the type panel needs in order to
   * take the column choice away: frond cannot paginate a vertically-written book in more than
   * one column at all. It stays in here because
   * this is the only place that knows — `resolveLayout` gets the mode from frond itself.
   */
  const [verticalBook, setVerticalBook] = useState(false);
  /**
   * The whole life of a selection, from the long press that begins one to the colour row that
   * ends it (`lib/useSelection.ts`).
   *
   * ⚠️ **Every command is read through `.current`**, and never lifted into a local: the effect
   * that opens the book runs once per book, so what it closes over has to be something that
   * always points at now. That file's head comment is the long version, and this is the one
   * arrangement here that turns nothing red when it is got wrong.
   *
   * The gesture machine belongs to the open book, because it decides page turns as well. So the
   * two commands that have something to say to it hand a value back rather than reaching it —
   * the session is what carries them on (`lib/book-session.ts`) — and the one question that runs
   * the other way goes down as `blamesTap`.
   */
  const { commands: selection, view: selectionView } = useSelection({
    renderer: rendererRef,
    mount: mountRef,
    vertical: verticalBook,
    blamesTap: (at) => sessionRef.current?.blamesTap(at) === true,
    onArrived: () => sendChrome({ kind: "selectionArrived" }),
    onMark: (color, withNote) => void addAnnotation(color, withNote),
  });
  // The reader's own box, which the panels are rendered into. Where a panel stops is then a box
  // rather than a pair of numbers kept in step with the height of two bars — see `Panel`.
  const panelHostRef = useRef<HTMLDivElement>(null);
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

  /**
   * Everything the open book has to tell this component, written down in one place.
   *
   * ⚠️ **Read once per book**, at the moment the session opens (`lib/book-session.ts`), so every
   * entry here has to keep working when it is a render or two old. All but one are state setters,
   * which React keeps stable across renders; `onClose` is a prop, and the closure over it is the
   * same one this effect has always made.
   */
  const report: BookSessionReport = {
    // **The marks and the title are deliberately not cleared here.** Everything else on screen
    // describes a place in a book, and the new book is not there yet; those two are replaced
    // whole a moment later, and blanking them first would flash the reader an empty panel.
    opening: () => {
      setIndexed(false);
      setArrived(false);
      setFraction(0);
      setSectionIndex(0);
      setChapters([]);
      setAnnotationsRead(false);
    },
    title: setTitle,
    downloading: setDownloading,
    failed: setLoadError,
    missing: onClose,
    opened: (facts) => {
      setToc(facts.toc);
      setChapters(facts.chapters);
      setSimplified(facts.simplified);
      setScript(facts.script);
      setWantsWebFont(facts.wantsWebFont);
    },
    direction: setRtl,
    vertical: setVerticalBook,
    annotations: (marks) => {
      setAnnotations(marks);
      setAnnotationsRead(true);
    },
    // A move is also every measured rectangle going stale, which is what the highlight layer
    // recomputes against.
    located: (at) => {
      setFraction(at.fraction);
      setSectionIndex(at.sectionIndex);
      setGeometry((tick) => tick + 1);
    },
    moved: () => setGeometry((tick) => tick + 1),
    indexed: () => setIndexed(true),
    ready: setRenderer,
    arrived: () => setArrived(true),
    chrome: sendChrome,
  };

  /**
   * One sitting with one book (`lib/book-session.ts`).
   *
   * ⚠️ **`bookId` alone, and that is what "read once" means.** `openAt` changes while the book
   * stays open — jumping to a note's source moves the address to the passage — so depending on
   * it would re-open the book onto the last note the reader looked at, every time they looked at
   * one. `select` and `handles` are carried out once as the book opens and never again. `i18n`
   * is out for the same reason: what it feeds is an error message stored in state, and
   * re-running this to refresh that wording would re-open the book, sending a reader who changed
   * language while looking at a failure back to page one of one that worked.
   *
   * ⚠️ **`selection` is not one either, and asking for it is the trap `lib/useSelection.ts`
   * opens with.** The commands are handed over as the ref they are, precisely so this
   * once-per-book session reads the current set instead of the one it opened with.
   */
  useEffect(() => {
    const session = openBookSession({
      bookId,
      i18n,
      mount: mountRef,
      renderer: rendererRef,
      openAt,
      select,
      handles: handles === true,
      settings: settingsRef,
      theme: themeRef,
      webFonts: webFontsRef,
      applied: appliedRef,
      selection,
      place: dispatchPlace,
      ground,
      slide: (at) => slideMarks(marksRef.current, at),
      markAt: (point) =>
        paintedRef.current.find((entry) => boxesContain(point, entry.targets))?.annotation.id ??
        null,
      on: report,
    });
    sessionRef.current = session;
    return () => {
      sessionRef.current = null;
      session.destroy();
    };
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

  async function addAnnotation(color: string, withNote: boolean) {
    const passage = selectionView.passage;
    if (!passage) return;
    const now = Date.now();
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      bookId,
      cfiRange: passage.cfiRange,
      text: passage.text,
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
    selection.current.clear();
    if (withNote) sendChrome({ kind: "openNote", id: annotation.id });
  }

  /**
   * Writes the note down. **Committing and closing the box are two things now**, and this is the
   * first of them: it says nothing to the chrome, so it is safe to call from the editor being
   * taken away — which is every way out of a note except pressing [[Done]] (ADR-0044).
   */
  async function persistNote(id: string, note: string) {
    const now = Date.now();
    await db.annotations.update(id, { note, updatedAt: now, dirtyAt: now });
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
    scheduleSync();
  }

  /** [[Done]]: the same write, and then the editor closes. */
  async function saveNote(id: string, note: string) {
    await persistNote(id, note);
    sendChrome({ kind: "noteSaved" });
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
      /* Whether one is standing, which is all the reader's own box has to know: the bars give up
         their right end and the book gives up a column. **Which face it is has moved onto the
         popup itself** (`Panel.tsx`'s `data-needs`), because the rule that needed it — the one
         keeping [[Layout]] a sheet — has to survive the 180ms Base UI holds the popup mounted for
         after this attribute has gone. */
      data-panel={panelOpen || undefined}
    >
      {/* The book. **The bars are laid over it, and a panel is laid beside it** — raising [[Find]]
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
            onClick={() => sessionRef.current?.turnPage("left")}
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
            {/* `selectedId` is passed straight through: `chrome.ts` owns when a passage stops
                being pointed at, so a second condition here would only be a second opinion to
                disagree with it. **It is deliberately still washed with no panel standing** —
                on a narrow window that is the whole point of pressing a quote, and the wash is
                then the only thing on screen saying which passage it was (ADR-0044). */}
            <HighlightLayer
              ref={marksRef}
              painted={painted}
              vertical={verticalBook}
              selectedId={selectedNoteId}
            />
            {/* Only for a selection we drew: where the browser drew one it is already on
                screen, and a second wash over it would be twice the colour. */}
            {selectionView.drawn && (
              <SelectionLayer
                rects={selectionView.drawn.rects}
                ends={selectionView.drawn.ends}
                vertical={verticalBook}
                onHandlePointer={(kind, end, event) =>
                  sessionRef.current?.handlePointer(kind, end, event)
                }
              />
            )}
          </div>
          <button
            className="page-btn"
            onClick={() => sessionRef.current?.turnPage("right")}
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

      {/* [[Find]], laid over the book in one box. The three pieces are ordered by CSS rather than
          by this file: the entries sit above the Scrubber on a hand-held and up in the top bar
          everywhere else, and neither arrangement is a different component (ADR-0023).

          **It stays in the tree while [[Read]] stands**, parked off the edges it came from, because
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
          {/* The same panel the shelf's ⋯ opens, over the book instead of over the shelf. It
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
                "Screen-reader name for the button in the reader's bar that opens the panel describing the open book.",
            })}
            data-testid="reader-about"
          >
            ⋯
          </button>
        </nav>

        {/* Where the reader's place in this book is, when it is not what is on screen, and the
            two ways of answering that (`ElsewhereBanner.tsx`).

            **In the chrome's grid but not one of its bars**: it never slides, never hides, and
            is not part of [[Find]] — the reader did not ask for it and cannot dismiss it with a
            tap on the page. It sits in a row of its own under the top bar, which is a fixed
            place in both states, so raising the chrome does not move it and lowering the chrome
            does not put it under anything. The cost is a bar's worth of space above it while
            the chrome is down, which reads as an inset from the top edge. */}
        {elsewhere !== null && (
          <ElsewhereBanner offer={elsewhere} onGo={goElsewhere} onStay={stayHere} />
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
               four per cent away from it. It is the same jump [[Go there]] makes, for the same
               reason.

               Nothing here ends the visit: arriving is what ends it. The `relocate` this
               causes reaches the gate above with a position at or past what is being kept, and
               `leavesVisit` says so (`lib/visit.ts`). */
            onMarkPress={() => dispatchPlace.current({ kind: "markPressed" })}
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
          in `chrome` but not in the DOM: pressing Notes while Type stood left two shells changing
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
        // Read off the face rather than written at each of the three, so the one question the
        // four faces differ by has one answer per face and one place to change it
        // (`lib/media.ts`).
        needs={PANEL_NEEDS[panelKind]}
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
                    // Same question `notePressed` asks, and the same answer: a chapter is one of
                    // a list the reader may be working down, so [[Contents]] is left standing where
                    // the book it sent them to is still on screen beside it. Narrower, the panel
                    // is over the book and would hide the chapter it just took them to.
                    sendChrome({ kind: "jumped", keepPanel: bookKeepsAColumn });
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
                  // The jump is the place's to make: whether it opens a visit and where the
                  // book moves to are one decision, and they used to be two calls that had to
                  // be kept in the right order (`lib/place.ts`).
                  visitPassage(a.cfiRange);
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
                onPersist={(note) => void persistNote(a.id, note)}
                onSave={(note) => void saveNote(a.id, note)}
                onRemove={() => removeAnnotation(a)}
              />
            ))}
          </div>
        )}

        {/* Six settings, one record, every book. They are in the reader's panel rather than only
            in [[Settings]] because this is the one place with a preview: what the panel leaves showing
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

      <SelectionToolbar toolbar={selectionView.toolbar} />
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
