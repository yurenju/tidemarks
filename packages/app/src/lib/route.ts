// The address bar, as the app reads and writes it.
//
// Two questions, two places to answer them: the path says which screen the reader is standing
// on, and a `?d=` query segment says which drawer is stacked on top. A drawer stacks on whatever
// is there, so putting it in a trailing path segment would give every drawer one route per
// underlying screen, and adding a screen would mean another round of them.
//
// 〈設定〉 is in the path rather than in `d=` because it stopped being a drawer: it says nothing
// about the screen the reader came from, which is the whole test for a floor (CONTEXT.md,
// 〈三種面〉). Its tab is part of that path, so each tab has an address of its own.

const BOOK_PREFIX = "#/book/";
const SETTINGS_PREFIX = "#/settings";
const ABOUT_PREFIX = "about/";

/** Which pane of 〈設定〉 is showing. */
export type SettingsTab = "typography" | "account";

const SETTINGS_TABS: SettingsTab[] = ["typography", "account"];
/** The one a reader almost always came for, and what an unreadable tab falls back to. */
const DEFAULT_SETTINGS_TAB: SettingsTab = "typography";

/** A floor: the screen the reader is standing on, one at a time. */
export type Screen =
  { kind: "shelf" } | { kind: "book"; bookId: string } | { kind: "settings"; tab: SettingsTab };

/**
 * A drawer: the sort of screen that stacks on the current one rather than replacing it.
 *
 * The details drawer carries its own book id even when the screen underneath is that same book
 * (`#/book/abc?d=about/abc`). Those few redundant characters buy the rule that reading the hash
 * never means looking at what is below it.
 */
export type Drawer = { kind: "about"; bookId: string };

export interface Route {
  screen: Screen;
  drawer: Drawer | null;
}

export function parseHash(hash: string): Route {
  const cut = hash.indexOf("?");
  const path = cut === -1 ? hash : hash.slice(0, cut);
  const query = cut === -1 ? "" : hash.slice(cut + 1);
  return { screen: screenFrom(path), drawer: drawerFrom(query) };
}

export function hashFor(route: Route): string {
  const path = pathFor(route.screen);
  return route.drawer ? `${path}?d=${drawerSegment(route.drawer)}` : path;
}

/** The book the reader has open, or null on any other floor. */
export function openBookId(route: Route): string | null {
  return route.screen.kind === "book" ? route.screen.bookId : null;
}

function screenFrom(path: string): Screen {
  if (path.startsWith(BOOK_PREFIX)) {
    const id = path.slice(BOOK_PREFIX.length);
    if (id) return { kind: "book", bookId: decodeURIComponent(id) };
    return { kind: "shelf" };
  }
  if (path === SETTINGS_PREFIX || path.startsWith(`${SETTINGS_PREFIX}/`)) {
    return { kind: "settings", tab: settingsTabFrom(path.slice(SETTINGS_PREFIX.length + 1)) };
  }
  return { kind: "shelf" };
}

// A hash is whatever the address bar happens to hold, so an unreadable tab opens the one the
// reader was most likely after rather than dropping them somewhere else entirely.
function settingsTabFrom(segment: string): SettingsTab {
  return SETTINGS_TABS.includes(segment as SettingsTab)
    ? (segment as SettingsTab)
    : DEFAULT_SETTINGS_TAB;
}

function pathFor(screen: Screen): string {
  switch (screen.kind) {
    case "book":
      return BOOK_PREFIX + encodeURIComponent(screen.bookId);
    case "settings":
      return `${SETTINGS_PREFIX}/${screen.tab}`;
    case "shelf":
      return "#/";
  }
}

// Anything unrecognised means "no drawer" rather than an error: the reader still gets the screen
// they can see. `d=settings` and `d=account` land here now that both became floors.
function drawerFrom(query: string): Drawer | null {
  // `URLSearchParams` has already percent-decoded what it hands back, so the id below is the
  // real one. Decoding it a second time would turn a book id holding a literal `%20` into one
  // holding a space.
  const d = new URLSearchParams(query).get("d");
  if (d?.startsWith(ABOUT_PREFIX)) {
    const bookId = d.slice(ABOUT_PREFIX.length);
    if (bookId) return { kind: "about", bookId };
  }
  return null;
}

function drawerSegment(drawer: Drawer): string {
  return ABOUT_PREFIX + encodeURIComponent(drawer.bookId);
}
