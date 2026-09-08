import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
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
  /** Set by the reader, and only ever in one direction: a passage they opened stays open. */
  const [whole, setWhole] = useState(false);
  /**
   * Whether the three-line cut is actually hiding anything.
   *
   * **Measured rather than guessed from the length of the text.** A passage that happens to end
   * on the third line is not cut, and drawing the fade and the press under it would announce a
   * rest that does not exist; how many lines a passage takes is a question about the reader's
   * type size (ADR-0006), the panel's width and the script it is set in, so counting characters
   * answers a different question in every one of those.
   *
   * The observer is what keeps the answer true afterwards: the panel is a column that changes
   * width when the window does, and the type size changes under the reader's hand in [[Layout]].
   */
  const [cut, setCut] = useState(false);
  const quoteRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const quote = quoteRef.current;
    if (quote === null) return;
    // Once open there is no clamp left to overflow, so the answer would come back `false` and
    // take the press away from under a reader who may want to close it again.
    if (whole) return;
    const measure = () => setCut(quote.scrollHeight > quote.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(quote);
    return () => observer.disconnect();
  }, [whole, annotation.text]);
  useEffect(() => {
    if (editing) setDraft(annotation.note);
  }, [editing, annotation.note]);

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
      className={`annotation-item${cut ? " cut" : ""}${whole ? " whole" : ""}`}
      // The colour is set once here and read by the swatch and the rule beside the passage
      // (`styles/book.css`), so the two cannot come out in different inks.
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
      {/* **What this is about the mark rather than part of it**: the ink it was made in, and how
          long ago. The same row the shelf's card carries, minus the book and the label — every
          passage in this panel came out of the book the reader is holding, so naming it on each
          one would be a word that repeats and says nothing.

          The distance is the same ladder the card climbs (`lib/revisit.ts`) and the same words
          (`age-labels.ts`): a reader who meets "Last month" on the shelf meets it here too.

          Under the editor rather than over it, which is ADR-0044 again — the box has to be the
          first thing in the item, so that the caret starts where a virtual keyboard cannot reach.
          Nothing is above it when it is standing. */}
      <p className="annotation-head">
        {/* The colour is on the rule beside the passage as well, so this dot is a second saying
            of it and carries no name of its own. */}
        <span className="annotation-swatch" aria-hidden="true" />
        {i18n._(AGE_LABELS[relativeAge(Date.now(), annotation.createdAt)])}
      </p>
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
        {/* The passage is cut to three lines, and the cut is on this span rather than on the
            button around it — WebKit clamps nothing set on a control (`styles/book.css`). */}
        <span ref={quoteRef} className="annotation-quote-text">
          {annotation.text}
        </span>
      </button>
      {/* **The way back to the whole passage, under the passage.** Only where the cut is really
          hiding something, and only until it is opened: a press that undid itself would be a
          second state to explain, and nothing here is worth that. Closing it again is the panel
          being reopened — the reader who wanted it whole wanted it whole.

          Nothing like this stands under the note, and that asymmetry is the point: the passage
          can be cut because pressing it goes to where it stands in the book, whole. A note has no
          such route, so it is never cut (`styles/book.css`). */}
      {cut && !whole && (
        <button type="button" className="annotation-expand" onClick={() => setWhole(true)}>
          <Trans comment="Button under a marked passage that has been cut to three lines in the notes panel. Pressing it shows the rest of the passage in place. 'Whole' rather than 'more' because nothing is being fetched — the words were always there.">
            Show the whole passage
          </Trans>
        </button>
      )}
      {!editing && annotation.note && <p className="note-text">{annotation.note}</p>}
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
        <button
          onClick={() => {
            // Claimed before the row goes, so the cleanup above does not write the draft back
            // onto a mark that has just been given a tombstone. Nothing resurrects either way —
            // `deletedAt` stays set and merging is last-write-wins on the tombstone — but it
            // would push `updatedAt` and `dirtyAt` and send a row nobody asked to sync.
            removedRef.current = true;
            onRemove();
          }}
        >
          <Trans comment="Button under a marked passage: removes the mark and any note on it.">
            Delete
          </Trans>
        </button>
      </div>
    </div>
  );
}
