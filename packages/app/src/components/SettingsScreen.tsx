import { Trans, useLingui } from "@lingui/react/macro";
import AccountPanel from "./AccountPanel";
import LanguageForm from "./LanguageForm";
import TypographyForm from "./TypographyForm";
import type { ReaderSettings } from "../lib/settings";
import type { Locale } from "../lib/locale";
import type { SettingsTab } from "../lib/route";
import { BUILD, formatBuild } from "../lib/version";
import type { ReactNode } from "react";

/**
 * [[Settings]]: everything that is not a book.
 *
 * A floor rather than a drawer, and that is the whole reason it can hold tabs. What it says has
 * nothing to do with the screen the reader came from — which is exactly the test a floor has to
 * pass and a drawer has to fail (CONTEXT.md, [[Surfaces]]). It used to stack over the shelf or over
 * a book as `?d=settings`, which is why it never had room for anything but one list.
 *
 * **Three tabs, ordered near to far**: type is touched most days, the account a few times a
 * year, the language about once. The order is itself a sentence about which one the reader
 * probably came for.
 *
 * The reader's own type panel shows the same `TypographyForm` this does. That is not the
 * duplication this change set out to kill: there is one stored record now, so the two are one
 * setting shown in two places rather than two scopes wearing identical controls (ADR-0005).
 */
export default function SettingsScreen({
  tab,
  onTab,
  onBack,
  settings,
  onChange,
  onReset,
  onImported,
  locale,
  onLocaleChange,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onBack: () => void;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
  /** The shelf has to reload after a backup lands: it is holding rows that just changed. */
  onImported: () => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const { t } = useLingui();

  return (
    <div className="settings-screen" data-testid="settings-screen">
      {/* Always back to the shelf, because that is the only door in: the reader's bar carries
          Contents, Notes and Type and nothing else now (ADR-0005). A reader deep-linked straight
          here
          by the login return still lands somewhere that exists. */}
      <header className="settings-header">
        <button className="ghost" onClick={onBack} data-testid="settings-back">
          <Trans comment="The way out of [[Settings]], always back to the shelf because that is the only door in. The ‹ is part of the label. Shares its entry with the same button in the reader.">
            ‹ Shelf
          </Trans>
        </button>
        <strong className="settings-title">
          <Trans comment="Title of the settings screen. Shares its entry with the button on the shelf that opens it.">
            Settings
          </Trans>
        </strong>
      </header>

      <nav className="settings-tabs" data-testid="settings-tabs">
        <Tab
          open={tab}
          tab="typography"
          label={
            <Trans comment="[[Settings]] tab holding the six typography settings. Shares its entry with the reader's own bar button for the same panel.">
              Type
            </Trans>
          }
          onTab={onTab}
        />
        <Tab
          open={tab}
          tab="account"
          label={
            <Trans comment="[[Settings]] tab holding sign-in, billing and backup.">Account</Trans>
          }
          onTab={onTab}
        />
        {/* Last, because it is the rarest: a reader sets this once and never returns. */}
        <Tab
          open={tab}
          tab="language"
          label={
            <Trans comment="[[Settings]] tab holding the interface language. One word, sits beside Type and Account.">
              Language
            </Trans>
          }
          onTab={onTab}
        />
      </nav>

      <div className="settings-pane">
        {tab === "typography" ? (
          <TypographyForm
            settings={settings}
            onChange={onChange}
            onReset={onReset}
            /* No book on this floor, so the column choice has nothing to be taken away for. A
               vertically-written book disables it in the reader's own panel, where the book
               is. */
            verticalBook={false}
          />
        ) : tab === "account" ? (
          <AccountPanel onImported={onImported} />
        ) : (
          <LanguageForm locale={locale} onChange={onLocaleChange} />
        )}
      </div>

      {/* Under both tabs rather than inside either: which build is running is a fact about the
          whole app, and giving it to a tab would start that tab collecting strays. */}
      <footer
        className="settings-footer"
        title={
          BUILD.dirty
            ? t({
                message: "This build came from a working tree with uncommitted changes",
                comment:
                  "Tooltip on the build stamp in [[Settings]]'s footer, shown only when the '+' after the commit hash is there. It explains what that '+' means.",
              })
            : undefined
        }
      >
        <span>Tidemarks</span>
        <span data-testid="settings-build">{formatBuild(BUILD)}</span>
      </footer>
    </div>
  );
}

function Tab({
  open,
  tab,
  label,
  onTab,
}: {
  /** Which tab the screen is showing. */
  open: SettingsTab;
  /** Which tab this button is. */
  tab: SettingsTab;
  label: ReactNode;
  onTab: (tab: SettingsTab) => void;
}) {
  const current = open === tab;
  return (
    <button
      className={current ? "settings-tab active" : "settings-tab"}
      aria-current={current ? "page" : undefined}
      data-testid={`settings-tab-${tab}`}
      onClick={() => onTab(tab)}
    >
      {label}
    </button>
  );
}
