import { Trans, useLingui } from "@lingui/react/macro";
import AccountPanel from "./AccountPanel";
import LanguageForm from "./LanguageForm";
import ThemeField from "./ThemeField";
import type { ReaderSettings } from "../lib/settings";
import type { Locale } from "../lib/locale";
import type { SettingsTab } from "../lib/route";
import { BUILD, formatBuild } from "../lib/version";
import type { ReactNode } from "react";

/**
 * [[Settings]]: everything that is not a book.
 *
 * A floor rather than a panel, and that is the whole reason it can hold tabs. What it says has
 * nothing to do with the screen the reader came from — which is exactly the test a floor has to
 * pass and a panel has to fail (CONTEXT.md, [[Surfaces]]). It used to stack over the shelf or over
 * a book as `?d=settings`, which is why it never had room for anything but one list.
 *
 * **Two tabs now, and neither of them is typography.** How a book is set left this floor
 * entirely: there is no book here, so a reader could work through all five of columns, typeface,
 * size, line height and margin and watch nothing happen. They are in the reader's own panel,
 * where the page above them is the preview (ADR-0050).
 *
 * What is left divides cleanly. `interface` holds the two settings that are about Tidemarks
 * rather than about a book — [[Theme]] and [[Language]] — and `account` holds sign-in, billing
 * and backup. [[Theme]] is on this floor because it is the one setting this floor can show:
 * pressing Dark repaints the screen it was pressed on. The reader's panel shows the same row,
 * one setting in two places rather than two settings that look alike (ADR-0005).
 */
export default function SettingsScreen({
  tab,
  onTab,
  onBack,
  settings,
  onChange,
  onImported,
  locale,
  onLocaleChange,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onBack: () => void;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
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
        {/* First, and not because it is the one they came for — Account is. It is first because
            it is the smaller idea: two rows about Tidemarks itself, ahead of everything about
            the account behind it. */}
        <Tab
          open={tab}
          tab="interface"
          label={
            <Trans comment="[[Settings]] tab holding the two settings that are about Tidemarks rather than about a book: the light/dark theme and the interface language.">
              Interface
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
      </nav>

      <div className="settings-pane">
        {tab === "interface" ? (
          <div className="form-rows">
            <ThemeField theme={settings.theme} onChange={(theme) => onChange({ theme })} />
            <LanguageForm locale={locale} onChange={onLocaleChange} />
          </div>
        ) : (
          <AccountPanel onImported={onImported} />
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
