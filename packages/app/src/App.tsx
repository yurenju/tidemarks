import { useEffect, useState } from "react";
import AboutDrawer from "./components/AboutDrawer";
import Library from "./components/Library";
import Reader from "./components/Reader";
import SettingsScreen from "./components/SettingsScreen";
import { authorizeReturnTarget } from "./lib/authorize-return";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ReaderSettings } from "./lib/settings";
import {
  hashFor,
  movedTo,
  openBookId,
  parseHash,
  type At,
  type Drawer,
  type Route,
  type Screen,
  type SettingsTab,
} from "./lib/route";
import { registerUiFonts } from "./lib/ui-font";
import { activateLocale, i18n } from "./lib/i18n";
import { saveLocale, type Locale } from "./lib/locale";
import { createSyncGate } from "./lib/sync-gate";
import { beaconPositions, syncNow } from "./lib/sync";
import { forgetStaleFonts } from "./lib/web-font-store";

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
  /**
   * The interface language, already chosen and activated before this component existed
   * (`main.tsx`). Held here only so that changing it re-renders — Lingui itself is the store.
   */
  const [locale, setLocale] = useState<Locale>(() => i18n.locale as Locale);

  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /**
   * Whether the reader's chrome is standing up, reported by `Reader` so this file can colour
   * the system bar to match whatever is under it. `false` on every other screen.
   *
   * Held here rather than read where it lives because the effect below has to be **one**
   * writer: React runs a child's effects before its parent's, so a `Reader` that wrote the tag
   * itself would be overwritten by this one on every theme change — and overwritten with the
   * shelf's answer.
   */
  const [chromeUp, setChromeUp] = useState(false);

  // The theme, and the one piece of it that lives outside the stylesheet: the colour the
  // platform paints its own system bar in.
  //
  // **It takes the colour of whatever is directly under it**, which is what ADR-0028 asked for
  // and what makes the seam disappear. Under 〈找〉 that is the reader's top bar, one step off
  // the page; under 〈讀〉 and on every other screen there is no bar there, and the surface that
  // reaches the top edge is the page itself. The bar used to be `--surface-raised` in all three,
  // which left a lit strip hanging over a book with nothing beneath it to belong to.
  //
  // ⚠️ **This is a state changing a colour, which `styles/reader.css` deliberately does not do
  // for anything inside the window** — a page that changes tone every time the chrome is tapped
  // is a page that flickers. The system bar is the exception on two counts: it is outside the
  // window, and the platform swaps it instantly, so there is no half-beat where one surface has
  // arrived and its neighbour has not.
  //
  // Read back out of the cascade rather than restated here. `dataset.theme` is set first and
  // `getComputedStyle` forces the recalc, so the value returned is the one about to be drawn.
  // A literal in this file would be a second copy of a token, and the copy that gets forgotten
  // is always the one outside the stylesheet.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;

    const token = chromeUp ? "--surface-raised" : "--surface-page";
    const surface = getComputedStyle(root).getPropertyValue(token).trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && surface) meta.setAttribute("content", surface);
  }, [resolvedTheme, chromeUp]);

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
  //
  // The two static faces a device may still hold go first, so a reader who never opens a
  // book again still gets the space back.
  useEffect(() => {
    void forgetStaleFonts();
    void registerUiFonts();
  }, []);

  // Sync triggers: app open, every way the reader can arrive, and anything they do once they
  // are here. Arriving pulls what other devices wrote; leaving pushes this device's last page
  // turn, which is the one an agent in the app the reader just switched to is about to be
  // asked about (`beaconPositions`).
  //
  // **Every one of these is something that happened in this tab**, because that is all there
  // is: nothing tells a browser that another device wrote a position. `lib/sync-gate.ts` is
  // why that is enough, and what it leaves uncovered.
  //
  // `focus` and `online` are not spare wheels on `visibilitychange`. Switching windows on a
  // desktop leaves the tab visible throughout, so visibility never changes and only `focus`
  // fires — which is the whole of why a desktop could sit on a stale position indefinitely.
  useEffect(() => {
    void syncNow();
    const allow = createSyncGate();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") beaconPositions();
      else if (allow("resumed")) void syncNow();
    };
    const onResumed = () => {
      if (allow("resumed")) void syncNow();
    };
    const onActivity = () => {
      if (allow("activity")) void syncNow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onResumed);
    window.addEventListener("online", onResumed);
    // Capture, because a React handler that calls `stopPropagation` — the scrubber does —
    // would otherwise leave a tap on it looking like nobody was here.
    //
    // **Nothing the reader does inside the book reaches these**, and it does not need to: the
    // book is an iframe, so its taps stay in it (frond's `section-view.ts`), and every page
    // turn already schedules a sync of its own. What these two are for is everything that
    // touches the interface without writing anything — a shelf, a panel, a settings screen.
    window.addEventListener("pointerdown", onActivity, true);
    window.addEventListener("keydown", onActivity, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onResumed);
      window.removeEventListener("online", onResumed);
      window.removeEventListener("pointerdown", onActivity, true);
      window.removeEventListener("keydown", onActivity, true);
    };
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

  // **The state moves with the hash, rather than waiting for `hashchange` to come back round.**
  // That round trip is a browser event, so it lands a turn after any state set alongside it, and
  // in that gap `route` still names the screen the reader just left — a render against a screen
  // nobody is on. The passage tapped on the shelf's card used to be thrown away in exactly that
  // gap, back when it was a piece of state sitting next to the route instead of part of it (#127).
  //
  // `hashchange` still arrives and still sets the route; it parses to the same value, so the
  // second write says nothing new. Back and forward reach the app through that listener alone
  // and are untouched by this.
  function go(next: Route) {
    window.location.hash = hashFor(next);
    setRoute(next);
  }

  /**
   * Moves the address to a place inside the book already on screen, **without a history entry**.
   *
   * The reader is standing where this says; the jump has happened. What it is for is the bar
   * itself — the page they are looking at is now one they can copy out and send. Pushing an
   * entry instead would put a back button on it that goes nowhere: the address is read when a
   * book opens, so walking back through it would move the bar and not the book.
   *
   * What the new screen is — and what it stops carrying — is `movedTo`'s, in `lib/route.ts`
   * beside the parsing it has to agree with.
   */
  function replaceAt(at: At) {
    if (route.screen.kind !== "book") return;
    const next: Route = { ...route, screen: movedTo(route.screen, at) };
    window.history.replaceState(null, "", hashFor(next));
    setRoute(next);
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

  /**
   * Not part of `changeSetting`, because it is not one of the six: those describe how a book
   * should look and are handed to frond as a set; this one never reaches a book at all.
   */
  function changeLocale(next: Locale) {
    setLocale(next);
    saveLocale(next);
    activateLocale(next);
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
          locale={locale}
          onLocaleChange={changeLocale}
        />
      ) : bookId ? (
        <Reader
          bookId={bookId}
          openAt={openAtFor(route.screen)}
          select={route.screen.kind === "book" ? route.screen.select : undefined}
          handles={route.screen.kind === "book" ? route.screen.handles : undefined}
          onAt={replaceAt}
          onClose={() => goTo({ kind: "shelf" })}
          onOpenAbout={() => openDrawer({ kind: "about", bookId })}
          settings={settings}
          onSettingChange={changeSetting}
          onResetSettings={resetSettings}
          resolvedTheme={resolvedTheme}
          onChromeChange={setChromeUp}
        />
      ) : (
        <Library
          reloadToken={reloadToken}
          // A passage tapped on the revisit card travels as part of the address rather than
          // beside it, so the reader can send it on — and so opening the same book off the wall
          // later, with no passage named, lands where they had actually read on to.
          onOpen={(id, cfiRange) =>
            goTo({
              kind: "book",
              bookId: id,
              ...(cfiRange ? { at: { kind: "cfi", cfi: cfiRange } as const } : {}),
            })
          }
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

/**
 * Where to open the book, out of the two things the address can say about it.
 *
 * **A `?select=` naming a CFI is also a place**, so on its own it opens the book there. The
 * passage has to be on screen before it can be selected, which would otherwise mean writing the
 * same long CFI into the address twice — and the second one saying nothing the first did not.
 *
 * `?at=` wins when both are given: that is the only way to say "open the chapter here, select
 * something further down it". A `?select=` naming a phrase never answers this — which section
 * holds a phrase is not knowable without reading the book, so it needs an `?at=` of its own.
 *
 * This is policy rather than parsing, which is why it is not in `parseHash`: the address says
 * two things, and that one of them implies the other is a decision about this app.
 */
function openAtFor(screen: Screen): At | undefined {
  if (screen.kind !== "book") return undefined;
  if (screen.at) return screen.at;
  return screen.select?.kind === "cfi" ? { kind: "cfi", cfi: screen.select.cfi } : undefined;
}
