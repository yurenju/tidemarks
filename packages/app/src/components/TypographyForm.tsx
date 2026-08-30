import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import Segmented from "./Segmented";
import { db } from "../lib/db";
import {
  COLUMN_CHOICES,
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  LINE_HEIGHTS,
  MARGINS,
  THEME_CHOICES,
  type FontChoice,
  type ReaderSettings,
} from "../lib/settings";
import { carriedFontKinds, type WebFontKind } from "../lib/web-font";
import { webFontFraction, webFontNote, type WebFontStatus } from "../lib/web-font-store";

/**
 * The six, once. Two shells wear this: the reader's own typography panel and [[Settings]]'s
 * typography tab.
 *
 * **One component, not two that look alike.** The bug this whole change came out of was two
 * sets of controls that rendered identically and wrote to different places; keeping one copy is
 * what stops that growing back. There is only one place to write to now, so the only thing the
 * two shells differ in is what surrounds them (ADR-0005).
 *
 * Every row is **label left, control right**, and that is why the segmented controls below are
 * sized to their options rather than stretched across the row the way the design showed them.
 * Label-above would buy each of them a fuller line and cost every row about 22px of height —
 * six of those is most of what the hand-held panel has to give (#160), and it would leave the
 * two rows that are still a slider and a select reading as a different form.
 *
 * On a hand-held the panel is capped at `min(70vh, 36rem)`, and the book showing above it is
 * the preview — six rows in the two-line arrangement this replaced would have eaten it entirely.
 */
export default function TypographyForm({
  settings,
  onChange,
  onReset,
  verticalBook,
  webFontStatus = null,
}: {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
  /**
   * Whether the book on screen lays out vertically. False wherever there is no book to ask
   * about, which is everywhere except the reader.
   */
  verticalBook: boolean;
  /**
   * What a face fetch is doing right now, when there is a book that asked for one. `null`
   * everywhere else, and then the line under the typeface control reports what this device is
   * holding instead.
   */
  webFontStatus?: WebFontStatus | null;
}) {
  const { t, i18n } = useLingui();
  // Named rather than read inline, so the catalog carries `{size}` instead of a bare `{0}`.
  const size = settings.fontSize;

  return (
    <div className="form-rows">
      <Segmented
        label={msg({
          message: "Theme",
          comment: "Label of the light/dark control in the typography panel.",
        })}
        testId="setting-theme"
        options={THEME_CHOICES}
        value={settings.theme}
        onChange={(theme) => onChange({ theme })}
      />

      {/* Disabled over a vertical book because frond cannot honour two columns there at all —
          "cannot do it" is the only grounds for taking a choice away. Two columns on a phone is
          merely "looks bad" (eight characters a column), and that stays the reader's call. */}
      <Segmented
        label={msg({
          message: "Columns",
          comment: "Label of the control choosing how many columns a page is set in.",
        })}
        testId="setting-columns"
        options={COLUMN_CHOICES}
        value={settings.columns}
        disabled={verticalBook}
        disabledReason={t({
          message: "A vertical book is always one column",
          comment:
            "Tooltip on the disabled columns control. It is disabled because frond cannot lay a vertically-written book out in two columns at all.",
        })}
        onChange={(columns) => onChange({ columns })}
      />

      <Segmented
        label={msg({
          message: "Font",
          comment:
            "Label of the control choosing which face the book is set in. Kept short: the row is label-left, control-right, and the control beside it holds three options.",
        })}
        testId="setting-font-family"
        options={FONT_FAMILIES}
        value={settings.fontFamily}
        onChange={(fontFamily) => onChange({ fontFamily })}
      />
      <FontLine status={webFontStatus} />

      <label className="form-row">
        <span className="form-label">
          <Trans comment="Label of the font size slider, with the current value in it. The number is a percentage of the reader's own browser default, not a pixel size.">
            Size {size}%
          </Trans>
        </span>
        <input
          data-testid="setting-font-size"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={FONT_SIZE_STEP}
          value={settings.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
        />
      </label>

      <label className="form-row">
        <span className="form-label">
          <Trans comment="Label of the line-height dropdown in the typography panel.">
            Line height
          </Trans>
        </span>
        <select
          data-testid="setting-line-height"
          value={String(settings.lineHeight)}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
        >
          {LINE_HEIGHTS.map((h) => (
            <option key={h.value} value={String(h.value)}>
              {i18n._(h.label)}
            </option>
          ))}
        </select>
      </label>

      <Segmented
        label={msg({
          message: "Margin",
          comment:
            "Label of the margin control. It sets a floor for the whitespace along the line-length axis rather than the final width — see ADR-0012.",
        })}
        testId="setting-margin"
        options={MARGINS}
        value={settings.margin}
        onChange={(margin) => onChange({ margin })}
      />

      {/* The only button left. The one that promoted this book's settings to every book went
          with the layer it promoted into (ADR-0005). */}
      <div className="form-actions">
        <button data-testid="setting-reset" onClick={onReset} disabled={isDefault(settings)}>
          <Trans comment="Button under the typography controls. Puts all six settings back to what Tidemarks ships with. Disabled when they already are.">
            Reset
          </Trans>
        </button>
      </div>
    </div>
  );
}

function isDefault(settings: ReaderSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof ReaderSettings)[]).every(
    (key) => settings[key] === DEFAULT_SETTINGS[key],
  );
}

// The two carried faces, named the way the typeface control names them — the same two entries,
// read out of `FONT_FAMILIES` rather than written a second time here.
const KIND_LABEL: Record<WebFontKind, MessageDescriptor> = {
  serif: fontChoiceLabel("serif"),
  sans: fontChoiceLabel("sans"),
};

function fontChoiceLabel(choice: FontChoice): MessageDescriptor {
  const found = FONT_FAMILIES.find((family) => family.value === choice);
  // Unreachable: the two names come from the same union `FONT_FAMILIES` is built over. Throwing
  // rather than falling back to a blank, because a nameless typeface in the line below reads as
  // a rendering bug rather than as a missing entry.
  if (!found) throw new Error(`no label for the ${choice} typeface`);
  return found.label;
}

const KINDS = Object.keys(KIND_LABEL) as WebFontKind[];

/**
 * The one line under the typeface control, and the one place the carried faces are ever
 * mentioned.
 *
 * It used to be two things in two places: a running download line here in the reader, and a
 * standalone carried-fonts section in [[Settings]] that answered the same question when nothing was
 * downloading. One position, three states — not downloaded, downloading, held — so a reader
 * asking "will picking the serif cost me a 16 MB wait" looks in one spot (ADR-0014,
 * ADR-0005).
 *
 * A live status wins while there is one, because it is the more specific answer. `stored` is
 * not one of those: it says exactly what the readout below already says.
 */
function FontLine({ status }: { status: WebFontStatus | null }) {
  const { t, i18n } = useLingui();
  const [carried, setCarried] = useState<Record<WebFontKind, boolean> | "unreadable" | null>(null);
  // Re-read when a fetch changes state, so the line stops saying "not downloaded yet" the
  // moment one lands.
  const state = status?.state ?? null;

  useEffect(() => {
    let alive = true;
    void db.fonts
      .toCollection()
      .primaryKeys()
      .then((keys) => {
        if (alive) setCarried(carriedFontKinds(keys.map(String)));
      })
      // Private mode, or storage evicted mid-read. "Cannot tell" is its own answer here:
      // reporting "not downloaded yet" would be a guess wearing the clothes of a fact.
      .catch(() => {
        if (alive) setCarried("unreadable");
      });
    return () => {
      alive = false;
    };
  }, [state]);

  const note =
    state === "downloading" || state === "unavailable" ? webFontNote(i18n, status) : null;
  if (note !== null) {
    const progress = webFontFraction(status);
    return (
      <div className="form-note" data-testid="font-line">
        <span>{note}</span>
        {/* The bar under the line, only while the fetch is running. The line alone leaves a slow
            connection looking stuck: 16 MB over a weak signal can hold one percentage for a long
            time, and a number that does not move reads as a number that died. The bar's sheen
            keeps moving whatever the percentage does. Without a declared total there is no width
            to draw, so it slides instead — see `webFontFraction`. */}
        {state === "downloading" && (
          <div
            className={`font-progress${progress === null ? " indeterminate" : ""}`}
            role="progressbar"
            aria-label={t({
              message: "Font download progress",
              comment: "Screen-reader name for the progress bar shown while a CJK face downloads.",
            })}
            {...(progress === null
              ? {}
              : {
                  "aria-valuenow": Math.round(progress * 100),
                  "aria-valuemin": 0,
                  "aria-valuemax": 100,
                })}
          >
            <div
              className="font-progress-fill"
              style={progress === null ? undefined : { width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (carried === null) return null;
  return (
    <p className="form-note" data-testid="font-line">
      {carried === "unreadable"
        ? t({
            message: "Cannot read this device's fonts.",
            comment:
              "Replaces the line reporting which faces are held, when the store could not be read at all. A full sentence, because it is the whole line.",
          })
        : KINDS.map((kind) =>
            carried[kind]
              ? t({
                  message: `${{ face: i18n._(KIND_LABEL[kind]) }} is on this device`,
                  comment:
                    "One half of the line under the typeface control, reporting which carried faces this device already holds. The value is a typeface name — 'Serif' or 'Sans' as translated elsewhere in this catalog. The two halves are joined with '・'.",
                })
              : t({
                  message: `${{ face: i18n._(KIND_LABEL[kind]) }} not downloaded yet`,
                  comment:
                    "One half of the line under the typeface control, reporting a carried face this device does not hold. The value is a typeface name — 'Serif' or 'Sans' as translated elsewhere in this catalog. The two halves are joined with '・'.",
                }),
          ).join("・")}
    </p>
  );
}
