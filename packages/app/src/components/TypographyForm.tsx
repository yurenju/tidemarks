import { useEffect, useState } from "react";
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
  type ReaderSettings,
} from "../lib/settings";
import { carriedFontKinds, type WebFontKind } from "../lib/web-font";
import { webFontFraction, webFontNote, type WebFontStatus } from "../lib/web-font-store";

/**
 * The six, once. Two shells wear this: the reader's 〈排版〉 panel and 〈設定〉's 排版 tab.
 *
 * **One component, not two that look alike.** The bug this whole change came out of was two
 * sets of controls that rendered identically and wrote to different places; keeping one copy is
 * what stops that growing back. There is only one place to write to now, so the only thing the
 * two shells differ in is what surrounds them (ADR-0026).
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
   * everywhere else, and then the line under 字型 reports what this device is holding instead.
   */
  webFontStatus?: WebFontStatus | null;
}) {
  return (
    <div className="form-rows">
      <Segmented
        label="主題"
        testId="setting-theme"
        options={THEME_CHOICES}
        value={settings.theme}
        onChange={(theme) => onChange({ theme })}
      />

      {/* Disabled over a vertical book because frond cannot honour two columns there at all —
          "cannot do it" is the only grounds for taking a choice away. Two columns on a phone is
          merely "looks bad" (eight characters a column), and that stays the reader's call. */}
      <Segmented
        label="欄數"
        testId="setting-columns"
        options={COLUMN_CHOICES}
        value={settings.columns}
        disabled={verticalBook}
        disabledReason="直排書固定單欄"
        onChange={(columns) => onChange({ columns })}
      />

      <Segmented
        label="字型"
        testId="setting-font-family"
        options={FONT_FAMILIES}
        value={settings.fontFamily}
        onChange={(fontFamily) => onChange({ fontFamily })}
      />
      <FontLine status={webFontStatus} />

      <label className="form-row">
        <span className="form-label">字級 {settings.fontSize}%</span>
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
        <span className="form-label">行距</span>
        <select
          data-testid="setting-line-height"
          value={String(settings.lineHeight)}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
        >
          {LINE_HEIGHTS.map((h) => (
            <option key={h.value} value={String(h.value)}>
              {h.label}
            </option>
          ))}
        </select>
      </label>

      <Segmented
        label="留白"
        testId="setting-margin"
        options={MARGINS}
        value={settings.margin}
        onChange={(margin) => onChange({ margin })}
      />

      {/* The only button left. "以後每本書都這樣排" went with the layer it promoted into. */}
      <div className="form-actions">
        <button data-testid="setting-reset" onClick={onReset} disabled={isDefault(settings)}>
          回到預設值
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

const KIND_LABEL: Record<WebFontKind, string> = { serif: "明體", sans: "黑體" };
const KINDS = Object.keys(KIND_LABEL) as WebFontKind[];

/**
 * The one line under 字型, and the one place the carried faces are ever mentioned.
 *
 * It used to be two things in two places: a running download line here in the reader, and a
 * standalone 〈自帶字型〉 section in 〈設定〉 that answered the same question when nothing was
 * downloading. One position, three states — not downloaded, downloading, held — so a reader
 * asking "will picking 明體 cost me a 16 MB wait" looks in one spot (ADR-0014, ADR-0026).
 *
 * A live status wins while there is one, because it is the more specific answer. `stored` is
 * not one of those: it says exactly what the readout below already says.
 */
function FontLine({ status }: { status: WebFontStatus | null }) {
  const [carried, setCarried] = useState<Record<WebFontKind, boolean> | "unreadable" | null>(null);
  // Re-read when a fetch changes state, so the line stops saying 還沒下載 the moment one lands.
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
      // reporting 還沒下載 would be a guess wearing the clothes of a fact.
      .catch(() => {
        if (alive) setCarried("unreadable");
      });
    return () => {
      alive = false;
    };
  }, [state]);

  const note = state === "downloading" || state === "unavailable" ? webFontNote(status) : null;
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
            aria-label="字型下載進度"
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
        ? "讀不到這台裝置上的字型。"
        : KINDS.map(
            (kind) => `${KIND_LABEL[kind]}${carried[kind] ? "已在這台裝置上" : "還沒下載"}`,
          ).join("・")}
    </p>
  );
}
