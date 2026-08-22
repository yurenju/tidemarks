import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EpubBook } from "@yurenju/frond/epub";
import {
  Renderer,
  type RenderLocation,
  type TurnDirection,
  type TurnInProgress,
} from "@yurenju/frond/renderer";
import { db } from "../lib/db";
import { recallPosition, rememberPosition } from "../lib/position-store";
import { sortByBookOrder } from "../lib/export";
import { downloadBookFile, notePosition, scheduleSync } from "../lib/sync";
import type { Annotation } from "../lib/types";
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
  commitsTurn,
  dampen,
  isTap,
  startsDrag,
  TAP_SELECTION_GRACE_MS,
  travelled,
} from "../lib/touch";
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
import { boxesContain, visibleBoxes, markVar, DEFAULT_MARK, MARKS } from "../lib/highlights";
import Panel from "./Panel";
import TypographyForm from "./TypographyForm";
import HighlightLayer, { type PaintedHighlight } from "./HighlightLayer";
import Scrubber from "./Scrubber";

/**
 * Which of the reader's three states is standing, and — when it is 〈找〉 — which panel is up.
 *
 * One value rather than a flag per layer, because **the states are exclusive and the exclusion
 * is the whole point** (CONTEXT.md 〈chrome〉). Five independent flags is what the reader used
 * to be, and none of them could answer "what is the reader doing right now"; a panel that
 * implies the bar it rose from cannot fall out of step with it if there is only one value to
 * be out of step.
 *
 * 〈標〉 is not in here. It is not this component's to enter: a selection arrives from frond, and
 * what it does to this value is put it back to `"down"`.
 */
type Chrome = "down" | "up" | PanelKind;

/** The three panels 〈找〉 can raise. A separate name so nothing can ask to "open the bar". */
const PANEL_KINDS = ["toc", "notes", "layout"] as const;
type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * What the one panel calls itself while it is showing each of the three.
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

/**
 * Whether one of the three is standing open — the one fact the *layout* turns on: on a desk the
 * book gives up a column to it, on a hand-held the entries and the Scrubber step aside for it.
 *
 * Written off the list rather than as a third spelling of the union. The type, the toggle and
 * this question all have to name the same three panels, and two of them can already only be
 * wrong together.
 */
const isPanel = (chrome: Chrome): chrome is PanelKind =>
  (PANEL_KINDS as readonly string[]).includes(chrome);

// How long the applied/unavailable toast stays before it clears itself. Long enough to read a
// short line, short enough not to sit over the page.
const FONT_TOAST_MS = 2600;

// The window the release speed is measured over. Long enough to have two or three moves in it
// on a 60Hz screen, short enough that it is the flick and not the drag before it.
const VELOCITY_WINDOW_MS = 90;

// The reader-facing name of a font choice, from its one source. The toast names the face the
// download applied, and the dropdown is where that name is defined.
const fontFamilyLabel = (i18n: I18n, choice: FontChoice): string => {
  const found = FONT_FAMILIES.find((f) => f.value === choice);
  return found ? i18n._(found.label) : "";
};

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
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [title, setTitle] = useState("");
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Named rather than read inline in the bar button, so the catalog carries `{markCount}`
  // instead of a bare `{0}` that says nothing to whoever translates it.
  const markCount = annotations.length;
  const [chrome, setChrome] = useState<Chrome>("down");
  const chromeUp = chrome !== "down";
  /**
   * Whether the section on screen lays out vertically, which the type panel needs in order to
   * take the column choice away: frond cannot paginate a vertically-written book in more than
   * one column at all. It stays in here because
   * this is the only place that knows — `resolveLayout` gets the mode from frond itself.
   */
  const [verticalBook, setVerticalBook] = useState(false);
  const [selection, setSelection] = useState<{
    cfiRange: string;
    text: string;
    anchor: SelectionAnchor;
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
  const [editingId, setEditingId] = useState<string | null>(null);
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

    // Where and when the pointer went down, and the two facts about that instant that decide
    // what the press may become. frond deliberately does not pair a press with a release: how
    // far counts as a drag and how long counts as a tap are ours (its ADR-0002).
    //
    // `hadSelection` is asked **at the press and only there**. A selection standing when the
    // finger lands means the reader is adjusting it, and the page must not move; a selection
    // that appears afterwards is the platform's own long press, and by then the page is already
    // following the finger (docs/specs/swipe-to-turn/spec.md).
    let press: {
      x: number;
      y: number;
      at: number;
      pointerType: string;
      isLink: boolean;
      hadSelection: boolean;
    } | null = null;

    // The turn the finger is dragging, once it has travelled far enough to be one. `sign` is
    // which way it is going, so that dragging back the other way can swap it for the other page
    // rather than leaving the reader pushing against a page that has stopped.
    let drag: { turn: TurnInProgress; sign: number } | null = null;

    // The last few positions of the drag, for how fast it was going when the finger left. A
    // flick is short and quick, and distance alone cannot tell it from a nudge.
    let trail: { travel: number; at: number }[] = [];

    const speedAtRelease = (): number => {
      const last = trail[trail.length - 1];
      const first = trail.find((sample) => last!.at - sample.at <= VELOCITY_WINDOW_MS);
      if (last === undefined || first === undefined || first.at === last.at) return 0;

      // Measured along the drag's own direction: a finger that turned back at the last moment
      // was not flicking forward, and its speed should not carry the page over.
      const advanced = Math.abs(last.travel) - Math.abs(first.travel);
      return Math.max(0, advanced / (last.at - first.at));
    };

    const beginDrag = (travel: number): { turn: TurnInProgress; sign: number } | null => {
      const renderer = rendererRef.current;
      const towards = navRef.current?.dragTowards(travel);
      if (!renderer || towards === undefined) return null;

      const turn = renderer.beginTurn(towards.towards, towards.from);
      if (turn === undefined) return null;

      trail = [];
      return { turn, sign: Math.sign(travel) };
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
        // Something else moved the reader — a key, a jump, a resize. The turn is already over.
        if (!turn.live) return;
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

    const endDrag = (): void => {
      const held = drag;
      drag = null;
      if (held === null) return;

      const { turn } = held;
      const distance = Math.abs(trail[trail.length - 1]?.travel ?? 0);
      const shown = turn.atBoundary
        ? dampen(distance, turn.extent)
        : Math.min(distance, turn.extent);
      const take =
        !turn.atBoundary &&
        commitsTurn({ distance, extent: turn.extent, velocity: speedAtRelease() });

      // **A page turn puts the chrome away**, this route included. Done before the animation
      // rather than after it, so the bars are not still sliding over a page that has turned.
      if (take) setChrome("down");
      settleTurn(turn, shown, take ? turn.extent : 0, take);
    };

    // When the last tap ended, so a selection arriving just after it can be blamed on the
    // browser rather than on the reader — phone browsers select a word on a plain tap, and
    // frond reports that selection exactly as it reports a deliberate one. Zeroed on the next
    // pointerdown: from that moment the reader is driving again.
    let tappedAt = 0;
    const withinTapGrace = () => tappedAt !== 0 && Date.now() - tappedAt < TAP_SELECTION_GRACE_MS;

    // Undoes a selection the reader did not ask for, and the toolbar it raised. The clearing
    // itself is frond's to do: the selection lives inside its iframe.
    const dropTapSelection = () => {
      setSelection(null);
      rendererRef.current?.clearSelection();
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
      press = {
        x: event.x,
        y: event.y,
        at: Date.now(),
        pointerType: event.pointerType,
        isLink: event.isLink,
        hadSelection: event.hasSelection,
      };
      // The reader is driving from here on, so a selection is theirs again.
      tappedAt = 0;

      // The browser does not get to act on this press as a tap of its own — that is the search
      // bar in #36, and this is the only moment early enough to stop it. Must stay synchronous:
      // frond hands this over for the duration of the listener.
      const start = { pointerType: event.pointerType, isLink: event.isLink };
      if (navRef.current?.preventsTapDefault(start)) event.preventTapDefault?.();
    };

    const onMove = (event: { x: number; y: number }) => {
      const started = press;
      if (started === null) return;
      // A mouse turns no page: the desktop has the edge buttons and the arrow keys, and a drag
      // there is how text is selected. A press that landed on a selection belongs to that
      // selection, whatever pressed it.
      if (started.pointerType === "mouse" || started.hadSelection) return;

      const dx = event.x - started.x;
      const dy = event.y - started.y;
      const travel = travelled(dx);

      if (drag === null) {
        if (!startsDrag(dx, dy)) return;
        drag = beginDrag(travel);
        if (drag === null) return;
      } else if (travel !== 0 && Math.sign(travel) !== drag.sign) {
        // Dragged back past where it started and on the other way: that is the other page being
        // asked for, so the turn is swapped rather than pinned at zero.
        drag.turn.cancel();
        drag = beginDrag(travel);
        if (drag === null) return;
      }

      trail.push({ travel, at: performance.now() });
      if (trail.length > 8) trail.shift();

      const distance = Math.abs(travel);
      drag.turn.moveTo(drag.turn.atBoundary ? dampen(distance, drag.turn.extent) : distance);
    };

    const onCancel = () => {
      press = null;
      const held = drag;
      drag = null;
      held?.turn.cancel();
    };

    const onRelease = (event: { x: number; y: number; isLink: boolean; hasSelection: boolean }) => {
      const started = press;
      press = null;

      if (drag !== null) {
        endDrag();
        return;
      }

      const dx = event.x - (started?.x ?? event.x);
      const dy = event.y - (started?.y ?? event.y);
      const ms = Date.now() - (started?.at ?? Date.now());

      // A tap that landed on a highlight opens its note. The hit test is ours because the layer
      // takes no pointer events — frond's coordinates and the painted boxes are already in the
      // same system.
      if (isTap(dx, dy, ms)) {
        const hit = paintedRef.current.find((entry) =>
          boxesContain({ x: event.x, y: event.y }, entry.boxes),
        );
        if (hit) {
          setChrome("notes");
          setEditingId(hit.annotation.id);
          return;
        }
      }

      const result = navRef.current?.onPointerEnd({ dx, dy, ms, isLink: event.isLink });
      if (result?.tap !== true) return;

      // Whatever is selected after a tap was not chosen by that tap: either the browser took a
      // word out of it (#36), or it was already there and the reader has just asked for it to go
      // away. Tapping is the only way to put a selection down by hand now that it does not also
      // turn the page.
      tappedAt = Date.now();
      const dismissing = started?.hadSelection === true || event.hasSelection;
      if (dismissing) dropTapSelection();

      // And a tap nothing else has a claim on is what raises the chrome — or puts it back down,
      // which is the same tap seen from the other state. One toggle, no timer: a chrome that
      // withdraws on its own takes the table of contents away from a reader who was still
      // reading it (ADR-0020).
      //
      // A tap that dismissed a selection is spent on that. One press, one thing.
      if (result.unclaimed && !dismissing) {
        setChrome((now) => (now === "down" ? "up" : "down"));
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

      const turn = renderer.beginTurn(towards, edge);
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

    // Read through a ref rather than closing over `attached`: the first `load` and
    // `relocate` are emitted *inside* `attach()`, before it has returned anything to
    // assign.
    //
    // **A page turn puts the chrome away**, whichever gesture asked for it — that is one half
    // of how 〈找〉 ends (CONTEXT.md 〈chrome〉), and putting it here rather than at each caller
    // is what stops a route being found later that turns a page with the interface still up.
    const pager = {
      next: () => {
        setChrome("down");
        commandTurn("next");
      },
      prev: () => {
        setChrome("down");
        commandTurn("prev");
      },
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
      const applyDirection = () => {
        setRtl(direction.rtl);
        navRef.current = createNavigator(pager, { rtl: direction.rtl });
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
      // The last percentage we knew, so a `relocate` arriving before the index is built does
      // not overwrite a real reading position with 0.
      let lastPercentage = saved?.percentage ?? 0;
      // And it is where this sitting starts from: the reader carries on from where they
      // stopped, so the ground covered is measured from there rather than from the first
      // fraction the index happens to report — which may not arrive until several pages in.
      openedAtFraction = saved?.percentage ?? null;

      const anns = (await db.annotations.where("bookId").equals(bookId).toArray()).filter(
        (a) => !a.deletedAt,
      );
      if (cancelled) return;
      setAnnotations(sortByBookOrder(anns));

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
            // Not `db.progress.put` on its own: that write is unawaited, and a reload landing
            // before it commits used to come back holding the page before this one (#173).
            rememberPosition(position);
            // Also handed to sync as a plain value, so switching app can push it without
            // waiting on an IndexedDB read first (`beaconPositions`).
            notePosition(position);
            scheduleSync();
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
            if (withinTapGrace()) {
              dropTapSelection();
              return;
            }
            // 〈標〉 displaces 〈找〉, with no exception made for either. The colour row is placed
            // against the selection's own rectangles (`toolbar-position`), and one more layer
            // for it to dodge is one more way that placement comes out wrong.
            setChrome("down");
            const container = mountRef.current?.getBoundingClientRect();
            if (!container) return;
            // The rectangles come with the event, so there is no CFI round trip here.
            const anchor = anchorFromRects(event.rects, container);
            if (!anchor) return;
            setSelection({ cfiRange: event.cfi, text: event.text, anchor });
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
            if (event.key === "ArrowLeft") navRef.current?.onSide("left");
            if (event.key === "ArrowRight") navRef.current?.onSide("right");
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

      if (e.key === "ArrowLeft") navRef.current?.onSide("left");
      if (e.key === "ArrowRight") navRef.current?.onSide("right");
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
      navRef.current = null;
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
        // Sequential, and Regular is first (`webFontsFor`): the body text is what the reader
        // is looking at, and two 16 MB fetches racing each other would only make it later.
        for (const font of webFontsFor(settings.fontFamily)) {
          let downloading = false;
          const loaded = await ensureWebFont(font, (status) => {
            if (cancelled) return;
            setWebFontStatus(status);
            // The trace comes up the moment a fetch reaches the wire and stays up across both
            // faces — it is cleared once, in `finally`, so it does not flicker off in the gap
            // between Regular finishing and Bold starting.
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
          setWebFonts((held) => [
            ...held.filter((f) => !(f.family === loaded.family && f.weight === loaded.weight)),
            loaded,
          ]);
        }
      } finally {
        if (!cancelled) setFontBusy(false);
      }
      if (cancelled) return;
      // One toast for the whole job, not one per face. The applied note wins when a downloaded
      // face is on the page — even if Bold then failed, the reader is reading in the face they
      // picked, so the failure note would contradict what is on screen. It is for when
      // nothing they picked could be had at all.
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
    const container = mountRef.current;
    if (!renderer || !container) {
      setPainted([]);
      paintedRef.current = [];
      return;
    }

    const size = { width: container.clientWidth, height: container.clientHeight };
    const next: PaintedHighlight[] = [];
    for (const annotation of annotations) {
      const boxes = visibleBoxes(renderer.rectsFor(annotation.cfiRange), size);
      // Highlights outside this section come back with no rectangles at all, and ones on
      // another page fall outside the container — `visibleBoxes` drops both.
      if (boxes.length > 0) next.push({ annotation, boxes });
    }

    setPainted(next);
    paintedRef.current = next;
  }, [renderer, annotations, geometry]);

  // position the highlight toolbar next to the selection once it has rendered
  // (we need its measured size to decide below-vs-above and to clamp on-screen)
  useLayoutEffect(() => {
    if (!selection || !toolbarRef.current) {
      setToolbarPos(null);
      return;
    }
    const el = toolbarRef.current;
    setToolbarPos(
      placeSelectionToolbar(
        selection.anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [selection]);

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
    if (withNote) {
      setChrome("notes");
      setEditingId(annotation.id);
    }
  }

  async function saveNote(id: string, note: string) {
    const now = Date.now();
    await db.annotations.update(id, { note, updatedAt: now, dirtyAt: now });
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
    setEditingId(null);
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
  const togglePanel = (panel: PanelKind) => setChrome((now) => (now === panel ? "up" : panel));
  // `index.css` draws both arrangements; this only says which state the reader is in.
  const panelOpen = isPanel(chrome);

  // Which face the one panel is wearing. It has to outlive `chrome` falling back to `"up"`,
  // because Base UI keeps the popup mounted while it slides out — read straight from `chrome`,
  // the panel would blank its own contents and spend the whole exit sliding an empty box off
  // the screen. A ref rather than state: nothing re-renders on the strength of this, it is only
  // ever read in the same pass that wrote it.
  const panelKindRef = useRef<PanelKind>("toc");
  if (isPanel(chrome)) panelKindRef.current = chrome;
  const panelKind = panelKindRef.current;

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
            onClick={() => navRef.current?.onSide("left")}
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
            <HighlightLayer painted={painted} vertical={verticalBook} />
          </div>
          <button
            className="page-btn"
            onClick={() => navRef.current?.onSide("right")}
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
          keyboard or by a screen reader (`index.css`). */}
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
        onClose={() => setChrome("up")}
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
                    setChrome("down");
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
                  setChrome("down");
                }}
                onEdit={() => setEditingId(a.id)}
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

      {selection && (
        <div
          ref={toolbarRef}
          className="highlight-toolbar"
          /* Which side of the passage this landed on, so the wedge points back at it. An
             attribute rather than a class because it is a fact about this one placement, not a
             variant of the component. */
          data-above={toolbarPos?.above ? "" : undefined}
          style={
            toolbarPos ? { left: toolbarPos.left, top: toolbarPos.top } : { visibility: "hidden" }
          }
        >
          {/* Two groups rather than six children, so the rule between them has a side to sit on
              whichever way the bar is laid out. On a phone the bar is two rows and the rule is
              the seam between them; wider, it is one row and the rule stands up (`index.css`). */}
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
      <blockquote
        onClick={onJump}
        title={t({
          message: "Jump to this passage",
          comment:
            "Tooltip on a quoted passage in the notes panel. Clicking it takes the reader to where that passage is in the book.",
        })}
      >
        {annotation.text}
      </blockquote>
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
