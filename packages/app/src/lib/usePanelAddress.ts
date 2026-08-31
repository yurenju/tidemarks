/**
 * Keeping the reader's panel layer and the address bar saying the same thing.
 *
 * Two effects facing opposite ways: one writes the address when the chrome moves, the other
 * translates a moved address into the events the chrome machine already has. **The address is
 * the chrome's mirror, not the other way round** (ADR-0046) — the state machine in
 * `lib/chrome.ts` is still the one deciding, and these two only write to whichever of the pair
 * is behind.
 *
 * ⚠️ Two effects that report each other's news is a shape that loops, and the three refs below
 * are what stop it. **Every one of the three was written after the symptom was measured**, and
 * each comment names the suite that saw it — that is the whole reason this is a file rather
 * than a paragraph in the middle of a long component.
 */

// oxlint-disable react-hooks/exhaustive-deps -- the second effect below is keyed on the address
// alone, on purpose, and its own comment says what re-running it on the chrome's news would do.
// oxlint cannot silence this rule for a single line (tested on 1.73.0 and 1.80.0), so the
// exemption is the file's -- which also covers the first effect, whose dependencies are complete
// and are meant to stay that way.

import { useEffect, useRef } from "react";
import { samePanel, type Panel as PanelAddress } from "./route";
import { isPanel, type Chrome, type ChromeEvent, type PanelKind } from "./chrome";

/** The reader's own three faces as the address spells them (`lib/route.ts`). */
export type ReaderPanel = PanelAddress & { kind: PanelKind };

export function usePanelAddress({
  panel,
  onPanel,
  chrome,
  editingId,
  bookId,
  sendChrome,
}: {
  /** What the address currently shows, and `null` for none of the three. */
  panel: ReaderPanel | null;
  /** Reports the panel layer moving, so the address can follow it. `App.tsx` decides what that
   *  does to the history stack — it is the one place that touches it. */
  onPanel: (next: ReaderPanel | null) => void;
  chrome: Chrome;
  editingId: string | null;
  bookId: string;
  /** Hands one event to the chrome machine (`lib/chrome.ts`). */
  sendChrome: (event: ChromeEvent) => void;
}): void {
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
}
