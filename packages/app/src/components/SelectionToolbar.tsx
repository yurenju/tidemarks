import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";
import { DEFAULT_MARK, MARKS, markVar } from "../lib/highlights";
import type { SelectionView } from "../lib/useSelection";

/**
 * The colour row over a chosen passage: four inks, a note, and a way out.
 *
 * **It knows nothing about how the passage was chosen**, and nothing about where it is on screen.
 * Which of the two selections drew it, whether the finger has lifted, and which corner the row
 * fits in are all `lib/useSelection.ts`'s, and arrive here as `toolbar` — including the ref the
 * placement measures this element through, since its own size is half of what decides the answer.
 *
 * Writing the mark down is further out still, in `Reader.tsx`: a mark is a row in Dexie that the
 * notes panel and the highlight layer both read, so it is the reader's data rather than the
 * selection's (CONTEXT.md [[Mark]] against [[Marking]], one `ing` apart).
 */
export default function SelectionToolbar({ toolbar }: { toolbar: SelectionView["toolbar"] }) {
  const { t, i18n } = useLingui();

  // [[Marking]] waits for the finger to lift. While it is still down the reader has the wash and
  // the two handles and nothing else — a colour row raised mid-drag would sit under the finger
  // that raised it and chase the selection across the page (CONTEXT.md [[chrome]]).
  if (!toolbar.showing) return null;

  return (
    <div
      ref={toolbar.ref}
      className="highlight-toolbar"
      style={toolbar.at ? { left: toolbar.at.left, top: toolbar.at.top } : { visibility: "hidden" }}
    >
      {/* Two groups rather than six children, so the rule between them has a side to sit on
          whichever way the bar is laid out. On a phone the bar is two rows and the rule is
          the seam between them; wider, it is one row and the rule stands up (`styles/book.css`). */}
      <div className="mark-inks">
        {MARKS.map(({ name, label }) => {
          const inkLabel = t({
            message: `Mark in ${{ ink: i18n._(label) }}`,
            comment:
              "Name of one of the four ink swatches on the selection bar. The value is a pigment name — Indigo, Ochre, Moss or Soot as translated elsewhere in this catalog.",
          });
          return (
            <button
              key={name}
              className="swatch"
              style={{ "--mark": markVar(name) } as CSSProperties}
              title={inkLabel}
              aria-label={inkLabel}
              onClick={() => toolbar.onMark(name, false)}
            />
          );
        })}
      </div>
      <div className="mark-actions">
        <button onClick={() => toolbar.onMark(DEFAULT_MARK, true)}>
          <Trans comment="Button on the selection bar: mark the passage and open a note on it in one action, rather than marking and then reopening it to write.">
            Mark and note
          </Trans>
        </button>
        <button onClick={toolbar.onDismiss}>
          <Trans comment="Button on the selection bar: drop the selection without marking anything.">
            Cancel
          </Trans>
        </button>
      </div>
    </div>
  );
}
