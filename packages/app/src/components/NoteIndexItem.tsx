import type { Annotation } from "../lib/types";
import { markVar } from "../lib/highlights";

/**
 * One mark in the phone's index of [[Notes]]: two lines of the passage and the first line of the
 * note, and the whole row is the way into that note's page.
 *
 * **A list to find a note in, not to read one.** On a desk the cards carry their notes whole,
 * because the book stands beside them; here the panel covers the book, so a note is read on a
 * page of its own (`NotePage`) and the row only has to say which passage and what was written.
 *
 * `recent` is the note the reader has just come back from — scrolled to and marked, never
 * selected (`lib/annotation-position.ts`): a reader who has walked a few notes along wants to see
 * where they got to.
 */
export default function NoteIndexItem({
  annotation,
  recent,
  onOpen,
}: {
  annotation: Annotation;
  recent: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`note-index-item${recent ? " recent" : ""}`}
      // Said in the tree as well as in ink, since a tint is all a sighted reader gets (ADR-0021).
      aria-current={recent || undefined}
      // What the list scrolls to by (`Reader.tsx`, `scrollNotesTo`), as on the desk's cards.
      data-mark={annotation.id}
      style={{ "--mark": markVar(annotation.color) } as React.CSSProperties}
      onClick={onOpen}
    >
      {/* The same two faded lines the desk's card carries (`.annotation-quote-text`), cut on a
          span for the reason given there. */}
      <span className="annotation-quote annotation-quote-text">{annotation.text}</span>
      {annotation.note !== "" && <span className="note-index-note">{annotation.note}</span>}
    </button>
  );
}
