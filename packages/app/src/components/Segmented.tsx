import { useRef } from "react";

/**
 * A setting whose options are few enough and short enough to stand on the page at once.
 *
 * **Not the `Select` the spec turned down.** The two reasons for keeping the native
 * `<select>` — that on a phone it opens the operating system's own menu, and that Base UI's
 * `Select` has an open issue where opening one freezes the main thread — are both about
 * components that *hide* the options until asked. This hides nothing: it is a radio group
 * wearing one border. What decides which settings get it is the options, not the library:
 * three or four of them, each a word or two. 行距 has six and they read 「更寬鬆（2.0）」,
 * so it stays a `<select>`; that is the line, and it is about what fits.
 *
 * The chosen cell is filled with moss rather than underlined with it. Fill survives being
 * glanced at, and it survives the dark theme, where `--accent` flips to a light green on a
 * near-black panel and a 2px rule under a Song face would be a rule nobody can see. ADR-0022's
 * green budget counts this as one green with its control, not one per cell.
 */
export default function Segmented<T extends string | number>({
  label,
  testId,
  options,
  value,
  disabled = false,
  disabledReason,
  onChange,
}: {
  label: string;
  testId: string;
  options: readonly { label: string; value: T }[];
  value: T;
  disabled?: boolean;
  /** Why the whole group is off, as the tooltip on every cell of it. */
  disabledReason?: string;
  onChange: (value: T) => void;
}) {
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
        {label}
      </span>
      {/* `radiogroup` rather than a `<fieldset>`: the label is already on screen beside it, and
          a fieldset brings a legend and a border of its own that would both have to be undone.
          The group is labelled by the span, so a screen reader reads 「主題，淺色」 rather than
          announcing three unrelated buttons. */}
      <div
        className="segmented"
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
               one control, and tabbing through four cells to leave 主題 would make it four. */
            tabIndex={option.value === value ? 0 : -1}
            data-testid={`${testId}-${option.value}`}
            className="segment"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
