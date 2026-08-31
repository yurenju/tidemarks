import { useEffect, useRef, useState } from "react";
import AboutBook from "./components/AboutBook";
import Library from "./components/Library";
import Reader from "./components/Reader";
import SettingsScreen from "./components/SettingsScreen";
import { authorizeReturnTarget } from "./lib/authorize-return";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ReaderSettings } from "./lib/settings";
import {
  barPanel,
  hashFor,
  movedTo,
  openBookId,
  panelDepth,
  parseHash,
  samePanel,
  type At,
  type Panel,
  type Route,
  type Screen,
  type SettingsTab,
} from "./lib/route";
import {
  BOOK_KEEPS_A_COLUMN,
  panelCoversEverything,
  PANEL_NEEDS,
  useMediaQuery,
} from "./lib/media";
import { registerUiFonts } from "./lib/ui-font";
import { activateLocale, i18n } from "./lib/i18n";
import { saveLocale, type Locale } from "./lib/locale";
import { createSyncGate } from "./lib/sync-gate";
import { beaconPositions, syncNow } from "./lib/sync";
import { forgetStaleFonts } from "./lib/web-font-store";

/**
 * What `showPanel` writes onto a history entry it pushed.
 *
 * `panel` says the entry is ours to take back — a reader who pasted the address into a new tab
 * has none, and there is nothing behind it to step to. `behind` is the panel that was standing
 * when it was pushed, which is how far back "close this" reaches: storeys and entries are not
 * the same count, and closing a note clears two storeys that may be one entry or two.
 */
interface PanelEntry {
  panel: true;
  behind: Panel | null;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  /**
   * The screen to put back on the address once a step back this app asked for has landed.
   *
   * `null` at every other moment, including while the *reader's* own back button is travelling:
   * that one is theirs and rewinds everything, which is what they asked for.
   */
  const keepScreenAcrossBack = useRef<Screen | null>(null);
  const bookId = openBookId(route);
  /**
   * The six, once, for every book on this device.
   *
   * There used to be a second piece of state here holding what the open book claimed for
   * itself, and four callbacks to move values between the two layers. All of it is gone: a
   * reader adjusting type is saying how they read, not how this book should look (ADR-0005).
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
  // and what makes the seam disappear. Under [[Find]] that is the reader's top bar, one step off
  // the page; under [[Read]] and on every other screen there is no bar there, and the surface that
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

  // A panel covering the whole screen locks what is under it, so a flick meant for the panel
  // does not scroll the covers behind it. On the root element rather than on `<body>`: the root
  // is the scrolling box, and it is the one `scrollbar-gutter` holds a lane open on — which is
  // what keeps the page from jumping sideways as this goes on and off. The panel keeps its own
  // scrollbar; only what is underneath stops moving.
  //
  // **The same condition that decides whether the panel traps the focus** (`lib/media.ts`), and
  // asked here rather than inside the panel because this attribute needs one writer: two shells
  // change state in the same frame when [[About]] rises over a standing [[Contents]], and which of
  // their effects ran last would decide whether the page was left locked.
  const besideTheBook = useMediaQuery(BOOK_KEEPS_A_COLUMN);
  const panelCovers =
    route.panel !== null && panelCoversEverything(PANEL_NEEDS[route.panel.kind], besideTheBook);
  useEffect(() => {
    document.documentElement.dataset.panel = panelCovers ? "covering" : "";
  }, [panelCovers]);

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
  //
  // **This is the whole of what the back button does to a panel**, and it stops here: what
  // arrives is a new address, and the reader turns it into a `panelDismissed` for the state
  // machine that owns the chrome. Nothing in this file reaches into that machine, and nothing
  // needed a `backPressed` event of its own — a panel going away is a panel going away, however
  // the reader asked for it (ADR-0046).
  //
  // **The one thing that does not come back with it is the reader's place in the book**, when
  // the step back was this app's own (`showPanel`). Closing a panel takes back the storey it
  // stood on and nothing else, and the entry underneath predates whatever `replaceAt` wrote
  // while it was open — which on a hand-held is the passage the reader is looking at right now,
  // put there by pressing a quote in [[Notes]] (that press closes the panel at that width, so the
  // two arrive together). Left alone, the address would forget the page it had just named.
  //
  // ⚠️ **Only for an address that came back to the same book**, and that guard is the whole of
  // what keeps this from being a trap. Stepping back is asynchronous, so the next `hashchange`
  // is not guaranteed to be the one it caused: anything that moves the address in the same
  // frame — a link, a `goto` in a script — arrives first and would be handed the book's own
  // address, putting the reader back in the book they had just left. Measured, in the screen
  // sweep, which presses Escape and navigates to [[Settings]] in the same tick.
  useEffect(() => {
    const onHashChange = () => {
      const arrived = parseHash(window.location.hash);
      const keep = keepScreenAcrossBack.current;
      keepScreenAcrossBack.current = null;
      const sameBook =
        keep?.kind === "book" &&
        arrived.screen.kind === "book" &&
        keep.bookId === arrived.screen.bookId;
      if (keep === null || !sameBook) {
        setRoute(arrived);
        return;
      }
      const kept: Route = { screen: keep, panel: arrived.panel };
      // Compared as addresses rather than as objects: the entry stepped back to usually already
      // says this, and rewriting it then would be a write that changes nothing.
      if (hashFor(kept) !== hashFor(arrived)) {
        window.history.replaceState(window.history.state, "", hashFor(kept));
      }
      setRoute(kept);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // An agent's OAuth flow sends a session-less browser here to log in, and the login lives in
  // [[Settings]]'s [[Account]] tab — so go there. Putting it in the hash rather than in a piece of state
  // means a refresh on the way through does not lose it.
  useEffect(() => {
    if (!authorizeReturnTarget(window.location.search)) return;
    const here = parseHash(window.location.hash);
    if (here.screen.kind === "settings") return;
    go({ screen: { kind: "settings", tab: "account" }, panel: null });
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
   *
   * ⚠️ **The entry's own state is carried over, not cleared.** `showPanel` below marks the
   * entries it pushes, and that mark is how closing a panel knows to pop the entry rather than
   * write over it. This runs while a panel may be standing — pressing a quote in [[Notes]] moves
   * the address and, beside the book, leaves the panel up — so a `null` here would strip the
   * mark off an entry that is very much ours, and the ✕ after it would leave a dead history
   * entry behind: the reader's next press of back does nothing, and it takes two to leave the
   * book.
   */
  function replaceAt(at: At) {
    if (route.screen.kind !== "book") return;
    const next: Route = { ...route, screen: movedTo(route.screen, at) };
    window.history.replaceState(window.history.state, "", hashFor(next));
    setRoute(next);
  }

  function goTo(screen: Screen) {
    go({ screen, panel: null });
  }

  /**
   * A panel opening, closing, or being swapped for another — and **the only place that decides
   * what a panel does to the history stack** (ADR-0046).
   *
   * The two functions above write the address too, and neither is about a panel: `go` moves
   * between screens and `replaceAt` re-points the one the reader is on. What must not exist
   * anywhere else is a second answer to *how deep the reader now is*, which is the question
   * below.
   *
   * The rule is one sentence: *pressing the browser's back button steps out one storey.* So the
   * only thing asked here is which way the storey count went, never which of the eleven chrome
   * events moved it — [[Contents]] closing because the reader turned a page and because they pressed
   * the ✕ are the same descent, and a rule per event would be eight rules in eight files, which
   * is the trap `lib/chrome.ts` was written to get out of once already.
   *
   * | storeys | address | when |
   * | --- | --- | --- |
   * | deeper | push **one** entry, however many storeys were climbed | raising a panel (0→1), opening a note in it (1→2), pressing a mark in the book (0→2) |
   * | level | `replaceState` | [[Contents]] swapped for [[Notes]]: another face on the same storey, not a second one |
   * | shallower | step back to the entry that holds it | ✕, ←, a swipe, Escape, and the page turns and jumps that put a panel away |
   *
   * **Descending is a step back rather than a write, because JavaScript cannot delete a history
   * entry.** Writing over it (`replaceState`) leaves an entry identical to the one before it, so
   * the reader's first press of back appears to do nothing and it takes two to leave the book;
   * pushing instead means the forward button fetches the panel back. Only going back takes back
   * the entry that was pushed.
   *
   * ⚠️ **How far back is not "one storey down", and that is why each entry remembers what stood
   * behind it.** Storeys and entries are not the same count: climbing 0→1→2 pushes two entries
   * while climbing 0→2 in one move pushes one, and a single ✕ on an open note clears both
   * storeys at once. Popping one entry there lands on the notes list, which the address→chrome
   * mirror then reads and puts straight back on screen — the reader presses the ✕ twice.
   * `behind` is the panel the entry was pushed over, so the step can be aimed at the entry that
   * actually holds what is wanted rather than counted off the storeys.
   *
   * Three ways it can land, and all three are reachable:
   * - the entry behind is exactly what is wanted → back one;
   * - it is a panel that is itself over the bare screen, and the bare screen is what is wanted →
   *   back two ([[Notes]] → a note → ✕);
   * - it is not what is wanted at all → write over this entry instead. That is [[Contents]] pressed
   *   while a note is open: there is no entry anywhere holding [[Contents]], so stepping back
   *   could only land on something else.
   *
   * ⚠️ **Unless this app did not push it.** A reader who pastes `?d=notes/…` straight into a new
   * tab lands with that panel already up on the tab's *first* entry: going back there has
   * nothing to pop, so the address never changes, no `hashchange` arrives, the state machine is
   * never told, and the panel sits on screen through every press of ←. The marker on the entry
   * (`{ panel: true }`) is what tells the two apart, and writing over a first entry leaves no
   * dead history behind because there is no duplicate in front of it.
   *
   * ⚠️ **Going back is asynchronous.** The panel goes when the browser announces the new
   * address, about a frame later than it used to. That is the price of "closing is stepping
   * back", and it is paid on purpose.
   */
  function showPanel(panel: Panel | null) {
    if (samePanel(panel, route.panel)) return;
    const next: Route = { ...route, panel };
    const here = panelDepth(route.panel);
    const there = panelDepth(panel);
    const entry = window.history.state as PanelEntry | null;

    if (there > here) {
      window.history.pushState(
        { panel: true, behind: route.panel } satisfies PanelEntry,
        "",
        hashFor(next),
      );
      setRoute(next);
      return;
    }
    if (there === here) {
      // The marker is carried over rather than dropped: this is the same entry, still ours.
      window.history.replaceState(entry, "", hashFor(next));
      setRoute(next);
      return;
    }
    if (entry?.panel === true) {
      const behind = entry.behind ?? null;
      // Stepping back rewinds the whole address, and the screen underneath is not this
      // function's to rewind: `replaceAt` may have written the passage the reader is looking at
      // onto this very entry. Held here and put back when the new address arrives.
      keepScreenAcrossBack.current = route.screen;
      // `hashchange` brings the new address back round and everything else follows from it.
      if (samePanel(panel, behind)) {
        window.history.back();
        return;
      }
      // The bare screen, two entries down. A panel standing behind a panel was itself pushed
      // over the screen — same-storey moves write over rather than push, so there is never a
      // third one to count past.
      if (panel === null && behind !== null) {
        window.history.go(-2);
        return;
      }
      keepScreenAcrossBack.current = null;
    }
    window.history.replaceState(entry, "", hashFor(next));
    setRoute(next);
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
          // What `?d=` says about the reader's own three faces, and where a change to them goes.
          // [[About]] reads as `null` here on purpose: one `?d=` holds one panel, so [[About]] standing
          // *is* the chrome having none of the three up (`lib/route.ts`'s `barPanel`).
          panel={barPanel(route.panel)}
          onPanel={showPanel}
          onAt={replaceAt}
          onClose={() => goTo({ kind: "shelf" })}
          onOpenAbout={() => showPanel({ kind: "about", bookId })}
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
          onOpenAbout={(id) => showPanel({ kind: "about", bookId: id })}
        />
      )}

      {/* Out here rather than inside either screen, because it stacks on whichever floor is
          underneath (`#/book/abc?d=about/abc` and `#/?d=about/abc` are the same panel). The
          reader's other three are rendered by the reader, since there is no reader's box to
          stand in without one. */}
      <AboutBook
        bookId={route.panel?.kind === "about" ? route.panel.bookId : null}
        onClose={() => showPanel(null)}
        onDeleted={(deleted) => {
          // The panel shuts either way, since it is about a book that is no longer there. The
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
