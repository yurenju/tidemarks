import { useEffect, useState } from "react";
import AboutDrawer from "./components/AboutDrawer";
import Library from "./components/Library";
import Reader from "./components/Reader";
import SettingsScreen from "./components/SettingsScreen";
import { authorizeReturnTarget } from "./lib/authorize-return";
import {
  DEFAULT_SETTINGS,
  dropLegacyOverrides,
  loadSettings,
  saveSettings,
  type ReaderSettings,
} from "./lib/settings";
import {
  hashFor,
  openBookId,
  parseHash,
  type Drawer,
  type Route,
  type Screen,
  type SettingsTab,
} from "./lib/route";
import { registerUiFonts } from "./lib/ui-font";
import { beaconPositions, syncNow } from "./lib/sync";

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const bookId = openBookId(route);
  /**
   * The six, once, for every book on this device.
   *
   * There used to be a second piece of state here holding what the open book claimed for
   * itself, and four callbacks to move values between the two layers. All of it is gone: a
   * reader adjusting type is saying how they read, not how this book should look (ADR-0026).
   */
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  // Bumped to make the shelf re-read storage after a backup lands on top of it.
  const [reloadToken, setReloadToken] = useState(0);

  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The theme, and the one piece of it that lives outside the stylesheet: the colour the
  // platform paints its own system bar in. That bar sits directly above the reader's top bar,
  // so it takes the chrome's surface — the same step off the page the bars themselves take
  // (ADR-0028) — and the seam between the two disappears.
  //
  // Read back out of the cascade rather than restated here. `dataset.theme` is set first and
  // `getComputedStyle` forces the recalc, so the value returned is the one the bars are about
  // to be drawn in. A literal in this file would be a second copy of a token, and the copy that
  // gets forgotten is always the one outside the stylesheet.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;

    const surface = getComputedStyle(root).getPropertyValue("--surface-raised").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && surface) meta.setAttribute("content", surface);
  }, [resolvedTheme]);

  // Once, at startup: the two-layer model's storage is read by nothing now, and leaving it
  // there would make it look like state something still wants (ADR-0026).
  useEffect(() => {
    dropLegacyOverrides();
  }, []);

  // A drawer standing over the shelf locks the shelf, so a flick meant for the drawer does not
  // scroll the covers behind it. On the root element rather than on `<body>`: the root is the
  // scrolling box, and it is the one `scrollbar-gutter` holds a lane open on — which is what
  // keeps the page from jumping sideways as this goes on and off. The drawer keeps its own
  // scrollbar; only what is underneath stops moving.
  useEffect(() => {
    document.documentElement.dataset.drawer = route.drawer ? "open" : "";
  }, [route.drawer]);

  // Once, at startup, and deliberately not when a download finishes — `lib/ui-font.ts` has
  // why. Nothing waits on it: the chrome is already drawn in the platform's serif, and this
  // either improves it or does not.
  useEffect(() => {
    void registerUiFonts();
  }, []);

  // Sync triggers: app open, and both edges of visibility. Coming back pulls what other
  // devices wrote; leaving pushes this device's last page turn, which is the one an agent in
  // the app the reader just switched to is about to be asked about (`beaconPositions`).
  useEffect(() => {
    void syncNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncNow();
      else beaconPositions();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Hash is the source of truth so refresh and back/forward return to the same screen.
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // An agent's OAuth flow sends a session-less browser here to log in, and the login lives in
  // 〈設定〉's 帳號 tab — so go there. Putting it in the hash rather than in a piece of state
  // means a refresh on the way through does not lose it.
  useEffect(() => {
    if (!authorizeReturnTarget(window.location.search)) return;
    const here = parseHash(window.location.hash);
    if (here.screen.kind === "settings") return;
    go({ screen: { kind: "settings", tab: "account" }, drawer: null });
  }, []);

  function go(next: Route) {
    window.location.hash = hashFor(next);
  }

  function goTo(screen: Screen) {
    go({ screen, drawer: null });
  }

  function openDrawer(drawer: Drawer) {
    go({ ...route, drawer });
  }

  function closeDrawer() {
    go({ ...route, drawer: null });
  }

  /** Every adjustment lands here, from either shell, and reaches every book. */
  function changeSetting(patch: Partial<ReaderSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }

  return (
    <>
      {route.screen.kind === "settings" ? (
        <SettingsScreen
          tab={route.screen.tab}
          onTab={(tab: SettingsTab) => goTo({ kind: "settings", tab })}
          onBack={() => goTo({ kind: "shelf" })}
          settings={settings}
          onChange={changeSetting}
          onReset={resetSettings}
          onImported={() => setReloadToken((n) => n + 1)}
        />
      ) : bookId ? (
        <Reader
          bookId={bookId}
          onClose={() => goTo({ kind: "shelf" })}
          onOpenAbout={() => openDrawer({ kind: "about", bookId })}
          settings={settings}
          onSettingChange={changeSetting}
          onResetSettings={resetSettings}
          resolvedTheme={resolvedTheme}
        />
      ) : (
        <Library
          reloadToken={reloadToken}
          onOpen={(id) => goTo({ kind: "book", bookId: id })}
          onOpenSettings={() => goTo({ kind: "settings", tab: "typography" })}
          onOpenAbout={(id) => openDrawer({ kind: "about", bookId: id })}
        />
      )}

      {/* The one drawer left, out here because that is what a drawer is: it stacks on whichever
          floor is underneath (`#/book/abc?d=about/abc` and `#/?d=about/abc` are the same one). */}
      <AboutDrawer
        bookId={route.drawer?.kind === "about" ? route.drawer.bookId : null}
        onClose={closeDrawer}
        onDeleted={(deleted) => {
          // The drawer shuts either way, since it is about a book that is no longer there. The
          // floor underneath only moves if it was that same book.
          goTo(bookId === deleted ? { kind: "shelf" } : route.screen);
          setReloadToken((n) => n + 1);
        }}
      />
    </>
  );
}
