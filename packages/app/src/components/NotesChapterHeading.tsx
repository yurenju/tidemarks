import { Plural, Trans } from "@lingui/react/macro";

/**
 * The name over one chapter's run of marks in the notes panel, with how many there are.
 *
 * **The chapter the page is in says so.** A list that opens on a book's worth of marks has no
 * other way to tell the reader where in it they are standing — the page is beside the panel, but
 * the page does not say which chapter it is. One word on the heading answers that without
 * scrolling the list for them.
 *
 * The count is a number the eye can take in at the end of the row; a screen reader is given the
 * same number as words, because a bare "3" after a chapter name is read as part of the name.
 */
export default function NotesChapterHeading({
  label,
  count,
  here,
}: {
  label: string;
  count: number;
  here: boolean;
}) {
  return (
    <h3 className={`annotation-chapter-name${here ? " here" : ""}`}>
      <span className="annotation-chapter-label">{label}</span>
      {here && (
        <span className="annotation-chapter-here">
          <Trans comment="Small word beside a chapter name in the notes panel, on the chapter the page the reader is on belongs to. Says where the reader is, not which chapter is selected.">
            In this chapter
          </Trans>
        </span>
      )}
      <span className="annotation-chapter-count" aria-hidden="true">
        {count}
      </span>
      <span className="visually-hidden">
        <Plural
          comment="Read by a screen reader after a chapter name in the notes panel, in place of the bare number shown at the end of the heading. Marks are the passages the reader marked in that chapter."
          value={count}
          one="# mark"
          other="# marks"
        />
      </span>
    </h3>
  );
}
