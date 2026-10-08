import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type PageOffset, type Renderer } from "@yurenju/frond/renderer";
import { db } from "../lib/db";
import { sortByBookOrder } from "../lib/export";
import { scheduleSync, subscribePulledAnnotations } from "../lib/sync";
import { readAnnotations, type BookSession, type BookSessionReport } from "../lib/book-session";
import { useBookSession } from "../lib/useBookSession";
import { usePlace } from "../lib/usePlace";
import { usePanelAddress, type ReaderPanel } from "../lib/usePanelAddress";
import type { At, Select } from "../lib/route";
import type { Annotation } from "../lib/types";
import { frondSettings, readRootFontSize, type ReaderSettings } from "../lib/settings";
import type { Script } from "../lib/line-length";
import { useCarriedFont } from "../lib/useCarriedFont";
import { BOOK_KEEPS_A_COLUMN, PANEL_NEEDS, useMediaQuery } from "../lib/media";
import {
  chromeShowing,
  faceOf,
  isPanel,
  nextChrome,
  type ChromeEvent,
  type Face,
  type PanelKind,
} from "../lib/chrome";
import { AT_REST } from "../lib/turn";
import { useSelection } from "../lib/useSelection";
import { chapterAt, type ChapterBoundary, type FlatTocItem } from "../lib/toc";
import { groupByChapter } from "../lib/annotation-groups";
import { markToOpenAt, markToTurnTo } from "../lib/annotation-position";
import { boxesContain, hitBoxes, markStrips, textBoxes } from "../lib/highlights";
import Panel from "./Panel";
import AnnotationItem from "./AnnotationItem";
import NotesChapterHeading from "./NotesChapterHeading";
import TypographyForm from "./TypographyForm";
import HighlightLayer, { type PaintedHighlight } from "./HighlightLayer";
import SelectionLayer from "./SelectionLayer";
import SelectionToolbar from "./SelectionToolbar";
import Scrubber from "./Scrubber";
import ElsewhereBanner from "./ElsewhereBanner";
import FontToast from "./FontToast";
import { READER_MESSAGES } from "./reader-messages";

/**
 * What the one panel calls itself while it is showing each of the three.
 *
 * The state the three are is `lib/chrome.ts`'s; this is what they are *called*, and the words
 * themselves are next door in `reader-messages.ts`.
 *
 * The `data-testid` is here rather than at the call site because it is the same question the
 * title answers — which of the three is up — and answering it twice is how the two drift apart.
 * Naming the three ids keeps every existing spec pointing at the panel it was written for; the
 * merge below is a change to the shell, and a shell change should not rewrite five suites.
 */
const PANEL_FACES: Record<Face, { title: MessageDescriptor; testId: string }> = {
  toc: { title: READER_MESSAGES.panelToc, testId: "panel-toc" },
  notes: { title: READER_MESSAGES.panelNotes, testId: "panel-notes" },
  layout: { title: READER_MESSAGES.panelLayout, testId: "panel-layout" },
};

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
   * Says whether the chrome is standing, so the frame the platform draws around the page can
   * take the colour of whatever is under it (`App.tsx`). Reported rather than read from here
   * because that colour has to have one writer, and on every other screen the answer is `false`.
   */
  onChromeChange: (up: boolean) => void;
}) {
  const { i18n } = useLingui();
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
  const { chrome, face, editing: editingId, selected: selectedNoteId } = chromeState;
  // Whether the bars are on screen. Not whenever the chrome is anything but down: [[Reflect]]
  // sends them away, so that what is left is the book and the reader's own notes beside it, and
  // [[Marking]]'s note never calls them up, so that writing it does not interrupt the reading.
  const barsUp = chrome === "up" || isPanel(chrome);
  // Whether anything of the reader's is laid over the book, which is what the platform's frame
  // matches — a panel as much as the bars.
  const chromeUp = chrome !== "down";
  // Told upward so the platform's frame can match what is under it, and told on the way out too: a
  // reader who leaves a book with the chrome up is going back to a shelf that has no chrome.
  useEffect(() => {
    onChromeChange(chromeUp);
    return () => onChromeChange(false);
  }, [chromeUp, onChromeChange]);

  /** Hands one event to the chrome machine. */
  const sendChrome = (event: ChromeEvent) => setChromeState((now) => nextChrome(now, event));

  // The panel layer and the address bar, kept saying the same thing in both directions
  // (`lib/usePanelAddress.ts`). Nothing comes back: what it does is keep the two in step.
  usePanelAddress({ panel, onPanel, chrome, selectedId: selectedNoteId, bookId, sendChrome });

  /**
   * A `?d=notes/<book>/<note>` naming a mark this book no longer has — or a mark pointed at that
   * has just been deleted, here or on another device.
   *
   * The address is whatever somebody pasted. **Losing one note should not cost the whole list**,
   * which is what `lib/route.ts` does with every other unreadable address — so nothing is pointed
   * at any more, the panel stays, and the mirror above writes the shorter address back.
   *
   * It waits for the marks to arrive rather than checking at the first render: they are read out
   * of Dexie a moment after the book opens, and an empty list before then is not an answer.
   */
  useEffect(() => {
    if (!annotationsRead) return;
    const gone = (id: string | null) => id !== null && !annotations.some((a) => a.id === id);
    if (gone(selectedNoteId) || gone(editingId)) sendChrome({ kind: "pickDropped" });
  }, [annotationsRead, annotations, selectedNoteId, editingId]);
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
  // Page turns begun, turns frond has reported landing (`located`), and landings already answered
  // with `turnLanded`. **Counts, not flags**: an arrow pressed twice quickly commits the first turn
  // at once and starts a second, and a flag would answer for the middle page and then never for
  // the last. And it is the landing that counts, not the measurement — the effect below also runs
  // when marks arrive from sync mid-slide, and that measures the page being left. Refs, not state:
  // nothing renders them.
  const turnsRef = useRef({ begun: 0, landed: 0, answered: 0 });
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
  // Where the page in front of the reader begins, as a CFI. The notes list asks it one question:
  // which marks lie further on, when this page has none of its own (`lib/annotation-position.ts`).
  const [pageStart, setPageStart] = useState<string | null>(null);
  // Bumped each time a turn's landing has been answered with `turnLanded`, so the notes list can
  // follow the book onto the new page once the marks on it are known.
  const [landings, setLandings] = useState(0);
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
  /**
   * The face this book wants, fetched in the background and everything that says so on screen
   * (`lib/useCarriedFont.ts`).
   *
   * All this component knows about it is that a book either wants a face or does not. What
   * applies the result is the settings effect below — `webFonts` is in its dependencies, so a
   * face arriving is a settings change like any other.
   */
  const {
    webFonts,
    webFontsRef,
    status: webFontStatus,
    busy: fontBusy,
    toast: fontToast,
  } = useCarriedFont(wantsWebFont, settings.fontFamily);
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
      setPageStart(null);
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
      const turns = turnsRef.current;
      if (turns.landed < turns.begun) turns.landed += 1;
      setFraction(at.fraction);
      setSectionIndex(at.sectionIndex);
      setPageStart(at.cfi);
      setGeometry((tick) => tick + 1);
    },
    moved: () => setGeometry((tick) => tick + 1),
    indexed: () => setIndexed(true),
    ready: setRenderer,
    arrived: () => setArrived(true),
    chrome: (event) => {
      // A turn is asked about again once it has landed (`turnLanded`, sent from the highlight
      // layer below): which marks are on the new page is not known until it is laid out.
      if (event.kind === "turned") turnsRef.current.begun += 1;
      sendChrome(event);
    },
  };

  // One sitting with one book, opened once per book and torn down on the way out
  // (`lib/useBookSession.ts`, over `lib/book-session.ts`). What is and is not a reason to open it
  // again is that file's subject.
  useBookSession(sessionRef, {
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
      paintedRef.current.find((entry) => boxesContain(point, entry.targets))?.annotation.id ?? null,
    on: report,
  });

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
  // Every mark's CFI is parsed to file it under a chapter, and the reader re-renders on every
  // page turn — so this is held rather than redone at 60Hz while the panel stands open.
  const noteGroups = useMemo(() => groupByChapter(annotations, chapters), [annotations, chapters]);
  const currentItemRef = useRef<HTMLButtonElement>(null);

  // A mark nobody scrolls to is no mark at all: a long list opens at the top. Runs on open and
  // whenever the chapter changes under an open panel.
  useEffect(() => {
    if (chrome !== "toc") return;
    currentItemRef.current?.scrollIntoView({ block: "center" });
  }, [chrome, currentTocIndex]);

  // The same courtesy for [[Notes]]: the list opens on the reader's page rather than at the first
  // mark in the book, and follows the book when it turns. **Scrolled to, never selected** — which
  // mark is the answer is `lib/annotation-position.ts`'s, and pointing at one stays the reader's.
  // State rather than a ref: the panel is portalled, and its body mounts a render after [[Reflect]]
  // opens. Holding the element as state is what gives the effect below a second chance once it is
  // there, where a ref would still be empty and nothing would ask again.
  const [notesList, setNotesList] = useState<HTMLDivElement | null>(null);
  const reflecting = chrome === "reflect";
  /**
   * Brings a card to the top of the list. **The chapter's heading comes with it** when the card is
   * the first of its run, so the list does not open on a card with its chapter's name scrolled
   * just out of sight.
   *
   * The list is scrolled rather than the card asked to `scrollIntoView`, for the reason
   * `AnnotationItem`'s editor gives: only the panel's own column should move.
   */
  function scrollNotesTo(id: string) {
    const item = notesList?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(id)}"]`);
    const body = item?.closest<HTMLElement>(".panel-body");
    if (!item || !body) return;
    const run = item.closest<HTMLElement>(".annotation-chapter");
    const anchor = run?.querySelector(".annotation-item") === item ? run : item;
    body.scrollTop += anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }
  // Set as [[Reflect]] opens with nothing pointed at, and spent once there is a page to answer
  // from. Two steps because the list can open before there is one: `?d=notes` raises it as the
  // book opens, before the marks are read or the first page has been located. Only the opening
  // asks — a mark picked or dropped inside [[Reflect]] is not the list opening.
  const notesOpening = useRef(false);
  const wasReflecting = useRef(false);
  // Landings the list has already followed, so a render for any other reason does not scroll it.
  const followedLandings = useRef(0);
  // No dependency list on either: each one keeps its own record of what it has already answered,
  // and the rest is read as it stands at that moment.
  useEffect(() => {
    if (reflecting !== wasReflecting.current) {
      wasReflecting.current = reflecting;
      notesOpening.current = reflecting && selectedNoteId === null;
    }
    if (!notesOpening.current || !annotationsRead || pageStart === null || !notesList) return;
    notesOpening.current = false;
    // `paintedRef` rather than `painted`: the highlight layer has just measured this page in a
    // layout effect, and the state it set has not been rendered yet.
    const onPage = paintedRef.current.map((entry) => entry.annotation.id);
    const target = markToOpenAt(annotations, onPage, pageStart);
    if (target !== null) scrollNotesTo(target.id);
  });
  // A turn that has landed, while the list stands beside the book. Not while a passage is still
  // pointed at — one running across the turn keeps its wash (`lib/chrome.ts`) and the list is
  // already on it — nor while a note is being written, whose box the reader is typing into.
  useEffect(() => {
    if (landings === followedLandings.current) return;
    followedLandings.current = landings;
    if (!reflecting || selectedNoteId !== null || editingId !== null) return;
    const onPage = paintedRef.current.map((entry) => entry.annotation.id);
    const target = markToTurnTo(annotations, onPage);
    if (target !== null) scrollNotesTo(target.id);
  });

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
    // **The answer to the question a turn could not ask as it began**: which marks are on the page
    // it landed on. These boxes are that page's, measured at rest — so this is the first moment
    // anyone can say whether the passage [[Reflect]] was pointing at came along (`lib/chrome.ts`).
    const turns = turnsRef.current;
    if (turns.answered < turns.landed) {
      turns.answered = turns.landed;
      sendChrome({ kind: "turnLanded", showing: next.map((entry) => entry.annotation.id) });
      setLandings((n) => n + 1);
    }
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
    sendChrome({ kind: "marked", id: annotation.id, withNote });
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
  // `styles/reader.css` draws both arrangements; this only says whether a face is standing —
  // [[Find]]'s two or [[Reflect]]'s list, which take the same column.
  const panelOpen = faceOf(chrome) !== null;

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
            aria-label={i18n._(rtl ? READER_MESSAGES.nextPage : READER_MESSAGES.previousPage)}
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
            aria-label={i18n._(rtl ? READER_MESSAGES.previousPage : READER_MESSAGES.nextPage)}
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
      <div className="chrome" data-up={barsUp || undefined}>
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
          {/* Not a toggle like its neighbours: what it raises is [[Reflect]], which sends this bar
              away, so there is never an "active" state of it to draw. */}
          <button className="ghost" onClick={() => sendChrome({ kind: "notesToggled" })}>
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
            aria-label={i18n._(READER_MESSAGES.about)}
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
        title={PANEL_FACES[face].title}
        testId={PANEL_FACES[face].testId}
        // Read off the face rather than written at each of the three, so the one question the
        // four faces differ by has one answer per face and one place to change it
        // (`lib/media.ts`).
        needs={PANEL_NEEDS[face]}
        bookDecides={face === "notes"}
        container={panelHostRef}
      >
        {face === "toc" && (
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

        {face === "notes" && (
          <div className="panel-list panel-list-notes" ref={setNotesList}>
            {annotations.length === 0 && (
              <div className="notes-empty">
                {/* One faint run of the mark the reader has not made yet, so the panel is not a
                    blank column with a sentence in it — and so the sentence comes with a picture
                    of what "a mark" is. Decoration: the words say all of it. */}
                <span className="notes-empty-wave" aria-hidden="true" />
                <p className="empty">
                  <Trans comment="The whole of the notes panel when nothing has been marked in this book. Two short sentences: what is true, then what to do about it.">
                    This book is unmarked. Select a passage to leave a mark.
                  </Trans>
                </p>
              </div>
            )}
            {noteGroups.map((group, i) => (
              <section
                // **The row and the position, not the row alone.** A chapter the list returns
                // to opens a second run with the same `tocIndex`
                // (`lib/annotation-groups.ts`), and two siblings sharing a key is undefined
                // reconciliation — the second run's editor state would be the first's.
                key={`${group.tocIndex ?? "unplaced"}-${i}`}
                className="annotation-chapter"
                data-testid="annotation-chapter"
              >
                {/* **Absent when there is no chapter to name**, rather than standing empty or
                    inventing a word for it. A mark before the first chapter — in a dedication, on
                    a cover — is still the reader's, and a heading reading "Front matter" over it
                    would be Tidemarks talking where the book says nothing. */}
                {group.label !== null && (
                  <NotesChapterHeading
                    label={group.label}
                    count={group.marks.length}
                    here={group.tocIndex === currentTocIndex}
                  />
                )}
                {group.marks.map((a) => (
                  <AnnotationItem
                    key={a.id}
                    annotation={a}
                    editing={editingId === a.id}
                    selected={selectedNoteId === a.id}
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
              </section>
            ))}
          </div>
        )}

        {/* Six settings, one record, every book. They are in the reader's panel rather than only
            in [[Settings]] because this is the one place with a preview: what the panel leaves showing
            is the real page, resetting as the reader drags (ADR-0005). */}
        {face === "layout" && (
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
      <FontToast note={fontToast} />
    </div>
  );
}
