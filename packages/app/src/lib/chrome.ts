// What the reader's chrome is showing, as one value that only this file writes.
//
// The three states are mutually exclusive on purpose (CONTEXT.md [[chrome]]), but until this file
// existed that was a property of eleven scattered `setChrome` calls rather than of anything that
// could be read in one place — and reading order was the only thing saying which of two writers
// in the same frame won. That had already shipped a bug once: pressing [[Notes]] while [[Type]]
// stood, and the outgoing panel's `onClose` writing `"up"` over the panel that had just opened.
//
// **A pure function, not a `createChromeMachine()`.** Unlike the gesture machine this has no
// timer, no sampling and nothing to inject, so there is no state to hide — React keeps it, and
// two copies of a state is two copies that can drift apart.
//
// **It owns [[Find]], not [[Marking]].** A selection's rectangles, CFI and `live` stay in `Reader.tsx`,
// for the same reason the gesture machine refuses to hold frond's objects: the part of them
// hardest to fake in node is the part that matters. What lives here is the *rule* — a selection
// arriving puts the chrome away — under the name `selectionArrived`.
//
// ⚠️ **Every transition returns the same `state` object when nothing changed.** Almost every page
// turn hits that path (the chrome is usually already down), and a fresh object each time is a
// whole extra Reader render per page — which `tests/browser/reader/turn-pacing.spec.ts` measures.

/** The three panels [[Find]] can raise. A separate name so nothing can ask to "open the bar". */
export const PANEL_KINDS = ["toc", "notes", "layout"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * The one value: the book alone, the bare bars, or one of the three panels standing open.
 *
 * [[Marking]] is not in here. It is not this value's to enter: a selection arrives from frond, and what
 * it does here is put this back to `"down"`.
 */
export type Chrome = "down" | "up" | PanelKind;

/**
 * Whether one of the three is standing open — the one fact the *layout* turns on: on a desk the
 * book gives up a column to it, on a hand-held the entries and the Scrubber step aside for it.
 *
 * Written off the list rather than as a third spelling of the union. The type, the toggle and
 * this question all have to name the same three panels, and two of them can already only be
 * wrong together.
 */
export const isPanel = (chrome: Chrome): chrome is PanelKind =>
  (PANEL_KINDS as readonly string[]).includes(chrome);

export interface ChromeState {
  readonly chrome: Chrome;
  /**
   * Which of the three the panel was last showing, kept after it closes. Base UI holds the popup
   * mounted for the 180ms it takes to slide out; read straight from `chrome`, the panel would
   * blank its own contents and spend the whole exit sliding an empty box off the screen.
   */
  readonly panelKind: PanelKind;
  /**
   * Which note the notes panel has open for editing, `null` for none.
   *
   * **It lives only while the notes panel stands**, and `settle` is what ends it, so no
   * transition below has to remember to. Nothing is lost by closing early: a note commits when
   * its box loses the focus. Held any longer, the box would remount the next time [[Notes]] was
   * raised and take the focus with it — which on a phone is a reader pressing [[Notes]] to read a
   * list and getting a keyboard over it.
   */
  readonly editing: string | null;
  /**
   * Which marked passage the panel is pointing at — washed on the page.
   *
   * **It outlives the panel, and ends when the reader leaves the page it is on.** On a window
   * too narrow for the book to keep a column, pressing a quote is how a reader asks to be shown
   * the passage, and the panel has to close for them to see it — so a wash that ended with the
   * panel ended exactly when it was wanted. `turned` and `jumped` are what clear it now, along
   * with the two events that put a different answer on screen: a new selection, and [[Notes]]
   * raised again by a reader who has pressed nothing in it.
   *
   * **It is here rather than in `Reader.tsx` because every one of those already passes through
   * this file.** Held outside, it needed one writer per exit, and the ones that were missed
   * showed up as a passage lighting up on a panel the reader had just reopened.
   */
  readonly selected: string | null;
}

/** Everything that can happen to the chrome, named by what the reader did rather than by result. */
export type ChromeEvent =
  /** A tap on the page: the one way up, and one of the ways back down. */
  | { kind: "tapped" }
  /** A page turn, by any route — drag, page button, arrow key. */
  | { kind: "turned" }
  /**
   * A chapter the reader pressed to be taken to. Not merged with `turned`: one comes through
   * the gesture machine and one through a panel's `onClick`, so if they break they break in
   * different places. They no longer land on the same result either.
   *
   * `keepPanel` means the same thing it means on `notePressed`, and is answered the same way:
   * a chapter is one of a list the reader may be working down, so [[Contents]] stays standing where
   * the book it sent them to is still on screen beside it.
   */
  | { kind: "jumped"; keepPanel: boolean }
  /**
   * A marked passage the reader pressed in the notes panel.
   *
   * **`keepPanel` is the caller's answer to "is the book still visible", and it has to be:** the
   * panel takes a column from the book only above 820px (`styles/device.css`), and narrower
   * than that it is drawn over the book — where staying open would leave the reader looking at
   * the panel they pressed and none of the passage they pressed it for. Only the caller can ask
   * a media query, and this file will not grow one (`lib/media.ts` says why a layout may not
   * wait on JavaScript; this is the same boundary from the other side).
   */
  | { kind: "notePressed"; id: string; keepPanel: boolean }
  /** frond handed up a selection. [[Marking]] displaces [[Find]], with no exception made for either. */
  | { kind: "selectionArrived" }
  /** One of the three bar buttons. Pressing the one already showing drops back to the bare bar. */
  | { kind: "togglePanel"; panel: PanelKind }
  /** The panel closed itself — an outside press, Escape. */
  | { kind: "panelDismissed" }
  /** A note to open the panel on and start editing: the gesture machine's `openNote`, or having
   *  ticked "add note" while marking a passage. */
  | { kind: "openNote"; id: string }
  /** Edit pressed on a note already listed in the open panel. */
  | { kind: "editNote"; id: string }
  | { kind: "noteSaved" };

export const initialChrome: ChromeState = {
  chrome: "down",
  panelKind: "toc",
  editing: null,
  selected: null,
};

/**
 * Returns `state` itself when the event changes nothing, so React can skip the render. See the
 * warning at the top of the file: this is not a micro-optimisation, it is on the page-turn path.
 */
function settle(
  state: ChromeState,
  chrome: Chrome,
  editing: string | null,
  selected: string | null,
): ChromeState {
  // **The one place a note stops being edited.** Anything that is not the notes panel standing
  // open — the chrome going down, another face coming up, the panel being dismissed — closes the
  // editor, without the transition below having said so. This filter used to be on `selected`
  // and the two have swapped: a wash now outlives the panel and an editor does not, for the
  // reasons on each field above.
  const stillEditing = chrome === "notes" ? editing : null;
  // `panelKind` is not asked about: it only ever changes when `chrome` becomes a panel, so a
  // `chrome` that did not move cannot have moved it either.
  if (chrome === state.chrome && stillEditing === state.editing && selected === state.selected) {
    return state;
  }
  return {
    chrome,
    // Only entering a panel updates this; leaving one leaves it remembering what it was.
    panelKind: isPanel(chrome) ? chrome : state.panelKind,
    editing: stillEditing,
    selected,
  };
}

export function nextChrome(state: ChromeState, event: ChromeEvent): ChromeState {
  switch (event.kind) {
    case "tapped":
      // One toggle, no timer: a chrome that withdraws on its own takes the table of contents away
      // from a reader who was still reading it (ADR-0020).
      return settle(state, state.chrome === "down" ? "up" : "down", state.editing, state.selected);
    case "turned":
    case "selectionArrived":
      // **The two ways a wash ends other than by being replaced.** A page turn leaves the page
      // the passage is on; a selection arriving puts a second answer on the same page, and two
      // passages lit at once says neither.
      return settle(state, "down", state.editing, null);
    case "jumped":
      // Same shape as `notePressed`, and the same question behind it — see `keepPanel` there.
      // The wash goes either way: the reader has been taken somewhere else in the book.
      return settle(state, event.keepPanel ? state.chrome : "down", state.editing, null);
    case "togglePanel": {
      // **Only [[Notes]] being *raised* clears the wash**, and only that. A reader who opens the
      // list again has pressed nothing in it, so a passage lit from the last time they had it
      // open is the app answering a question nobody asked. Every other move through this event
      // leaves the reader on the page they were on with the passage they chose still lit:
      // opening [[Contents]] or [[Layout]], and closing [[Notes]] again — that last one is how a narrow
      // window looks at the passage at all.
      const raisingNotes = event.panel === "notes" && state.chrome !== "notes";
      return settle(
        state,
        state.chrome === event.panel ? "up" : event.panel,
        state.editing,
        raisingNotes ? null : state.selected,
      );
    }
    case "panelDismissed":
      // The reader is still on the page they were on, so a passage they pressed goes on being
      // washed. Closing the panel is how they get to look at it.
      return settle(
        state,
        isPanel(state.chrome) ? "up" : state.chrome,
        state.editing,
        state.selected,
      );
    case "notePressed":
      // Wide enough and the panel stays with the passage pointed at; narrower, the panel is over
      // the book and has to go. **The wash survives that either way** — it names the passage the
      // press was asking to be shown, and on the narrow window there is nothing else left saying
      // which one.
      return settle(state, event.keepPanel ? state.chrome : "down", state.editing, event.id);
    case "openNote":
      // The passage this note belongs to is the one the reader just pressed on the page, or the
      // one they just marked. Either way it is the answer to "which of these am I looking at",
      // and it costs nothing to give the same answer the panel's own quotes give.
      return settle(state, "notes", event.id, event.id);
    case "editNote":
      return settle(state, state.chrome, event.id, event.id);
    case "noteSaved":
      return settle(state, state.chrome, null, state.selected);
  }
}
