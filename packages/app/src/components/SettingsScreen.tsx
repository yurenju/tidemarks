import AccountPanel from "./AccountPanel";
import TypographyForm from "./TypographyForm";
import type { ReaderSettings } from "../lib/settings";
import type { SettingsTab } from "../lib/route";
import { BUILD, formatBuild } from "../lib/version";

/**
 * 〈設定〉: everything that is not a book.
 *
 * A floor rather than a drawer, and that is the whole reason it can hold tabs. What it says has
 * nothing to do with the screen the reader came from — which is exactly the test a floor has to
 * pass and a drawer has to fail (CONTEXT.md, 〈三種面〉). It used to stack over the shelf or over
 * a book as `?d=settings`, which is why it never had room for anything but one list.
 *
 * **Two tabs, ordered near to far**: 排版 is touched most days, 帳號 a few times a year. The
 * order is itself a sentence about which one the reader probably came for.
 *
 * The reader's own 〈排版〉 panel shows the same `TypographyForm` this does. That is not the
 * duplication this change set out to kill: there is one stored record now, so the two are one
 * setting shown in two places rather than two scopes wearing identical controls (ADR-0026).
 */
export default function SettingsScreen({
  tab,
  onTab,
  onBack,
  settings,
  onChange,
  onReset,
  onImported,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onBack: () => void;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
  /** The shelf has to reload after a backup lands: it is holding rows that just changed. */
  onImported: () => void;
}) {
  return (
    <div className="settings-screen" data-testid="settings-screen">
      {/* Always back to the shelf, because that is the only door in: the reader's bar carries
          目錄, 筆記 and 排版 and nothing else now (ADR-0026). A reader deep-linked straight here
          by the login return still lands somewhere that exists. */}
      <header className="settings-header">
        <button className="ghost" onClick={onBack} data-testid="settings-back">
          ‹ 書架
        </button>
        <strong className="settings-title">設定</strong>
      </header>

      <nav className="settings-tabs" data-testid="settings-tabs">
        <Tab open={tab} tab="typography" label="排版" onTab={onTab} />
        <Tab open={tab} tab="account" label="帳號" onTab={onTab} />
      </nav>

      <div className="settings-pane">
        {tab === "typography" ? (
          <TypographyForm
            settings={settings}
            onChange={onChange}
            onReset={onReset}
            /* No book on this floor, so 欄數 has nothing to be taken away for. A 直排 book
               disables it in the reader's own panel, where the book is. */
            verticalBook={false}
          />
        ) : (
          <AccountPanel onImported={onImported} />
        )}
      </div>

      {/* Under both tabs rather than inside either: which build is running is a fact about the
          whole app, and giving it to a tab would start that tab collecting strays. */}
      <footer
        className="settings-footer"
        title={BUILD.dirty ? "這個版本是從有未提交變更的工作目錄建置的" : undefined}
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
  label: string;
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
