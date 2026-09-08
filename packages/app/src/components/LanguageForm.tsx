import { Trans, useLingui } from "@lingui/react/macro";
import Segmented from "./Segmented";
import { LOCALES, type Locale } from "../lib/locale";

/**
 * Which language Tidemarks speaks: one row, and the note under it.
 *
 * **It used to be a tab of its own**, kept out of the Type tab because Type was about the book —
 * every control in it changed how the text an author wrote is laid out, and none of them changed
 * a word Tidemarks says. That reason retired with the tab: typography left this floor entirely
 * (ADR-0050), so what this row now sits beside is [[Theme]], which is about Tidemarks in exactly
 * the way this is. Two rows, one tab, and the line the glossary draws is still drawn — it is
 * just no longer drawn by a tab boundary (CONTEXT.md, [[Writing system]]: that judgement is not
 * the one that picks an interface language).
 *
 * No wrapper of its own: the tab holding it is the one that decides how its rows are spaced.
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
    <>
      <Segmented
        // The label is translated; the options are not. A reader who has landed in a language
        // they cannot read is precisely the reader who came here, and to them a list of
        // languages named in that language says nothing — so 日本語 is 日本語 on every screen
        // (`lib/locale.ts`).
        label={t({
          message: "Language",
          comment:
            "Label of the language control in [[Settings]]'s interface tab. The row beside it lists English / 繁體中文 / 日本語, each written in itself.",
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
    </>
  );
}
