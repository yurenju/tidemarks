import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLayoutEffect, useRef, useState } from "react";
import type { Annotation } from "../lib/types";
import type { MarkedParagraph } from "../lib/marked-paragraphs";
import { markVar } from "../lib/highlights";
import { relativeAge } from "../lib/revisit";
import { AGE_LABELS } from "./age-labels";

/**
 * One note, a page to itself — the second storey of [[Notes]] on a phone (`?d=notes/<book>/<note>`).
 *
 * **The passage above, the reader's words below, one scroll for both.** On a desk the card has two
 * lines of the passage because the book is beside it; here the book is under the panel, so this
 * is the one place the reader can see what they marked while reading what they wrote about it.
 *
 * **Always set across, whatever the book's writing mode.** It is the app's own page, not frond's:
 * a vertical passage set down a 390px column runs to a few characters a line, and the note under
 * it is the reader's prose either way.
 */
export default function NotePage({
  annotation,
  paragraphs,
  fontSize,
  count,
  previous,
  next,
  onPick,
  onAll,
  onEdit,
}: {
  annotation: Annotation;
  /** The paragraphs it was made in, or `null` where the book cannot place it — then the mark's
   *  own words stand alone (`lib/marked-paragraphs.ts`). */
  paragraphs: MarkedParagraph[] | null;
  /** The reader's type size for the book, as a percentage of the root size (`ReaderSettings`). */
  fontSize: number;
  /** Where this one stands in the whole book's marks, not its chapter's. */
  count: { nth: number; total: number };
  /** The marks either side, in book order and across chapters; `null` at either end. */
  previous: Annotation | null;
  next: Annotation | null;
  onPick: (id: string) => void;
  onAll: () => void;
  /** Opens the note for writing — on the old list for now (#240 gives it a page of its own). */
  onEdit: () => void;
}) {
  const { t, i18n } = useLingui();
  const shown = paragraphs ?? [{ before: "", marked: annotation.text, after: "" }];
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * How much of the passage stands before [[Show the full text]], in whole lines.
   *
   * **Half the screen at most, cut on a line.** A passage over several paragraphs would otherwise
   * push the note — the thing this page is for — under the fold, and a cut through the middle of a
   * line leaves the top halves of a row of characters standing. So the height is a count of lines
   * the window has room for, measured off the line the passage is set at: how tall a line is
   * depends on the type size, the script and the face, none of which a character count knows.
   *
   * `null` when the whole passage fits, which is also when there is nothing to open.
   */
  const [cut, setCut] = useState<{ height: number; more: number } | null>(null);
  useLayoutEffect(() => {
    const box = sourceRef.current;
    if (box === null) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(box).lineHeight);
      if (!(line > 0)) return;
      const lines = Math.max(1, Math.floor(window.innerHeight / 2 / line));
      const total = Math.round(box.scrollHeight / line);
      const next = total > lines ? { height: lines * line, more: total - lines } : null;
      setCut((was) => (was?.height === next?.height && was?.more === next?.more ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (box.firstElementChild !== null) observer.observe(box.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // A step to another note is a new page, read from its top: the panel's scroll is the page's,
  // and left where it was it would open the next note halfway down its passage.
  useLayoutEffect(() => {
    const body = pageRef.current?.closest<HTMLElement>(".panel-body");
    if (body) body.scrollTop = 0;
  }, []);

  const clipped = cut !== null && !open;
  // Named so the catalog carries `{more}` rather than a bare `{0}`.
  const more = cut?.more ?? 0;

  return (
    <div
      ref={pageRef}
      className="note-page"
      data-testid="note-page"
      style={{ "--mark": markVar(annotation.color) } as React.CSSProperties}
    >
      {/* **The book's words at the reader's size, in the interface's serif.** The size is the one
          they chose in [[Layout]]. The face is not: it is applied inside frond's frame and is not
          a value this page can read — the same answer the desk's quotes give (`styles/book.css`).

          The mark is a wash and nothing else, as on the page when it is selected; the words around
          it step back, so the eye lands on what was marked and the rest is there to be read. */}
      <div
        ref={sourceRef}
        className={`note-page-source${clipped ? " clipped" : ""}`}
        style={{
          fontSize: `calc(1rem * ${fontSize} / 100)`,
          maxHeight: clipped ? `${cut.height}px` : undefined,
        }}
      >
        <div>
          {shown.map((paragraph, i) => (
            <p key={i}>
              {paragraph.before}
              <mark>{paragraph.marked}</mark>
              {paragraph.after}
            </p>
          ))}
        </div>
      </div>
      {cut !== null && (
        <button
          type="button"
          className="note-page-more"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? (
            <Trans comment="Button under the passage on the phone's one-note page, once the passage has been opened in full: cuts it back to half the screen so the note under it comes up again.">
              Show less of the text
            </Trans>
          ) : (
            <Plural
              comment="Button under a passage on the phone's one-note page that has been cut to half the screen. The number is how many more lines of the book's text it would show."
              value={more}
              one="Show the full text (# more line)"
              other="Show the full text (# more lines)"
            />
          )}
        </button>
      )}

      {/* A short rule in the mark's own ink, between the book's words and the reader's. Not a wave:
          that is what a mark is drawn as, and this is not one. */}
      <hr className="note-page-rule" />

      <div className="annotation-head note-page-head">
        <p className="annotation-when">
          {i18n._(AGE_LABELS[relativeAge(Date.now(), annotation.createdAt)])}
          <span className="annotation-date">
            {new Intl.DateTimeFormat(i18n.locale, { month: "numeric", day: "numeric" }).format(
              annotation.createdAt,
            )}
          </span>
        </p>
        {annotation.note !== "" && (
          <span className="annotation-tools">
            <button type="button" onClick={onEdit}>
              <Trans comment="Small text button at the end of the date row on the phone's one-note page, under the passage and above the note: opens the note for changing.">
                Edit note
              </Trans>
            </button>
          </span>
        )}
      </div>

      {annotation.note !== "" ? (
        <p className="note-text note-page-note">{annotation.note}</p>
      ) : (
        <button type="button" className="annotation-write" onClick={onEdit}>
          <Trans comment="Dashed box on the phone's one-note page, where the note would stand under a passage that has none. Pressing it opens the note box. The ellipsis is one character.">
            Write a note…
          </Trans>
        </button>
      )}

      {/* **Held at the foot of the page, and every button keeps its place.** At either end of the
          book the step that has nowhere to go is greyed rather than taken away, so the row under
          the reader's thumb does not move as they walk it. The count is the whole book's, so
          crossing into the next chapter does not start it again at one. */}
      <nav
        className="note-page-nav"
        aria-label={t({
          message: "Notes in this book",
          comment:
            "Screen-reader name for the row at the foot of the phone's one-note page that steps to the previous note, back to all of them, and to the next one.",
        })}
      >
        <button
          type="button"
          disabled={previous === null}
          onClick={() => previous && onPick(previous.id)}
        >
          <Trans comment="Button at the foot of the phone's one-note page: goes to the note before this one in the book, crossing into the previous chapter when this is the first in its own. The ‹ is part of the label.">
            ‹ Previous
          </Trans>
        </button>
        <button type="button" className="note-page-all" onClick={onAll}>
          <span className="note-page-count">
            {count.nth} / {count.total}
          </span>
          {" · "}
          <Trans comment="Button at the foot of the phone's one-note page, after 'this note's place / how many notes the book has': goes back to the list of every note in the book.">
            All
          </Trans>
        </button>
        <button type="button" disabled={next === null} onClick={() => next && onPick(next.id)}>
          <Trans comment="Button at the foot of the phone's one-note page: goes to the note after this one in the book, crossing into the next chapter when this is the last in its own. The › is part of the label.">
            Next ›
          </Trans>
        </button>
      </nav>
    </div>
  );
}
