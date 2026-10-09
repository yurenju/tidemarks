import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import type { Annotation } from "../lib/types";
import { relativeAge } from "../lib/revisit";
import { AGE_LABELS } from "./age-labels";

/**
 * The row over a note that says when the passage was marked, with [[Edit note]] and [[Delete]] at
 * its end — on a desk's card in [[Notes]] (`AnnotationItem`) and on a phone's one-note page
 * (`NotePage`). **One row for both, so [[Delete]] asks the same question in the same way at
 * either width**: a reader who has learned that the focus waits on [[Cancel]] on one has learned
 * it for the other.
 *
 * **What it says is about the mark rather than part of it**: how long ago, and — where the reader
 * is looking at this one — the day itself. The same ladder the shelf's card climbs
 * (`lib/revisit.ts`) and the same words (`age-labels.ts`): a reader who meets "Last month" on the
 * shelf meets it here too.
 */
export default function AnnotationHead({
  annotation,
  dated,
  saysJustTheMark,
  editing,
  selected,
  className,
  onEdit,
  onRemove,
}: {
  annotation: Annotation;
  /** Whether the exact day stands after how long ago — on the one note the reader is looking at. */
  dated: boolean;
  /** Whether a mark with no note says so in this row. A desk's card does; the phone's page has
   *  the dashed [[Write a note…]] box saying it already. */
  saysJustTheMark: boolean;
  /** Whether the note is open for writing, which is the reader having moved on from a question. */
  editing: boolean;
  /** Whether this is the mark the reader is pointing at. */
  selected: boolean;
  className?: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { i18n } = useLingui();
  const showsNote = !editing && annotation.note !== "";

  /**
   * **[[Delete]] asks first, in the row itself.** Readers deleted notes they meant to keep, and a
   * note is their own words with nowhere to get them back from. The question takes the place of
   * the row rather than opening a dialog: the reader is looking at this note, and a dialog in the
   * middle of the screen would take them away from the passage being asked about.
   *
   * It ends on its own when the note starts being edited — the reader has moved on to something
   * else. Closing the panel needs nothing here: the drawer unmounts what it held, and the
   * question with it.
   *
   * Only the move *into* editing ends it, so that [[Delete]] pressed while the box is open still
   * asks rather than doing nothing.
   */
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (editing) setConfirming(false);
  }, [editing]);
  // And when the reader points at another passage: on a desk the tools are only on the selected
  // card, so a question left standing on one that has stepped back would be asking about a card
  // whose [[Delete]] is no longer there to hand the focus back to. Only the move *away* ends it,
  // so a row that was never selected can still ask.
  useEffect(() => {
    if (!selected) setConfirming(false);
  }, [selected]);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  /** Set by the reader stepping back from the question — and only then is the focus handed back. */
  const declinedRef = useRef(false);
  const decline = () => {
    declinedRef.current = true;
    setConfirming(false);
  };
  useEffect(() => {
    // Cancel holds the focus while the question stands, so the press that is one Enter away is
    // the one that changes nothing. When the reader steps back from it, the focus goes back to
    // the [[Delete]] that asked — the focused button is removed, which would otherwise drop the
    // focus to the top of the document (ADR-0021). Not when editing ended it: the box has just
    // taken the focus, and taking it back would leave the reader typing into nothing. A confirmed
    // deletion takes the whole note away, and the focus with it, as a single press always did.
    if (confirming) {
      cancelRef.current?.focus();
    } else if (declinedRef.current) {
      declinedRef.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);
  const questionId = useId();

  if (confirming) {
    return (
      <div
        className={`annotation-head annotation-confirm${className ? ` ${className}` : ""}`}
        role="group"
        aria-labelledby={questionId}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Kept from the panel, which would otherwise take Escape as its own and close: the
          // reader asked to step back from a deletion, not to leave the notes.
          e.stopPropagation();
          decline();
        }}
      >
        <p id={questionId} className="annotation-confirm-question">
          {annotation.note ? (
            <Trans comment="Asked in place of the date row over a note in the notes panel — a card on a desk, the one-note page on a phone — for a passage that carries a note, after Delete was pressed. Names both, because the note is the reader's own writing and goes with the mark.">
              Delete this mark and its note?
            </Trans>
          ) : (
            <Trans comment="Asked in place of the date row over a note in the notes panel — a card on a desk, the one-note page on a phone — for a passage with no note, after Delete was pressed.">
              Delete this mark?
            </Trans>
          )}
        </p>
        {/* Together, so a narrow row wraps the question over both rather than one answer under
            the other. */}
        <span className="annotation-confirm-answers">
          <button type="button" className="danger" onClick={onRemove}>
            <Trans comment="The button that actually deletes, in the question asked in place of the date row over a note in the notes panel. Shares its entry with the Delete that asked.">
              Delete
            </Trans>
          </button>
          {/* Last, at the end of the row where [[Delete]] stood a moment ago, so a second press
              on the same spot — a double tap, an impatient click — finds the answer that keeps
              the note rather than the one that removes it. */}
          <button type="button" ref={cancelRef} onClick={decline}>
            <Trans comment="Button that answers 'no' to a question asked in place, and puts things back as they were. In the notes panel it keeps the mark and its note.">
              Cancel
            </Trans>
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={`annotation-head${className ? ` ${className}` : ""}`}>
      <p className="annotation-when">
        {i18n._(AGE_LABELS[relativeAge(Date.now(), annotation.createdAt)])}
        {/* The exact day on the note being looked at, small. The ladder above is the right
            answer for scanning a list and the wrong one for "when did I write this". */}
        {dated && (
          <span className="annotation-date">
            {new Intl.DateTimeFormat(i18n.locale, { month: "numeric", day: "numeric" }).format(
              annotation.createdAt,
            )}
          </span>
        )}
        {saysJustTheMark && annotation.note === "" && (
          <>
            {" · "}
            <Trans comment="After how long ago a passage was marked, on a card in the notes panel for a mark with no note written under it — '3 days ago · Just the mark'. Says what the card is, not that something is missing.">
              Just the mark
            </Trans>
          </>
        )}
      </p>
      <span className="annotation-tools">
        {showsNote && (
          <button type="button" onClick={onEdit}>
            <Trans comment="Small text button at the end of the date row over a note that already carries one: opens the note for changing. On a desk it is on the card the reader has selected in the notes panel; on a phone, on the one-note page.">
              Edit note
            </Trans>
          </button>
        )}
        <button type="button" ref={deleteRef} onClick={() => setConfirming(true)}>
          <Trans comment="Small text button at the end of the date row over a note: asks, then removes the mark and any note on it. On a desk it is on the card the reader has selected in the notes panel; on a phone, on the one-note page.">
            Delete
          </Trans>
        </button>
      </span>
    </div>
  );
}
