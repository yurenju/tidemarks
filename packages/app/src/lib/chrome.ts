// What the reader's chrome is showing, as one value that only this file writes.
//
// The four states are mutually exclusive on purpose (CONTEXT.md [[chrome]]), but until this file
// existed that was a property of eleven scattered `setChrome` calls rather than of anything that
// could be read in one place — and reading order was the only thing saying which of two writers
// in the same frame won. That had already shipped a bug once: pressing [[Notes]] while [[Type]]
// stood, and the outgoing panel's `onClose` writing `"up"` over the panel that had just opened.
//
// **A pure function, not a `createChromeMachine()`.** Unlike the gesture machine this has no
// timer, no sampling and nothing to inject, so there is no state to hide — React keeps it, and
// two copies of a state is two copies that can drift apart.
//
// **It owns [[Find]] and [[Reflect]], and only the second half of [[Marking]].** A selection's
// rectangles, CFI and `live` stay in `Reader.tsx`, for the same reason the gesture machine refuses
// to hold frond's objects: the part of them hardest to fake in node is the part that matters. What
// lives here is the *rule* — a selection arriving puts the chrome away, unless [[Reflect]] is
// standing — under the name `selectionArrived`. The half that is here is the note written on the
// spot, which begins once the selection has become a mark and there is nothing of frond's left.
//
// ⚠️ **Every transition returns the same `state` object when nothing changed.** Almost every page
// turn hits that path (the chrome is usually already down), and a fresh object each time is a
// whole extra Reader render per page — which `tests/browser/reader/turn-pacing.spec.ts` measures.

/** The two panels [[Find]] can raise. A separate name so nothing can ask to "open the bar". */
export const PANEL_KINDS = ["toc", "layout"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * The one value: the book alone, the bare bars, one of [[Find]]'s two panels standing open,
 * [[Reflect]], or [[Marking]] with a note being written.
 *
 * **[[Reflect]] is a state of its own and not a third panel of [[Find]]'s.** It used to be:
 * [[Notes]] was raised from the bar, so the bars and the Scrubber stood around it and the book
 * was squeezed between three layers. Looking back over what one has marked is the third step of
 * the reader's loop — read, mark, look back — and it gets the screen to itself (ADR-0020).
 *
 * **`"marking"` is the note half of [[Marking]] only.** The colour row is not in here: it is not
 * this value's to enter — a selection arrives from frond, and what it does here is put this back
 * to `"down"`, except from [[Reflect]], which it leaves standing. Pressing [[Mark and note]] on
 * that row is what puts this value at `"marking"`, and the note closing is what ends it.
 *
 * It borrows [[Reflect]]'s face — the notes panel, beside the book on a desk and over it on a
 * phone — so that a note has one place to be written at either width, but it is not [[Reflect]]:
 * the reader is still in the middle of reading, and when the note is written they go back to the
 * book rather than being left in a list they did not ask for (ADR-0020).
 */
export type Chrome = "down" | "up" | PanelKind | "reflect" | "marking";

/**
 * What the one panel is showing: [[Find]]'s two, or the list that is [[Reflect]]'s face.
 *
 * The address spells these three (`lib/route.ts`), and they are what `Reader.tsx` titles and
 * draws. Not the same list as `PANEL_KINDS`: [[Notes]] is a face without being something the bar
 * toggles.
 */
export type Face = PanelKind | "notes";

/**
 * Whether one of [[Find]]'s two is standing open.
 *
 * Written off the list rather than as another spelling of the union. The type, the toggle and
 * this question all have to name the same panels, and two of them can already only be wrong
 * together.
 *
 * **It takes a bare string** so that `lib/route.ts` can ask it of a segment out of the address
 * bar, where `about/` and `notes/` are answers this question says no to. Passing a `Chrome`
 * narrows exactly as it did.
 */
export const isPanel = (chrome: string): chrome is PanelKind =>
  (PANEL_KINDS as readonly string[]).includes(chrome);

/** Whether a segment of the address names one of the reader's own three faces. */
export const isFace = (kind: string): kind is Face => kind === "notes" || isPanel(kind);

/**
 * Which face the panel is showing, or `null` when none is — the one fact the *layout* turns on:
 * on a desk the book gives up a column to it, on a hand-held the entries and the Scrubber step
 * aside for it. [[Marking]]'s note is written on [[Reflect]]'s face, so both answer `"notes"`.
 */
export const faceOf = (chrome: Chrome): Face | null =>
  chrome === "reflect" || chrome === "marking" ? "notes" : isPanel(chrome) ? chrome : null;

export interface ChromeState {
  readonly chrome: Chrome;
  /**
   * Which face the panel was last showing, kept after it closes. Base UI holds the popup
   * mounted for the 180ms it takes to slide out; read straight from `chrome`, the panel would
   * blank its own contents and spend the whole exit sliding an empty box off the screen.
   */
  readonly face: Face;
  /**
   * Which note is open for writing, `null` for none: one being changed in [[Reflect]], or the one
   * [[Marking]] has just made.
   *
   * **It lives only while [[Reflect]] or [[Marking]] stands**, and `settle` is what ends it, so no transition
   * below has to remember to. Nothing is lost by closing early: a note commits when its box loses
   * the focus. Held any longer, the box would remount the next time [[Notes]] was raised and take
   * the focus with it — which on a phone is a reader pressing [[Notes]] to read a list and getting
   * a keyboard over it.
   */
  readonly editing: string | null;
  /**
   * Which marked passage [[Reflect]] is pointing at — washed on the page, and the one the address
   * names as its second storey (ADR-0046).
   *
   * **It outlives the panel, and ends when a page turn leaves it behind.** On a window too narrow
   * for the book to keep a column, pressing a quote is how a reader asks to be shown the passage,
   * and the panel has to close for them to see it — so a wash that ended with the panel ended
   * exactly when it was wanted. What ends it is a turn that lands on a page the passage is not on
   * (`turnLanded`), a chapter jumped to, a new selection, and [[Notes]] raised again by a reader
   * who has pressed nothing in it.
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
  /**
   * A page turn, by any route — drag, page button, arrow key — **as it begins**.
   *
   * Sent before the page slides, so the bars are not still on screen over a page that has turned.
   * That is also why it cannot say whether the passage [[Reflect]] points at is on the new page:
   * nobody knows yet. `turnLanded` says that, once the page is down.
   */
  | { kind: "turned" }
  /**
   * The page a turn was heading for is laid out, and these are the marks on it.
   *
   * **The caller's answer, and it has to be**, for the same reason `keepPanel` is: which marks
   * fall on a page is a question for the painted rectangles in `Reader.tsx`, and this file will
   * not grow a renderer. It hands over the ids rather than a yes or no so that the rule — a
   * passage stops being pointed at once it is off the page — is written here, beside the others.
   */
  | { kind: "turnLanded"; showing: readonly string[] }
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
   * A quote the reader pressed in [[Reflect]]'s list.
   *
   * **`keepPanel` is the caller's answer to "is the book still visible", and it has to be:** the
   * panel takes a column from the book only above 820px (`styles/device.css`), and narrower
   * than that it is drawn over the book — where staying open would leave the reader looking at
   * the panel they pressed and none of the passage they pressed it for. Only the caller can ask
   * a media query, and this file will not grow one (`lib/media.ts` says why a layout may not
   * wait on JavaScript; this is the same boundary from the other side).
   */
  | { kind: "notePressed"; id: string; keepPanel: boolean }
  /**
   * A marked passage the reader asked to look at: a tap on it on the page, or an address naming
   * it (`?d=notes/<book>/<note>`). **Looking, not writing** — the note is shown, not opened for
   * editing, because a reader tapping a passage they marked last week is far more often rereading
   * it than adding to it.
   */
  | { kind: "markPicked"; id: string }
  /** The address stepped back from a note to the list it is in. Nothing is pointed at any more. */
  | { kind: "pickDropped" }
  /**
   * frond handed up a selection. [[Marking]] displaces [[Find]], with no exception made for it —
   * the one exception is [[Reflect]].
   */
  | { kind: "selectionArrived" }
  /** One of [[Find]]'s two bar buttons. Pressing the one already showing drops back to the bare bar. */
  | { kind: "togglePanel"; panel: PanelKind }
  /**
   * [[Notes]], pressed in the bar or as `N` on a keyboard. From anywhere else it is the way into
   * [[Reflect]]; from inside it — where the bar has gone and only the key can be pressed — it is
   * the same as Escape.
   */
  | { kind: "notesToggled" }
  /** The panel closed itself — an outside press, Escape, the ✕. */
  | { kind: "panelDismissed" }
  /**
   * A passage has just been marked, with a colour from the row that [[Marking]] stands up.
   * `withNote` is the reader having asked to write a note on it as well — [[Mark and note]].
   */
  | { kind: "marked"; id: string; withNote: boolean }
  /** Edit pressed on a note already listed in [[Reflect]]. */
  | { kind: "editNote"; id: string }
  /** [[Done]] pressed under the note being written. */
  | { kind: "noteSaved" };

export const initialChrome: ChromeState = {
  chrome: "down",
  face: "toc",
  editing: null,
  selected: null,
};

/**
 * The state a reader arriving on an address that already names a face starts in (ADR-0046).
 *
 * **Computed before the first render rather than applied by an effect afterwards.** The address
 * and this value mirror each other, and each writes to the other when they disagree — so a first
 * frame in which the chrome is down while the address says [[Notes]] is a frame in which the mirror
 * reads a disagreement and answers it by clearing the address the reader just typed.
 *
 * **A note the address names comes back pointed at, not open for editing.** The second storey
 * of `notes/` is the passage [[Reflect]] is pointing at, so a refresh puts the reader back in
 * front of the same note rather than in a box with a keyboard over it.
 *
 * A note id nobody can find is not caught here — whether the mark still exists is a question for
 * the database, and `Reader.tsx` lets go of it and lets the mirror correct the address.
 */
export function chromeShowing(face: Face | null, noteId: string | null): ChromeState {
  if (face === null) return initialChrome;
  if (face === "notes") return { chrome: "reflect", face, editing: null, selected: noteId };
  return { chrome: face, face, editing: null, selected: null };
}

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
  // **The one place a note stops being edited.** Anything that is not [[Reflect]] or [[Marking]]
  // standing — the chrome going down, a face of [[Find]]'s coming up, the panel being dismissed —
  // closes the editor, without the transition below having said so. A wash outlives [[Reflect]]
  // and an editor does not, for the reasons on each field above.
  const stillEditing = faceOf(chrome) === "notes" ? editing : null;
  // **And [[Marking]]'s half of this value is the note**, so the note closing — [[Done]], or the
  // mark under it deleted — is [[Marking]] over, and what is left is the book. Said once here
  // rather than at each event that can close a note, for the same reason as the line above.
  const next = chrome === "marking" && stillEditing === null ? "down" : chrome;
  // **The passage [[Marking]] points at is the note being written, and goes with it.** Unlike
  // [[Reflect]]'s wash, it was never the reader asking to be shown a passage — they are back in
  // [[Read]], and a lit passage there is a question nobody asked. A press that points somewhere
  // new on the way out is the reader's own, and stays: a quote pressed on a narrow window.
  const pointed =
    state.chrome === "marking" && next === "down" && selected === state.selected ? null : selected;
  // `face` is not asked about: it only ever changes when `chrome` gets a face, so a `chrome` that
  // did not move cannot have moved it either.
  if (next === state.chrome && stillEditing === state.editing && pointed === state.selected) {
    return state;
  }
  return {
    chrome: next,
    // Only entering a face updates this; leaving one leaves it remembering what it was.
    face: faceOf(next) ?? state.face,
    editing: stillEditing,
    selected: pointed,
  };
}

/**
 * Where an event that puts [[Find]] away leaves the chrome: down, unless [[Reflect]] is standing,
 * which a turn and a selection both leave where it is (see each below for why).
 */
const reflectOrDown = (chrome: Chrome): Chrome => (chrome === "reflect" ? "reflect" : "down");

/**
 * Where a press on something old in the list leaves the chrome. [[Marking]]'s note is written on
 * [[Reflect]]'s face, so the list is there beside it, and reaching into it is looking back.
 */
const lookingBack = (chrome: Chrome): Chrome => (chrome === "marking" ? "reflect" : chrome);

export function nextChrome(state: ChromeState, event: ChromeEvent): ChromeState {
  switch (event.kind) {
    case "tapped":
      // One toggle, no timer: a chrome that withdraws on its own takes the table of contents away
      // from a reader who was still reading it (ADR-0020). From [[Reflect]] it goes down rather
      // than up, like every other face: a reader tapping the page beside their notes wants the
      // book, and a second tap is all it takes to have the bars as well.
      return settle(state, state.chrome === "down" ? "up" : "down", state.editing, state.selected);
    case "turned":
      // **[[Reflect]] stays through a turn**, and [[Find]] does not. A passage that runs over the
      // page is read by turning, and a reader working down their notes is moving through the book
      // on purpose — [[Reflect]] is a place they walked into and have a door out of. [[Find]] is the
      // chrome lent for a moment, and a turn says the moment is over. Whether the passage pointed
      // at is still on the page is `turnLanded`'s to answer.
      return settle(state, reflectOrDown(state.chrome), state.editing, state.selected);
    case "turnLanded":
      // Still on the page — a passage that runs across the turn — and it goes on being pointed
      // at; gone, and nothing is. A wash left on a passage the reader cannot see would leave the
      // list dimmed around a card that matches nothing on screen.
      return settle(
        state,
        state.chrome,
        state.editing,
        state.selected !== null && event.showing.includes(state.selected) ? state.selected : null,
      );
    case "selectionArrived":
      // **[[Reflect]] is the one exception to [[Marking]] displacing what stands.** A reader looking
      // over what they marked who sees one more thing worth marking is doing what [[Reflect]] is for,
      // and the new mark joins the list they are looking at. [[Find]] gets no such exception: it is
      // a moment's chrome, and a selection says the moment has passed.
      //
      // The wash goes either way: a selection puts a second answer on the same page, and two
      // passages lit at once says neither. So does a note being written — its box has just lost
      // the focus to the page, which is what commits it.
      return settle(state, reflectOrDown(state.chrome), null, null);
    case "jumped":
      // Same shape as `notePressed`, and the same question behind it — see `keepPanel` there.
      // The wash goes either way: the reader has been taken somewhere else in the book.
      return settle(state, event.keepPanel ? state.chrome : "down", state.editing, null);
    case "togglePanel":
      // Opening [[Contents]] or [[Layout]] leaves the reader on the page they were on, with the
      // passage they chose still lit.
      return settle(
        state,
        state.chrome === event.panel ? "up" : event.panel,
        state.editing,
        state.selected,
      );
    case "notesToggled":
      // Inside, it is Escape. Outside, it raises the list with **nothing pointed at**: a reader who
      // opens it has pressed nothing in it, so a passage still lit from the last time is the app
      // answering a question nobody asked.
      if (state.chrome === "reflect") return settle(state, "down", null, state.selected);
      return settle(state, "reflect", null, null);
    case "panelDismissed":
      // The reader is still on the page they were on, so a passage they pressed goes on being
      // washed. Closing the panel is how they get to look at it. [[Find]]'s two drop back to the
      // bare bar they were raised from; [[Reflect]] and [[Marking]]'s note were not raised from
      // it, and go back to [[Read]].
      if (isPanel(state.chrome)) return settle(state, "up", state.editing, state.selected);
      return settle(
        state,
        faceOf(state.chrome) === "notes" ? "down" : state.chrome,
        state.editing,
        state.selected,
      );
    case "notePressed":
      // Wide enough and the panel stays with the passage pointed at; narrower, the panel is over
      // the book and has to go. **The wash survives that either way** — it names the passage the
      // press was asking to be shown, and on the narrow window there is nothing else left saying
      // which one. A quote pressed beside [[Marking]]'s note is the reader looking back over the
      // list, which is [[Reflect]] — and the note they were writing has just lost the focus to
      // another card, which is what commits it, so it closes rather than standing open in a list
      // now pointing somewhere else.
      return settle(
        state,
        event.keepPanel ? lookingBack(state.chrome) : "down",
        state.chrome === "marking" ? null : state.editing,
        event.id,
      );
    case "markPicked":
      // From [[Read]] into [[Reflect]], or from one note to another inside it. Either way a box being
      // written in has just lost the focus to the page, and is done.
      //
      // **Beside [[Marking]]'s note it is a tap on the page like any other**, and goes back to
      // [[Read]]: the passage under the reader's finger is most often the one they have just
      // marked, and a tap is how they say the note is written. A second tap is [[Reflect]].
      if (state.chrome === "marking") return settle(state, "down", null, state.selected);
      return settle(state, "reflect", null, event.id);
    case "pickDropped":
      return settle(state, state.chrome, null, null);
    case "marked":
      if (state.chrome === "reflect") {
        // **In [[Reflect]] the new mark joins the list the reader is looking at**, pointed at, and
        // a note on it is written there — the reader came to look back, and stays to.
        return settle(state, "reflect", event.withNote ? event.id : state.editing, event.id);
      }
      // **Anywhere else, a note is written where it was thought of** (ADR-0020): [[Marking]]
      // keeps standing with the box open and no chrome around it, and [[Done]] goes back to the
      // book. The new mark is pointed at while it is written — washed on the page, so the reader
      // can see which words the note is about, and selected in the list, which is what puts
      // [[Delete]] on its card for a reader who changes their mind. Without a note, nothing
      // moves: marking a passage in [[Read]] is the whole act.
      if (event.withNote) return settle(state, "marking", event.id, event.id);
      return state;
    case "editNote":
      // Changing an old note is looking back, so from beside [[Marking]]'s note it is [[Reflect]].
      return settle(state, lookingBack(state.chrome), event.id, event.id);
    case "noteSaved":
      // In [[Reflect]] the panel stays with the passage pointed at; in [[Marking]] the note was
      // the whole of it, and `settle` takes the reader back to the book.
      return settle(state, state.chrome, null, state.selected);
  }
}
