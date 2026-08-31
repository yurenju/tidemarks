import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Renderer } from "@yurenju/frond/renderer";
import type { GestureEvent, GestureIntent } from "./gesture";
import type { Select } from "./route";
import { selectionEnds, type Rect, type SelectionEnds } from "./selection-handles";
import {
  anchorFromRects,
  handleBoxes,
  placeSelectionToolbar,
  type SelectionAnchor,
  type ToolbarPlacement,
} from "./toolbar-position";

/**
 * The whole life of a selection, from the long press that begins one to the colour row that ends
 * it: the state, the geometry, the two coordinate systems, and every route in.
 *
 * It was fourteen places in `Reader.tsx`, six hundred lines apart, with `openBook`, page turns and
 * font downloads in between — and the clearest evidence that the split cost something is that the
 * file held two byte-identical functions for putting a selection away, one inside the open effect
 * and one outside it, because neither could reach the other. They are `clear()` now.
 *
 * ## ⚠️ Why the commands hang off a ref
 *
 * This is the one thing here that turns nothing red when it is written wrong, so it is the one
 * thing to read before changing this file.
 *
 * The effect that opens a book depends on `[bookId]` alone — **it runs once per book**. What it
 * closes over must therefore be something that always points at *now*, not a function whose
 * identity is renewed on every render. `Reader.tsx` already works this way for the same reason:
 * `selectionRef`, `ownSelectionRef` and `handlesRef` all exist to give a once-per-book closure a
 * live reading.
 *
 * So the command half of what this returns hangs off a ref, and is read as
 * `commands.current.apply(...)`. Returning a set of `useCallback(fn, [])` functions **would also
 * work**, and its correctness would rest on a rule nothing enforces: *these dependency arrays may
 * never grow*. The day somebody adds one to fix something small, the function takes a new
 * identity — and the effect took the old one the moment the book opened. Type check passes, tests
 * pass, and the book misbehaves under a real finger.
 *
 * The seven characters of `.current` are what turns that trap from invisible into visible: the
 * reader of this code sees `.current` and knows the value is being read *now* rather than at
 * render time, which is exactly where the reminder is needed.
 *
 * ## What stays outside
 *
 * The gesture machine, because it decides page turns as well — it belongs to the open book
 * (`lib/book-session.ts`). So nothing here reaches it: two commands hand a value back for the
 * session to send on — `apply` reports a refusal and `handlePointer` returns the event it means
 * — and the one question that runs the other way, whether a tap is to blame for a selection,
 * arrives as the `blamesTap` prop. `send` itself is unreachable from out here in any case: it
 * lives inside the session, which exists only while a book is open.
 *
 * `addAnnotation` stays there too: a mark is a row in Dexie that the notes
 * panel and the highlight layer both read, which makes it the reader's data rather than the
 * selection's (CONTEXT.md [[Mark]] against [[Marking]], one `ing` apart).
 */

/** The selection the app drew itself: what to wash, and the two ends to take hold of. */
export interface DrawnSelection {
  readonly rects: readonly Rect[];
  readonly ends: SelectionEnds;
}

/** The five things the gesture machine can ask of a selection (`lib/gesture.ts`). */
type SelectionIntent = Extract<
  GestureIntent,
  {
    kind:
      "beginSelection" | "extendSelection" | "holdSelection" | "settleSelection" | "dropSelection";
  }
>;

/** A selection frond drew and is reporting, as it arrives from the renderer. */
interface NativeSelectionEvent {
  readonly cfi?: string;
  readonly text: string;
  readonly rects: readonly DOMRect[];
}

/**
 * Everything that acts on the selection, read through `.current` at the moment it is called.
 *
 * See the note at the top of this file before reaching for a plain callback instead.
 */
export interface SelectionCommands {
  /**
   * Carries out one of the machine's selection intents.
   *
   * Returns **false only when a `beginSelection` found nothing to select** — a press on a margin,
   * a picture, the gap between paragraphs. The machine has to be told about that one, or it spends
   * the rest of the press extending nothing; every other intent returns true.
   */
  apply(intent: SelectionIntent): boolean;
  /** A selection the browser drew, as frond reports it. */
  acceptNative(event: NativeSelectionEvent): void;
  /** The passage `?select=` named, once the book has arrived wherever `?at=` sent it. */
  applyAddress(select: Select, handles: boolean): void;
  /** Which of the two selections the pointer now in the reader's hand gets (ADR-0036). */
  notePointer(pointerType: string): void;
  /**
   * A pointer on one of the two handles, in client coordinates.
   *
   * Returns the gesture event it means, for the open book's session to hand to the machine
   * (`lib/book-session.ts`), or `null` when there is no drawn selection to take hold of.
   */
  handlePointer(
    kind: "down" | "move" | "up" | "cancel",
    end: "start" | "end",
    at: { clientX: number; clientY: number },
  ): GestureEvent | null;
  /** Whether anything is selected, read live rather than at the last render. */
  hasSelection(): boolean;
  /** Whether the selection in force is ours to draw rather than the browser's (ADR-0036). */
  ownsSelection(): boolean;
  /**
   * Puts a selection away, in the document as well as in this hook's state.
   *
   * Both halves, always. The second is frond's to do — a browser-drawn selection lives inside its
   * iframe — and it is harmless where the selection was ours, because there is nothing there to
   * clear. What stays behind otherwise is the browser's own selection sitting under the colour:
   * invisible as a decision and very much alive as a fact, since the next press reports
   * `hasSelection`, and a press that lands on a selection is the reader adjusting it, so the page
   * would not follow it.
   *
   * Called for a selection the reader did not ask for (a phone browser's tap-to-select), for one
   * they have asked to be rid of, for one a page turn has carried off, and for the passage that
   * has just been marked.
   */
  clear(): void;
  /**
   * Drops a selection only if it is one we drew.
   *
   * For the page moving under it: our rectangles are then measurements of somewhere the reader can
   * no longer see. A browser-drawn selection is frond's to report on, and it says so itself
   * through `acceptNative` when the page it was on goes.
   */
  dropDrawn(): void;
}

/** What the reader draws from: the wash and handles, the colour row, and the passage under it. */
export interface SelectionView {
  /** Geometry of a selection we drew, for `SelectionLayer`. `null` where the browser drew it. */
  drawn: DrawnSelection | null;
  /** The passage itself, for whoever writes the mark down. */
  passage: { cfiRange: string; text: string } | null;
  toolbar: {
    /**
     * [[Marking]] waits for the finger to lift. While it is still down the reader has the wash and
     * the two handles and nothing else — a colour row raised mid-drag would sit under the finger
     * that raised it and chase the selection across the page (CONTEXT.md [[chrome]]).
     */
    showing: boolean;
    ref: RefObject<HTMLDivElement | null>;
    /** `null` until the row has been rendered and measured; it is hidden for that one frame. */
    at: ToolbarPlacement | null;
    onMark: (color: string, withNote: boolean) => void;
    onDismiss: () => void;
  };
}

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

// A rectangle frond reported, kept as a plain value. `DOMRect`s from a document that has since
// relaid out are not wrong so much as meaningless, and holding one in state invites reading it
// later; four numbers cannot be mistaken for a live measurement.
const toRect = (rect: DOMRect): Rect => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

export function useSelection({
  renderer,
  mount,
  vertical,
  blamesTap,
  onArrived,
  onMark,
}: {
  /** frond's renderer, which arrives once the book has opened and is gone again when it closes. */
  renderer: RefObject<Renderer | null>;
  /** frond's container, which every rectangle here is measured against. */
  mount: RefObject<HTMLDivElement | null>;
  /** Whether the section on screen lays out vertically — the axis the handles hang off. */
  vertical: boolean;
  /**
   * Whether a tap of the reader's is to blame for a selection the browser has just reported.
   *
   * The gesture machine's question, and only its (`lib/gesture.ts`). A pure read of when the last
   * tap was, so it costs nothing to ask.
   */
  blamesTap: (at: number) => boolean;
  /** A selection has arrived, so [[Marking]] displaces [[Find]] (CONTEXT.md [[chrome]]). */
  onArrived: () => void;
  /** A colour on the row was pressed. Writing the mark down is `Reader.tsx`'s (see above). */
  onMark: (color: string, withNote: boolean) => void;
}): { commands: RefObject<SelectionCommands>; view: SelectionView } {
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
     * [[Marking]] waits for that finger to lift (CONTEXT.md [[chrome]]): a colour row raised mid-drag
     * appears under the finger that raised it and then chases the selection across the page.
     * Always false for a browser-drawn selection, which is only reported once it has settled.
     */
    live: boolean;
  } | null>(null);
  // Read from inside the book's open effect, which closed over its own scope before any selection
  // existed. A press landing in the margin has no `hasSelection` of its own to report — frond
  // answers that for the presses inside the book, and out here this is the same answer.
  const selectionRef = useRef<typeof selection>(null);
  selectionRef.current = selection;
  /**
   * Whether the pointer in the reader's hand gets the selection we draw (ADR-0036).
   *
   * The opening guess, from the media query, and then whatever the pointers have said since
   * (`notePointer`). A ref rather than state because nothing renders from it — it decides what a
   * gesture means and what the book's `user-select` is, and both of those are read at the moment
   * the pointer moves, not at the next paint.
   */
  const ownSelectionRef = useRef(coarsePointer());
  // Read from inside the open effect too, which closed over its scope before the first section had
  // laid out. Which axis a selection's handles hang off depends on it.
  const verticalRef = useRef(vertical);
  verticalRef.current = vertical;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPlacement | null>(null);

  /**
   * Puts a range frond has just located on screen as the selection.
   *
   * The one route into [[Marking]] for a selection we drew, so everything that has to be true of one
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
    const container = mount.current?.getBoundingClientRect();
    if (!container) return;
    const anchor = anchorFromRects(facts.rects, container);
    const ends = selectionEnds(facts.rects, verticalRef.current);
    if (!anchor || !ends) return;

    // [[Marking]] displaces [[Find]], same as the browser-drawn route below.
    onArrived();
    setSelection({
      cfiRange: facts.cfi,
      text: facts.text,
      anchor,
      drawn: { rects: facts.rects.map(toRect), ends },
      live,
    });
  };

  const clear = (): void => {
    setSelection(null);
    renderer.current?.clearSelection();
  };

  /**
   * Puts a passage on screen as a selection, by whichever of the two routes was asked for.
   *
   * **The geometry is asked for first on both routes**, so a range that resolves to nothing at
   * all is reported rather than handed on: `showRange` drops a range with no rectangles, and it
   * does so *after* having put [[Find]] away, which would leave a bare page and no account of why.
   *
   * ⚠️ **It does not tell "on this page" from "further down this section".** `rectsFor` reports
   * true geometry wherever the passage is — clipping is the consumer's policy (frond ADR-0002)
   * — so a phrase found three pages on comes back with rectangles and gets selected, with the
   * colour row anchored off the page. Measured, both routes behave that way. Which page the
   * reader lands on is `?at=`'s answer, not this one's, so nothing here overrides it.
   */
  const placeSelection = (target: Renderer, cfi: string, handles: boolean): void => {
    const facts = target.rangeFactsFor(cfi);
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
    target.setNativeSelection(!handles);

    if (handles) {
      // The one entry the reader's own long press goes through, so what is on screen is what a
      // finger produces — the collapse of [[Find]], both coordinate systems, the handles.
      showRange(facts, false);
      return;
    }

    target.selectRange(cfi);
  };

  const next: SelectionCommands = {
    apply(intent) {
      switch (intent.kind) {
        case "beginSelection": {
          const facts = renderer.current?.rangeFromPoints(intent.at, intent.at, "word");
          if (!facts) return false;
          showRange(facts, true);
          return true;
        }
        case "extendSelection": {
          // `"char"` rather than `"word"`: the word granularity is spent on the first snap, and
          // from then on the reader is choosing where the passage ends. The two platforms differ
          // — iOS extends by character, Android snaps to words — and character is the one the
          // reader can always reach the other from. ⚠️ Whether it is fiddly on a real phone is one
          // for the device trip; changing it is changing this argument.
          const facts = renderer.current?.rangeFromPoints(intent.from, intent.to, "char");
          // A finger over a margin, a picture, or past the end of the column has moved off the
          // text rather than to the end of it — the selection stays where the reader last had it.
          if (facts) showRange(facts, true);
          return true;
        }
        case "holdSelection":
          setSelection((now) => (now === null ? null : { ...now, live: true }));
          return true;
        case "settleSelection":
          // [[Marking]] may stand up now the finger has finished (CONTEXT.md [[chrome]]).
          setSelection((now) => (now === null ? null : { ...now, live: false }));
          return true;
        case "dropSelection":
          clear();
          return true;
      }
    },

    acceptNative(event) {
      if (event.cfi === undefined || event.text.trim() === "") {
        setSelection(null);
        return;
      }
      // A word the tap selected, not a passage the reader chose (#36). It arrives on either side
      // of `pointerup` depending on the browser, so it is caught here as well as in the tap
      // branch of the machine. Asked rather than answered here: only the gesture machine knows,
      // and it belongs to the open book because it decides page turns as well
      // (`lib/book-session.ts`).
      if (blamesTap(performance.now())) {
        clear();
        return;
      }
      // [[Marking]] displaces [[Find]], with no exception made for either. The colour row is placed
      // against the selection's own rectangles (`toolbar-position`), and one more layer
      // for it to dodge is one more way that placement comes out wrong.
      onArrived();
      const container = mount.current?.getBoundingClientRect();
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

    /**
     * Puts the passage `?select=` named on screen already selected, so the colour row is up and
     * the next press draws a mark (#128, `lib/route.ts`).
     *
     * This half is only about **finding the passage**; `placeSelection` above puts it on screen.
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
    applyAddress(select, handles) {
      const target = renderer.current;
      if (target === null) return;
      if (select.kind === "text") {
        const found = target.findText(select.text);
        if (found === undefined) {
          console.warn(`?select=: "${select.text}" is not in the section on screen`);
          return;
        }
        return placeSelection(target, found, handles);
      }
      placeSelection(target, select.cfi, handles);
    },

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
    notePointer(pointerType) {
      const ours = pointerType !== "mouse";
      if (ours === ownSelectionRef.current) return;
      ownSelectionRef.current = ours;
      renderer.current?.setNativeSelection(!ours);
      if (ours) renderer.current?.clearSelection();
    },

    handlePointer(kind, end, at) {
      const ends = selectionRef.current?.drawn?.ends;
      if (ends === undefined) return null;
      const box = mount.current?.getBoundingClientRect();
      const point = { x: at.clientX - (box?.left ?? 0), y: at.clientY - (box?.top ?? 0) };

      switch (kind) {
        case "down":
          return { kind: "handleDown", end, point, ends };
        case "move":
          return { kind: "handleMove", point };
        case "up":
        case "cancel":
          return { kind: "strayRelease" };
      }
    },

    hasSelection: () => selectionRef.current !== null,
    ownsSelection: () => ownSelectionRef.current,
    clear,
    dropDrawn: () => setSelection((now) => (now?.drawn ? null : now)),
  };
  // Renewed on every render so the closures above read this render's props, and read through
  // `.current` so the book's open effect — which ran once, before most of them existed — reaches
  // the current set rather than the one it closed over. See the note at the top of this file.
  const commands = useRef(next);
  commands.current = next;

  // Place the highlight toolbar once it has rendered: its measured size is what decides which
  // sides of the passage it fits beside, and where the resting line falls when none of them do.
  useLayoutEffect(() => {
    if (!selection || !toolbarRef.current) {
      setToolbarPos(null);
      return;
    }
    const el = toolbarRef.current;
    const container = mount.current?.getBoundingClientRect();
    // Where the two beads are, so the row can be placed off them. Only a selection we drew has
    // handles; a browser-drawn one on the desk has none to avoid.
    const ends = selection.drawn?.ends;
    setToolbarPos(
      placeSelectionToolbar(
        selection.anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        {
          vertical,
          handles: ends && container ? handleBoxes(ends, container) : [],
        },
      ),
    );
    // `mount` is a ref and never changes identity; the two that decide the placement are here.
  }, [selection, vertical, mount]);

  return {
    commands,
    view: {
      drawn: selection?.drawn ?? null,
      passage: selection ? { cfiRange: selection.cfiRange, text: selection.text } : null,
      toolbar: {
        showing: selection !== null && !selection.live,
        ref: toolbarRef,
        at: toolbarPos,
        onMark,
        onDismiss: clear,
      },
    },
  };
}
