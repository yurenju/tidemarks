import { Trans, useLingui } from "@lingui/react/macro";
import Segmented from "./Segmented";
import { LOCALES, type Locale } from "../lib/locale";

/**
 * [[Settings]]'s [[Language]] tab: which language Tidemarks speaks, and nothing else.
 *
 * **A tab of its own rather than a row inside [[Type]]**, because [[Type]] is about the book — every
 * control in it changes how the text an author wrote is laid out, and none of them changes a
 * word Tidemarks says. Interface language is the exact opposite, and filing it under typography
 * would have been the first crack in a line the glossary draws deliberately (CONTEXT.md,
 * [[Writing system]]: that judgement is not the one that picks an interface language).
 *
 * Last of the three tabs, which is the order the others already follow: nearest is what a
 * reader touches most days. This one is touched about once.
 */
export default function LanguageForm({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const { t } = useLingui();

  return (
    <div className="form-rows">
      <Segmented
        // The label is translated; the options are not. A reader who has landed in a language
        // they cannot read is precisely the reader who came here, and to them a list of
        // languages named in that language says nothing — so 日本語 is 日本語 on every screen
        // (`lib/locale.ts`).
        label={t({
          message: "Language",
          comment:
            "Label of the only control in [[Settings]]'s language tab. The row beside it lists English / 繁體中文 / 日本語, each written in itself.",
        })}
        testId="setting-locale"
        options={LOCALES}
        value={locale}
        onChange={onChange}
      />

      <p className="form-note">
        <Trans comment="Under the language control in [[Settings]]. Explains the two things a reader is most likely to wonder: whether this travels with the account, and whether it changes their books.">
          This device only — the language follows the machine in your hand, not your account. Books
          are unaffected: each one is laid out in whatever it was written in.
        </Trans>
      </p>
    </div>
  );
}
