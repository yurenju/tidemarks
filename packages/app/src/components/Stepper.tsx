import { useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * A setting whose values are a **scale**: one axis, in order, with a step between neighbours.
 *
 * **Not a `Segmented` with more cells, and not a `<select>`.** Both of those spend the reader's
 * attention on telling six near-identical options apart, when the only question a scale ever
 * asks is "more or less than what I have". ADR-0050 draws that line: a set of alternatives shows
 * every option at once, a scale shows where you are and the two directions out of it.
 *
 * It is also what fits. [[Margin]] as four tiles is a row 76px tall; as a stepper it is one 44px
 * row like every other, and [[Line height]]'s six values could never have been tiles at all.
 *
 * `role="spinbutton"` rather than a group of buttons, because that is what this is: one value,
 * arrows to move it. The two buttons are how a finger does what the arrow keys do, so they are
 * outside the spinbutton and named for what they do rather than for the value they land on.
 */
export default function Stepper<T extends string | number>({
  label,
  testId,
  options,
  value,
  onChange,
}: {
  label: MessageDescriptor;
  testId: string;
  /** The scale, low to high. Their order here is the order the `+` walks. */
  options: readonly { label: MessageDescriptor; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { t, i18n } = useLingui();
  const at = options.findIndex((option) => option.value === value);
  // A stored value that is no longer on the scale would otherwise leave every press moving from
  // -1, which walks to the second option and looks like an off-by-one in the control.
  const index = at === -1 ? 0 : at;
  const first = index === 0;
  const last = index === options.length - 1;

  function step(delta: number) {
    const landing = options[index + delta];
    if (landing !== undefined) onChange(landing.value);
  }

  return (
    <div className="form-row">
      <span className="form-label" id={`${testId}-label`}>
        {i18n._(label)}
      </span>
      <div className="stepper" data-testid={testId}>
        <button
          type="button"
          className="step"
          data-testid={`${testId}-less`}
          disabled={first}
          aria-label={t({
            message: "Less",
            comment:
              "Screen-reader name for the − button of a stepper — the control for settings that are a scale, like [[Line height]] and [[Margin]]. Shared by every stepper, so it names the direction rather than the setting.",
          })}
          onClick={() => step(-1)}
        >
          −
        </button>
        {/* The value carries the tab stop, and the arrow keys, because the value is the control:
            the two buttons are a finger's way of pressing the same arrows. */}
        <span
          className="step-value"
          role="spinbutton"
          tabIndex={0}
          aria-labelledby={`${testId}-label`}
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={options.length - 1}
          aria-valuetext={i18n._(options[index]!.label)}
          onKeyDown={(event) => {
            const back = event.key === "ArrowLeft" || event.key === "ArrowDown";
            const forward = event.key === "ArrowRight" || event.key === "ArrowUp";
            if (!back && !forward) return;
            // Otherwise the key falls through to the reader's own handler, which turns a page —
            // and a page turn puts the panel this control is standing in away.
            event.preventDefault();
            step(forward ? 1 : -1);
          }}
        >
          {i18n._(options[index]!.label)}
        </span>
        <button
          type="button"
          className="step"
          data-testid={`${testId}-more`}
          disabled={last}
          aria-label={t({
            message: "More",
            comment:
              "Screen-reader name for the + button of a stepper — the control for settings that are a scale, like [[Line height]] and [[Margin]]. Shared by every stepper, so it names the direction rather than the setting.",
          })}
          onClick={() => step(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
