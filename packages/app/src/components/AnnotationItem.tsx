import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "../lib/types";
import { markVar } from "../lib/highlights";
import AnnotationHead from "./AnnotationHead";
import NoteEditor from "./NoteEditor";

export default function AnnotationItem({
  annotation,
  editing,
  selected,
  onJump,
  onEdit,
  onPersist,
  onSave,
  onRemove,
}: {
  annotation: Annotation;
  editing: boolean;
  /**
   * The passage the reader pointed at — washed on the page, and the card that carries its tools
   * and its whole note. See `aria-current` below.
   */
  selected: boolean;
  onJump: () => void;
  onEdit: () => void;
  /** Write the words down without closing anything. Called on every way out of the box. */
  onPersist: (note: string) => void;
  onSave: (note: string) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  /**
   * Whether the selected card's note runs past the height it is given, and whether the reader has
   * scrolled to its end.
   *
   * **Measured rather than guessed from the length of the text**, for the reason the passage's
   * cut used to be: how tall a note stands is a question about the type size (ADR-0006), the
   * panel's width and the script, so counting characters answers a different question in every
   * one of those. The observer keeps the answer true as the column or the type size changes.
   *
   * Only while selected: an unselected card cuts its note to three lines and says nothing about
   * the rest, because pressing the passage is how the reader asks to see this one whole.
   */
  const [overflow, setOverflow] = useState<{ tall: boolean; atEnd: boolean }>({
    tall: false,
    atEnd: false,
  });
  const noteRef = useRef<HTMLDivElement | null>(null);
  const measureNote = () => {
    const body = noteRef.current;
    if (body === null) return;
    const tall = body.scrollHeight > body.clientHeight + 1;
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    setOverflow((was) => (was.tall === tall && was.atEnd === atEnd ? was : { tall, atEnd }));
  };
  const showsNote = !editing && annotation.note !== "";
  useEffect(() => {
    const body = noteRef.current;
    if (!selected || body === null) {
      setOverflow((was) => (was.tall ? { tall: false, atEnd: false } : was));
      return;
    }
    measureNote();
    // The text as well as the box: once the box is held at its full height, a change in the
    // type size or the panel's width changes only what is inside it.
    const observer = new ResizeObserver(measureNote);
    observer.observe(body);
    if (body.firstElementChild !== null) observer.observe(body.firstElementChild);
    return () => observer.disconnect();
    // `measureNote` reads only the ref, so a fresh copy each render is not a change.
  }, [selected, showsNote, annotation.note]);
  /**
   * How many paragraphs the note has, for the line under a note that scrolls. A paragraph is what
   * a blank line separates — the note is shown with its line breaks kept (`styles/book.css`), so a
   * single break is a line inside a paragraph, as in a list or a verse the reader copied out.
   */
  const paragraphs = annotation.note.split(/\n\s*\n/).filter((part) => part.trim() !== "").length;

  /**
   * Set by [[Delete]], so the box going away with the card does not write a note onto a row that
   * has just been buried. Nothing resurrects either way — `deletedAt` stays set and merging is
   * last-write-wins on the tombstone — but it would push `updatedAt` and `dirtyAt` and send a row
   * nobody asked to sync.
   */
  const removedRef = useRef(false);

  return (
    <div
      className={`annotation-item${selected ? " selected" : ""}`}
      // What the notes list scrolls to by (`Reader.tsx`, `scrollNotesTo`): the mark's id names the
      // card, and nothing else about the card is stable enough to find it by.
      data-mark={annotation.id}
      // The colour is set once here and read by the rule down the card's edge and the scrollbar
      // of a long note (`styles/book.css`), so the two cannot come out in different inks.
      style={{ "--mark": markVar(annotation.color) } as React.CSSProperties}
    >
      {/* **The ink is not in this row any more.** A dot here said the colour a second time, after
          the rule down the card's edge had already said it.

          [[Edit note]] and [[Delete]] stand at the end of it, and only on the selected card
          (`styles/book.css`): forty cards each with a row of buttons under it read as a register,
          and the reader acts on the one they are looking at. */}
      <AnnotationHead
        annotation={annotation}
        dated={selected}
        saysJustTheMark
        editing={editing}
        selected={selected}
        onEdit={onEdit}
        onRemove={() => {
          // Claimed before the row goes, so the box going with it writes nothing back.
          removedRef.current = true;
          onRemove();
        }}
      />
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
        aria-current={selected || undefined}
        onClick={onJump}
        title={t({
          message: "Jump to this passage",
          comment:
            "Tooltip on a quoted passage in the notes panel. Clicking it takes the reader to where that passage is in the book.",
        })}
      >
        {/* **Two lines of the passage, faded, on every card** — the selected one too. The
            passage is what the note is about, not what the card is for, so it is a reminder
            rather than a reading: pressing it goes to where it stands in the book, whole, and
            that is the way to the rest of it. Nothing in the panel opens it in place.

            The cut is on this span rather than on the button around it — WebKit clamps nothing
            set on a control (`styles/book.css`). */}
        <span className="annotation-quote-text">{annotation.text}</span>
      </button>
      {/* **The box stands where the note stands: under the passage.** The passage is above the
          reader's words whether they are reading them or writing them, so opening the box does not
          swap the two round. It is still near the top of the card — the date row and two lines
          of passage over it, the same as the phone's note page — and `NoteEditor` scrolls the
          card to the top of the panel, so the caret starts clear of a virtual keyboard
          (ADR-0044). */}
      {editing && (
        <NoteEditor
          note={annotation.note}
          onPersist={(note) => {
            if (!removedRef.current) onPersist(note);
          }}
          onSave={onSave}
        />
      )}
      {showsNote && (
        // **Cut to three lines until the card is selected, then whole** — inside the card, as
        // a scroll of its own once it runs past what the card is given, so one long note cannot
        // push every other card off the panel. The reader selects a card by pressing its passage,
        // so the rest of a note is one press away and never behind the editor.
        //
        // Focusable only while it scrolls, so a keyboard can scroll it and Tab does not stop
        // on a note that has nothing to scroll.
        <div
          ref={noteRef}
          className={`note-body${overflow.tall && !overflow.atEnd ? " more" : ""}`}
          tabIndex={overflow.tall ? 0 : undefined}
          onScroll={measureNote}
        >
          <p className="note-text">{annotation.note}</p>
        </div>
      )}
      {showsNote && overflow.tall && (
        <p className="note-more">
          {overflow.atEnd ? (
            <Trans comment="Small line under a long note in the notes panel that scrolls inside its card, once the reader has scrolled to its end.">
              At the end
            </Trans>
          ) : (
            <Plural
              comment="Small line under a long note in the notes panel that scrolls inside its card, while there is more of it below. The number is how many paragraphs the whole note has, not how many are left."
              value={paragraphs}
              one="# paragraph · more below"
              other="# paragraphs · more below"
            />
          )}
        </p>
      )}
      {/* **A mark with nothing written under it gets a place to start one** — on the selected
          card only, and drawn as an empty box with a dashed edge, which is what it is: the note
          that is not there yet. */}
      {!editing && annotation.note === "" && (
        <button type="button" className="annotation-write" onClick={onEdit}>
          <Trans comment="Dashed box under a marked passage with no note, on a card in the notes panel — on a desk only the card the reader has selected. Pressing it opens the note box. The ellipsis is one character.">
            Write a note…
          </Trans>
        </button>
      )}
    </div>
  );
}
