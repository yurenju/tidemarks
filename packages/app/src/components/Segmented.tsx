import { useRef, type ReactNode } from "react";
import { useLingui } from "@lingui/react";
import type { MessageDescriptor } from "@lingui/core";

/**
 * A label this control can show: either a message from the catalog, or a string that is
 * already what it should say.
 *
 * The second kind is rarer than it looks — the only one so far is the list of languages, whose
 * options are each written in themselves and so are the same on every screen (`lib/locale.ts`).
 */
export type SegmentLabel = string | MessageDescriptor;

/**
 * A setting whose options are few enough and short enough to stand on the page at once.
 *
 * **Not the `Select` the spec turned down.** The two reasons for keeping the native
 * `<select>` — that on a phone it opens the operating system's own menu, and that Base UI's
 * `Select` has an open issue where opening one freezes the main thread — are both about
 * components that *hide* the options until asked. This hides nothing: it is a radio group
 * wearing one border. What decides which settings get it is the options, not the library:
 * three or four of them, each a word or two. [[Line height]] has six, and in Chinese they read 「更寬鬆（2.0）」,
 * so it stays a `<select>`; that is the line, and it is about what fits.
 *
 * The chosen cell is filled with tide rather than underlined with it. Fill survives being
 * glanced at, and it survives the dark theme, where `--tide` flips to a light blue on a
 * near-black panel and a 2px rule under a Song face would be a rule nobody can see. ADR-0022's
 * tide budget counts this as one with its control, not one per cell.
 *
 * **Two shapes, one control.** A cell says its option in words; a tile draws it — the typeface's
 * own `Aa`, two columns as two columns. Which one a setting takes is ADR-0050's question, not
 * this component's, and the keyboard contract is the same either way, which is why they are one
 * file rather than two that would drift.
 */
export default function Segmented<T extends string | number>({
  label,
  testId,
  options,
  value,
  shape = "cells",
  disabled = false,
  disabledReason,
  onChange,
}: {
  label: SegmentLabel;
  testId: string;
  /**
   * `art` is the tile's picture, and only tiles read it. It is decoration beside a name the
   * cell already carries, so it is hidden from the accessibility tree at the point of use.
   */
  options: readonly { label: SegmentLabel; value: T; art?: ReactNode }[];
  value: T;
  /** How each option shows itself: `cells` is a row of words, `tiles` a row of pictures. */
  shape?: "cells" | "tiles";
  disabled?: boolean;
  /** Why the whole group is off, as the tooltip on every cell of it. */
  disabledReason?: string;
  onChange: (value: T) => void;
}) {
  // Resolved here rather than by every caller: a segmented control's options are translated
  // wherever it is used, so knowing how to read one belongs to the control.
  const { i18n } = useLingui();
  const say = (text: SegmentLabel) => (typeof text === "string" ? text : i18n._(text));
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((option) => option.value === value);

  /**
   * An arrow key moves the choice, and the focus with it.
   *
   * **This is the half a `<select>` used to come with for free**, and hand-rolling `radiogroup`
   * without it leaves a control that announces itself as a radio group to a screen reader and
   * behaves as three unrelated buttons to a keyboard — the worse of the two failures, because
   * the announcement is what promises the arrow keys. Choosing on arrival rather than requiring
   * a second press is the radio group's own convention: the group holds one value, so landing on
   * a cell *is* choosing it (ADR-0021).
   */
  function move(delta: number) {
    const next = (at + delta + options.length) % options.length;
    const landing = options[next];
    if (landing === undefined) return;
    onChange(landing.value);
    cells.current[next]?.focus();
  }

  return (
    <div className="form-row">
      <span className="form-label" id={`${testId}-label`}>
        {say(label)}
      </span>
      {/* `radiogroup` rather than a `<fieldset>`: the label is already on screen beside it, and
          a fieldset brings a legend and a border of its own that would both have to be undone.
          The group is labelled by the span, so a screen reader reads 「主題，淺色」 rather than
          announcing three unrelated buttons. */}
      <div
        className={shape === "tiles" ? "tiles" : "segmented"}
        role="radiogroup"
        data-testid={testId}
        aria-labelledby={`${testId}-label`}
        onKeyDown={(event) => {
          if (disabled) return;
          const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
          const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
          if (!back && !forward) return;
          event.preventDefault();
          move(forward ? 1 : -1);
        }}
      >
        {options.map((option, index) => (
          <button
            key={String(option.value)}
            ref={(node) => {
              cells.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            /* One tab stop for the whole group, on whichever cell is chosen — a radio group is
               one control, and tabbing through four cells to leave [[Theme]] would make it four. */
            tabIndex={option.value === value ? 0 : -1}
            data-testid={`${testId}-${option.value}`}
            className={shape === "tiles" ? "tile" : "segment"}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            onClick={() => onChange(option.value)}
          >
            {/* The picture is not a second name for the same thing — a screen reader reading
                "two columns, two columns" is worse than one that reads it once. */}
            {shape === "tiles" && option.art !== undefined && (
              <span className="tile-art" aria-hidden="true">
                {option.art}
              </span>
            )}
            <span>{say(option.label)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
