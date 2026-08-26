// What the reader's chrome is showing, as one value that only this file writes.
//
// The three states are mutually exclusive on purpose (CONTEXT.md 〈chrome〉), but until this file
// existed that was a property of eleven scattered `setChrome` calls rather than of anything that
// could be read in one place — and reading order was the only thing saying which of two writers
// in the same frame won. That had already shipped a bug once: pressing 〈Notes〉 while 〈Type〉
// stood, and the outgoing panel's `onClose` writing `"up"` over the panel that had just opened.
//
// **A pure function, not a `createChromeMachine()`.** Unlike the gesture machine this has no
// timer, no sampling and nothing to inject, so there is no state to hide — React keeps it, and
// two copies of a state is two copies that can drift apart.
//
// **It owns 〈找〉, not 〈標〉.** A selection's rectangles, CFI and `live` stay in `Reader.tsx`,
// for the same reason the gesture machine refuses to hold frond's objects: the part of them
// hardest to fake in node is the part that matters. What lives here is the *rule* — a selection
// arriving puts the chrome away — under the name `selectionArrived`.
//
// ⚠️ **Every transition returns the same `state` object when nothing changed.** Almost every page
// turn hits that path (the chrome is usually already down), and a fresh object each time is a
// whole extra Reader render per page — which `tests/browser/reader/turn-pacing.spec.ts` measures.

/** The three panels 〈找〉 can raise. A separate name so nothing can ask to "open the bar". */
export const PANEL_KINDS = ["toc", "notes", "layout"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * The one value: the book alone, the bare bars, or one of the three panels standing open.
 *
 * 〈標〉 is not in here. It is not this value's to enter: a selection arrives from frond, and what
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
  /** Which note the notes panel has open for editing, `null` for none. */
  readonly editing: string | null;
}

/** Everything that can happen to the chrome, named by what the reader did rather than by result. */
export type ChromeEvent =
  /** A tap on the page: the one way up, and one of the ways back down. */
  | { kind: "tapped" }
  /** A page turn, by any route — drag, page button, arrow key. */
  | { kind: "turned" }
  /** A chapter or a note the reader pressed to be taken to. Not merged with `turned`: one comes
   *  through the gesture machine and one through a panel's `onClick`, so if they break they break
   *  in different places. Landing on the same result is a coincidence. */
  | { kind: "jumped" }
  /** frond handed up a selection. 〈標〉 displaces 〈找〉, with no exception made for either. */
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

export const initialChrome: ChromeState = { chrome: "down", panelKind: "toc", editing: null };

/**
 * Returns `state` itself when the event changes nothing, so React can skip the render. See the
 * warning at the top of the file: this is not a micro-optimisation, it is on the page-turn path.
 */
function settle(state: ChromeState, chrome: Chrome, editing: string | null): ChromeState {
  // `panelKind` is not asked about: it only ever changes when `chrome` becomes a panel, so a
  // `chrome` that did not move cannot have moved it either.
  if (chrome === state.chrome && editing === state.editing) return state;
  return {
    chrome,
    // Only entering a panel updates this; leaving one leaves it remembering what it was.
    panelKind: isPanel(chrome) ? chrome : state.panelKind,
    editing,
  };
}

export function nextChrome(state: ChromeState, event: ChromeEvent): ChromeState {
  switch (event.kind) {
    case "tapped":
      // One toggle, no timer: a chrome that withdraws on its own takes the table of contents away
      // from a reader who was still reading it (ADR-0020).
      return settle(state, state.chrome === "down" ? "up" : "down", state.editing);
    case "turned":
    case "jumped":
    case "selectionArrived":
      // `editing` survives: a reader half way through a note who taps the page to see it clearly
      // has not thrown those words away.
      return settle(state, "down", state.editing);
    case "togglePanel":
      return settle(state, state.chrome === event.panel ? "up" : event.panel, state.editing);
    case "panelDismissed":
      return settle(state, isPanel(state.chrome) ? "up" : state.chrome, state.editing);
    case "openNote":
      return settle(state, "notes", event.id);
    case "editNote":
      return settle(state, state.chrome, event.id);
    case "noteSaved":
      return settle(state, state.chrome, null);
  }
}
