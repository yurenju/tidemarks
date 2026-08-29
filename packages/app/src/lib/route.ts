// The address bar, as the app reads and writes it.
//
// Two questions, two places to answer them: the path says which screen the reader is standing
// on, and a `?d=` query segment says which drawer is stacked on top. A drawer stacks on whatever
// is there, so putting it in a trailing path segment would give every drawer one route per
// underlying screen, and adding a screen would mean another round of them.
//
// A book screen answers a third: `?at=` says where in the book to open. It is a query rather
// than a path segment for the same reason `d=` is — it qualifies the screen instead of naming a
// different one — and it is **read once, when the book opens**. Turning a page does not write it
// back: a hash the app writes is a hash the browser announces back to it, and every turn would
// also be a history entry, so the back button would walk pages instead of leaving the book.
//
// 〈設定〉 is in the path rather than in `d=` because it stopped being a drawer: it says nothing
// about the screen the reader came from, which is the whole test for a floor (CONTEXT.md,
// 〈三種面〉). Its tab is part of that path, so each tab has an address of its own.

const BOOK_PREFIX = "#/book/";
const SETTINGS_PREFIX = "#/settings";
const ABOUT_PREFIX = "about/";

/** Which pane of 〈設定〉 is showing. */
export type SettingsTab = "typography" | "account" | "language";

const SETTINGS_TABS: SettingsTab[] = ["typography", "account", "language"];
/** The one a reader almost always came for, and what an unreadable tab falls back to. */
const DEFAULT_SETTINGS_TAB: SettingsTab = "typography";

/**
 * Where in a book to open, when the address names somewhere in particular rather than "wherever
 * I stopped". Three spellings, because the three callers know three different things.
 *
 * - `cfi:` — a passage, exact to the character. What the shelf's revisit card and the notes
 *   panel hold, and the only one of the three the saved position is also written in.
 * - `chars:<section>` / `chars:<section>/<n>` — a chapter, and optionally how far into it. The
 *   one an epub's own structure gives away without laying the book out.
 * - `frac:` — how far through the whole book, the same number the position axis shows.
 *
 * **No page number**, deliberately: a page is what a layout produced, so the same sentence falls
 * on a different one at another type size or window width. An address that names a page names a
 * different sentence tomorrow.
 */
export type At =
  | { kind: "cfi"; cfi: string }
  | { kind: "chars"; sectionIndex: number; characters: number }
  | { kind: "fraction"; fraction: number };

/**
 * A floor: the screen the reader is standing on, one at a time.
 *
 * `at` hangs off the book screen rather than off `Route` because it qualifies *this* screen —
 * there is no such thing as opening the shelf at a passage, and saying so in the type is what
 * keeps `?at=` off every other address.
 */
export type Screen =
  | { kind: "shelf" }
  | { kind: "book"; bookId: string; at?: At }
  | { kind: "settings"; tab: SettingsTab };

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
  const params = new URLSearchParams(query);
  return { screen: screenFrom(path, params), drawer: drawerFrom(params) };
}

export function hashFor(route: Route): string {
  const path = pathFor(route.screen);
  const query: string[] = [];
  if (route.drawer) query.push(`d=${drawerSegment(route.drawer)}`);
  const at = route.screen.kind === "book" ? route.screen.at : undefined;
  if (at) query.push(`at=${encodeURIComponent(atSegment(at))}`);
  return query.length === 0 ? path : `${path}?${query.join("&")}`;
}

/** The book the reader has open, or null on any other floor. */
export function openBookId(route: Route): string | null {
  return route.screen.kind === "book" ? route.screen.bookId : null;
}

function screenFrom(path: string, params: URLSearchParams): Screen {
  if (path.startsWith(BOOK_PREFIX)) {
    const id = path.slice(BOOK_PREFIX.length);
    if (id) {
      const at = atFrom(params.get("at"));
      return { kind: "book", bookId: decodeURIComponent(id), ...(at ? { at } : {}) };
    }
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
function drawerFrom(params: URLSearchParams): Drawer | null {
  // `URLSearchParams` has already percent-decoded what it hands back, so the id below is the
  // real one. Decoding it a second time would turn a book id holding a literal `%20` into one
  // holding a space.
  const d = params.get("d");
  if (d?.startsWith(ABOUT_PREFIX)) {
    const bookId = d.slice(ABOUT_PREFIX.length);
    if (bookId) return { kind: "about", bookId };
  }
  return null;
}

function drawerSegment(drawer: Drawer): string {
  return ABOUT_PREFIX + encodeURIComponent(drawer.bookId);
}

// Unreadable means "no address", on the same grounds as an unknown drawer: the reader still gets
// the book, opened where they left it. A typo in a hand-written `?at=` should cost a jump, not
// the screen.
function atFrom(value: string | null): At | undefined {
  if (value === null) return undefined;

  const cut = value.indexOf(":");
  if (cut === -1) return undefined;
  const kind = value.slice(0, cut);
  const rest = value.slice(cut + 1);
  if (rest === "") return undefined;

  if (kind === "cfi") return { kind: "cfi", cfi: rest };

  if (kind === "chars") {
    // `12` is the head of chapter 12, `12/300` is 300 characters into it. The chapter alone is
    // the common case — it is what a table of contents can say — so it is what the short form is.
    const parts = rest.split("/");
    if (parts.length > 2) return undefined;
    const sectionIndex = wholeNumber(parts[0]);
    const into = wholeNumber(parts[1] ?? "0");
    if (sectionIndex === undefined || into === undefined) return undefined;
    return { kind: "chars", sectionIndex, characters: into };
  }

  if (kind === "frac") {
    const fraction = Number(rest);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return undefined;
    return { kind: "fraction", fraction };
  }

  return undefined;
}

function wholeNumber(value: string | undefined): number | undefined {
  // `Number` alone would take `1e3`, ` 4` and `2.5`; a section index and a character count are
  // neither negative nor fractional, and a hash that says otherwise is not one this app wrote.
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function atSegment(at: At): string {
  switch (at.kind) {
    case "cfi":
      return `cfi:${at.cfi}`;
    case "chars":
      return `chars:${at.sectionIndex}/${at.characters}`;
    case "fraction":
      return `frac:${at.fraction}`;
  }
}
