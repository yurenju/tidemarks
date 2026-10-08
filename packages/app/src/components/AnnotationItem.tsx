import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import type { Annotation } from "../lib/types";
import { markVar } from "../lib/highlights";
import { relativeAge } from "../lib/revisit";
import { AGE_LABELS } from "./age-labels";

export default function AnnotationItem({
  annotation,
  editing,
  pointedAt,
  onJump,
  onEdit,
  onPersist,
  onSave,
  onRemove,
}: {
  annotation: Annotation;
  editing: boolean;
  /** Whether the book is showing this passage filled in — see `aria-current` below. */
  pointedAt: boolean;
  onJump: () => void;
  onEdit: () => void;
  /** Write the words down without closing anything. Called on every way out of the box. */
  onPersist: (note: string) => void;
  onSave: (note: string) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState(annotation.note);
  useEffect(() => {
    if (editing) setDraft(annotation.note);
  }, [editing, annotation.note]);

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
    if (!pointedAt || body === null) {
      setOverflow((was) => (was.tall ? { tall: false, atEnd: false } : was));
      return;
    }
    measureNote();
    const observer = new ResizeObserver(measureNote);
    observer.observe(body);
    return () => observer.disconnect();
    // `measureNote` reads only the ref, so a fresh copy each render is not a change.
  }, [pointedAt, showsNote, annotation.note]);
  /**
   * How many paragraphs the note has, for the line under a note that scrolls. A paragraph is a
   * line the reader wrote with something on it — the note is shown with its line breaks kept
   * (`styles/book.css`), so that is what the reader sees as one.
   */
  const paragraphs = annotation.note.split("\n").filter((line) => line.trim() !== "").length;

  /**
   * **[[Delete]] asks first, in the item itself.** Readers deleted notes they meant to keep, and a
   * note is their own words with nowhere to get them back from. The question takes the place of
   * the row of actions rather than opening a dialog: the reader is looking at this item, and a
   * dialog in the middle of the screen would take them away from the passage being asked about.
   *
   * It ends on its own when the item starts being edited — the reader has moved on to something
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
    // deletion takes the whole item away, and the focus with it, as a single press always did.
    if (confirming) {
      cancelRef.current?.focus();
    } else if (declinedRef.current) {
      declinedRef.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);
  const questionId = useId();

  /**
   * **The words are written down when the box goes away, by whatever took it.** A tap on the
   * page, a page turn, the panel closing, the reader pressing [[Done]] — all of them end up here,
   * because all of them end `editing` and this runs on the way out.
   *
   * `blur` is not what listens, and could not be: removing a focused element does not fire it in
   * every engine, so the one route that matters most on a phone — the system taking the panel
   * away — would be the one that lost the words. Cleanup runs whatever happened.
   *
   * The refs are so this effect depends on `editing` alone. Watching the callback or the stored
   * note would tear the effect down and put it back on every save, and the teardown *is* the
   * write, so it would write again with what it had just written.
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(annotation.note);
  committedRef.current = annotation.note;
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  /** Set by [[Delete]], so the cleanup does not write a note onto a row that has just been buried. */
  const removedRef = useRef(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    // ponytail: puts `window.scrollY` back by hand rather than proving nobody moved it.
    // WebKit scrolls the page to reveal a focused element and there is no first-party answer to
    // whether it scrolls back when the keyboard goes — an iPhone was seen leaving ~152pt of blank
    // below the panel afterwards, which matches the overflow to within 6pt but was never
    // confirmed (ADR-0044, on what it costs). Read before the focus below, not after, or it records the
    // number the focus already moved.
    const scrollWas = window.scrollY;

    const box = boxRef.current;
    if (box !== null) {
      // **Brings the item to the top of the list, then focuses.** "First in the item" is not
      // "first on screen": the panel lists every mark in the book, so the 31st one being edited
      // sits thirty items down a scroll container. Scrolling the container is what makes
      // ADR-0044's rule true; `preventScroll` below then stops the *window* being scrolled as
      // well, which is the half iOS does uninvited.
      const list = box.closest<HTMLElement>(".panel-body");
      const item = box.closest<HTMLElement>(".annotation-item");
      if (list !== null && item !== null) {
        list.scrollTop += item.getBoundingClientRect().top - list.getBoundingClientRect().top;
      }
      // `autoFocus` cannot carry `preventScroll`, which is the whole reason this is a ref and an
      // effect rather than an attribute. WebKit reveals a focused element by moving the enclosing
      // scroll view — `window.scrollY` on this side — and skips that entirely when the flag is
      // set (`WKContentViewInteraction.mm`).
      //
      // ⚠️ Here rather than in the ref callback: an inline callback is a new function every
      // render, so React detaches and reattaches it each time — and the box would steal the focus
      // back on any render at all, deleting a *different* note being enough to do it. On a phone
      // that is the keyboard coming back up over a reader who just dismissed it.
      box.focus({ preventScroll: true });
    }

    return () => {
      const unsaved = draftRef.current !== committedRef.current;
      if (unsaved && !removedRef.current) persistRef.current(draftRef.current);
      if (window.scrollY !== scrollWas) window.scrollTo({ top: scrollWas });
    };
  }, [editing]);

  return (
    <div
      className={`annotation-item${pointedAt ? " selected" : ""}`}
      // The colour is set once here and read by the rule down the card's edge and the scrollbar
      // of a long note (`styles/book.css`), so the two cannot come out in different inks.
      style={{ "--mark": markVar(annotation.color) } as React.CSSProperties}
    >
      {/* **The box is the first thing in the item, and that is the whole of ADR-0044.** A virtual
          keyboard takes the bottom of the screen and tells the layout nothing about it — no
          viewport unit moves — and then scrolls the whole page to bring a covered caret into
          view, which is what threw the panel off the top of an iPhone. Nothing here asks how tall
          the keyboard is. The caret starts where a keyboard cannot reach, so there is nothing for
          the scroll to do.

          Being first in the item is only half of it — the list is scrolled to this item as well,
          in the effect above. Neither half is enough alone: first-in-the-item with the list left
          where it was puts the box thirty rows down, and a scrolled list with the box under the
          quote puts it back under the keyboard. */}
      {editing && (
        <div className="note-editor">
          <textarea
            ref={boxRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // **Two ways for the words to reach the database, and they cover different exits.**
            // This one is the ordinary case: the reader moves the focus somewhere else while the
            // panel stays open — pressing this note's own quote on a desk does exactly that, and
            // the editor is still standing afterwards, so the cleanup has not run and would not
            // run before a reload. The cleanup covers what this cannot: removing a focused
            // element does not fire `blur` in every engine, so the panel being taken away — the
            // route that matters most on a phone — arrives only there.
            onBlur={() => {
              if (draft === committedRef.current) return;
              committedRef.current = draft;
              onPersist(draft);
            }}
            placeholder={t({
              message: "Note…",
              comment:
                "Placeholder in the empty note box under a marked passage. The ellipsis is one character.",
            })}
          />
          <button
            onClick={() => {
              // Claimed before the write is asked for, so the cleanup above sees the words as
              // already down and does not send them a second time.
              committedRef.current = draft;
              onSave(draft);
            }}
          >
            <Trans comment="Button that closes the note box under a marked passage. The words are already written down by the time it is pressed — this only puts the box away — so it says the writing is finished rather than naming a save.">
              Done
            </Trans>
          </button>
        </div>
      )}
      {/* **What this is about the mark rather than part of it**: how long ago, and — on the one
          card the reader is looking at — the day itself. The same ladder the shelf's card climbs
          (`lib/revisit.ts`) and the same words (`age-labels.ts`): a reader who meets "Last month"
          on the shelf meets it here too.

          **The ink is not in this row any more.** A dot here said the colour a second time, after
          the rule down the card's edge had already said it.

          [[Edit note]] and [[Delete]] stand at the end of it, and only on the selected card
          (`styles/book.css`): forty cards each with a row of buttons under it read as a register,
          and the reader acts on the one they are looking at. [[Delete]]'s question takes the row's
          place rather than opening a dialog: the reader is looking at this card, and a dialog in
          the middle of the screen would take them away from the passage being asked about.

          Under the editor rather than over it, which is ADR-0044 again — the box has to be the
          first thing in the item, so that the caret starts where a virtual keyboard cannot reach.
          Nothing is above it when it is standing. */}
      {confirming ? (
        <div
          className="annotation-head annotation-confirm"
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
              <Trans comment="Asked in place of the buttons under a marked passage that carries a note, after Delete was pressed. Names both, because the note is the reader's own writing and goes with the mark.">
                Delete this mark and its note?
              </Trans>
            ) : (
              <Trans comment="Asked in place of the buttons under a marked passage with no note, after Delete was pressed.">
                Delete this mark?
              </Trans>
            )}
          </p>
          {/* Together, so a narrow panel wraps the question over both rather than one answer
              under the other. */}
          <span className="annotation-confirm-answers">
            <button
              type="button"
              className="danger"
              onClick={() => {
                // Claimed before the row goes, so the cleanup above does not write the draft back
                // onto a mark that has just been given a tombstone. Nothing resurrects either way —
                // `deletedAt` stays set and merging is last-write-wins on the tombstone — but it
                // would push `updatedAt` and `dirtyAt` and send a row nobody asked to sync.
                removedRef.current = true;
                onRemove();
              }}
            >
              <Trans comment="The button that actually deletes, in the question asked in place under a marked passage. Shares its entry with the Delete that asked.">
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
      ) : (
        <div className="annotation-head">
          <p className="annotation-when">
            {i18n._(AGE_LABELS[relativeAge(Date.now(), annotation.createdAt)])}
            {/* The exact day on the card being looked at, small. The ladder above is the right
                answer for scanning a list and the wrong one for "when did I write this". */}
            {pointedAt && (
              <span className="annotation-date">
                {new Intl.DateTimeFormat(i18n.locale, { month: "numeric", day: "numeric" }).format(
                  annotation.createdAt,
                )}
              </span>
            )}
            {annotation.note === "" && (
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
                <Trans comment="Button under a marked passage that already carries a note: opens it for changing.">
                  Edit note
                </Trans>
              </button>
            )}
            <button type="button" ref={deleteRef} onClick={() => setConfirming(true)}>
              <Trans comment="Button under a marked passage: removes the mark and any note on it.">
                Delete
              </Trans>
            </button>
          </span>
        </div>
      )}
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
        aria-current={pointedAt || undefined}
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
          <Trans comment="Dashed box under a marked passage with no note, on the card the reader has selected in the notes panel. Pressing it opens the note box. The ellipsis is one character.">
            Write a note…
          </Trans>
        </button>
      )}
    </div>
  );
}
