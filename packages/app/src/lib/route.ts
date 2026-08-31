// The address bar, as the app reads and writes it.
//
// Two questions, two places to answer them: the path says which screen the reader is standing
// on, and a `?d=` query segment says which panel is stacked on top. A panel stacks on whatever
// is there, so putting it in a trailing path segment would give every panel one route per
// underlying screen, and adding a screen would mean another round of them.
//
// A book screen answers a third: `?at=` says where in the book to open. It is a query rather
// than a path segment for the same reason `d=` is — it qualifies the screen instead of naming a
// different one — and it is **read once, when the book opens**. Turning a page does not write it
// back: a hash the app writes is a hash the browser announces back to it, and every turn would
// also be a history entry, so the back button would walk pages instead of leaving the book.
//
// [[Settings]] is in the path rather than in `d=` because it stopped being a panel: it says nothing
// about the screen the reader came from, which is the whole test for a floor (CONTEXT.md,
// [[Surfaces]]). Its tab is part of that path, so each tab has an address of its own.

// The three faces the reader's bar raises are named once, in the state machine that owns them
// (`lib/chrome.ts`). Spelling them again here would be a second list to keep in step, and the
// address and the machine have to agree on those three names exactly.
import { isPanel, type PanelKind } from "./chrome";

const BOOK_PREFIX = "#/book/";
const SETTINGS_PREFIX = "#/settings";
/** What a CFI opens with, and therefore how `?select=` tells one from a phrase. */
const CFI_PREFIX = "epubcfi(";

/** Which pane of [[Settings]] is showing. */
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
 * A passage to arrive with already selected, so the colour row is up and the next tap draws a
 * mark. Two spellings, told apart by their opening rather than by a tag: a CFI announces itself
 * with `epubcfi(`, and anything else is the words themselves.
 *
 * `?at=` needs its tags because two of its three spellings are bare numbers; here there is no
 * such ambiguity, and a tag would be one more thing to get right in an address people type.
 *
 * **A phrase is looked for in the section on screen only**, so it pairs with an `?at=` naming
 * the chapter. Searching the rest of the book would mean laying out chapters nobody is looking
 * at, and that is a different feature.
 */
export type Select = { kind: "cfi"; cfi: string } | { kind: "text"; text: string };

/**
 * A floor: the screen the reader is standing on, one at a time.
 *
 * `at` hangs off the book screen rather than off `Route` because it qualifies *this* screen —
 * there is no such thing as opening the shelf at a passage, and saying so in the type is what
 * keeps `?at=` off every other address.
 *
 * `select` and `handles` hang there for the same reason, and `handles` hangs off `select`'s
 * presence in `parseHash`: on its own it answers a question nobody asked.
 */
export type Screen =
  | { kind: "shelf" }
  | {
      kind: "book";
      bookId: string;
      at?: At;
      select?: Select;
      /**
       * Draw the selection ourselves, with the two handles a finger can drag (ADR-0036),
       * instead of letting the browser select natively.
       *
       * **Absent means native, at every window size** — including phone-sized ones, where a
       * reader's own finger would get the drawn route. The two defaults fail differently: this
       * one puts a selection on screen that is missing the handles, which is visible; the other
       * puts nothing on screen at all and says nothing about why, on a window where `?select=`
       * looks like it should have worked.
       */
      handles?: boolean;
    }
  | { kind: "settings"; tab: SettingsTab };

/**
 * A panel: the sort of surface that stacks on the current screen rather than replacing it.
 *
 * All four of them are here, and that is the point of this type. Three of them used to be a
 * piece of `lib/chrome.ts` and nothing else, so a refresh lost them and Android's back button
 * closed the app instead of the panel that was covering it — while the fourth, opened from the
 * same bar, answered the back button correctly. One slot, one answer (ADR-0046).
 *
 * **One at a time**, because `?d=` holds one value. Raising [[About]] over a standing [[Contents]]
 * therefore closes it, rather than the two sharing a screen the address cannot describe.
 *
 * `noteId` is the one second storey: the reader walks into a note in two steps — open [[Notes]],
 * press one — so they walk out in two as well. The other three have nothing inside them to open.
 *
 * Every one carries its own book id even when the screen underneath is that same book
 * (`#/book/abc?d=about/abc`). Those few redundant characters buy the rule that reading the hash
 * never means looking at what is below it.
 */
export type Panel =
  | { kind: "toc"; bookId: string }
  | { kind: "notes"; bookId: string; noteId?: string }
  | { kind: "layout"; bookId: string }
  | { kind: "about"; bookId: string };

/**
 * How deep in the reader's own stack a route stands: the screen alone, a panel over it, or a
 * note open inside that panel.
 *
 * **The whole of what decides how the address is written** — deeper pushes an entry, level
 * replaces one, shallower goes back — so that eleven chrome events do not become eleven history
 * rules. `App.tsx` is the one caller.
 */
export function panelDepth(panel: Panel | null): 0 | 1 | 2 {
  if (panel === null) return 0;
  return panel.kind === "notes" && panel.noteId !== undefined ? 2 : 1;
}

/**
 * Whether two panels are the same panel, by value.
 *
 * **The guard on the mirror.** The chrome is the truth and the address is its reflection
 * (ADR-0046), so each side writes to the other when they disagree — and a comparison by identity
 * would call every parse of the same hash a disagreement, which is a loop rather than a mirror.
 */
export function samePanel(a: Panel | null, b: Panel | null): boolean {
  if (a === null || b === null) return a === b;
  const noteOf = (panel: Panel) => (panel.kind === "notes" ? panel.noteId : undefined);
  return a.kind === b.kind && a.bookId === b.bookId && noteOf(a) === noteOf(b);
}

export interface Route {
  screen: Screen;
  panel: Panel | null;
}

export function parseHash(hash: string): Route {
  const cut = hash.indexOf("?");
  const path = cut === -1 ? hash : hash.slice(0, cut);
  const query = cut === -1 ? "" : hash.slice(cut + 1);
  const params = new URLSearchParams(query);
  return { screen: screenFrom(path, params), panel: panelFrom(query) };
}

export function hashFor(route: Route): string {
  const path = pathFor(route.screen);
  const query: string[] = [];
  if (route.panel) query.push(`d=${panelSegment(route.panel)}`);
  const book = route.screen.kind === "book" ? route.screen : undefined;
  if (book?.at) query.push(`at=${encodeURIComponent(atSegment(book.at))}`);
  // `handles` only where there is something to select, matching what `parseHash` reads back:
  // writing it alone would put a parameter in the bar that reading the bar throws away.
  if (book?.select) {
    query.push(`select=${encodeURIComponent(selectSegment(book.select))}`);
    if (book.handles) query.push("handles=1");
  }
  return query.length === 0 ? path : `${path}?${query.join("&")}`;
}

/**
 * The same book screen, now naming a place the reader has moved to.
 *
 * **`select` and `handles` come off here, and that is the point of writing the address back.**
 * They were carried out the moment the book opened and there is no second time; left in, they
 * would ride along on every address the reader copies from then on, and whoever they sent it to
 * would open the book with a passage selected that nobody chose. What is being copied is where
 * the reader is, which is what `at` says.
 *
 * A non-book screen comes back untouched: there is nowhere inside the shelf to be.
 */
export function movedTo(screen: Screen, at: At): Screen {
  if (screen.kind !== "book") return screen;
  const { select: _select, handles: _handles, ...book } = screen;
  return { ...book, at };
}

/** The book the reader has open, or null on any other floor. */
export function openBookId(route: Route): string | null {
  return route.screen.kind === "book" ? route.screen.bookId : null;
}

function screenFrom(path: string, params: URLSearchParams): Screen {
  if (path.startsWith(BOOK_PREFIX)) {
    const id = decode(path.slice(BOOK_PREFIX.length));
    if (id) {
      const at = atFrom(params.get("at"));
      const select = selectFrom(params.get("select"));
      const handles = select !== undefined && params.get("handles") === "1";
      return {
        kind: "book",
        bookId: id,
        ...(at ? { at } : {}),
        ...(select ? { select } : {}),
        ...(handles ? { handles } : {}),
      };
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

// Anything unrecognised means "no panel" rather than an error: the reader still gets the screen
// they can see. `d=settings` and `d=account` land here now that both became floors.
//
// ⚠️ **The raw query, not `URLSearchParams`**, and that is the price of a third segment. `d=`
// now holds up to three fields separated by `/`, and `URLSearchParams` hands its value back
// already percent-decoded — so a `%2F` inside an id would arrive indistinguishable from the
// separator, and `d=notes/a%2Fb` would read as a note called `b`. Cutting the field out of the
// query and decoding each segment on its own is what keeps the separator the app writes apart
// from the ones inside the ids it writes between.
function panelFrom(query: string): Panel | null {
  const field = query.split("&").find((pair) => pair.startsWith("d="));
  if (field === undefined) return null;
  const parts = field.slice(2).split("/").map(decode);
  const [kind, bookId, noteId] = parts;
  if (bookId === undefined || bookId === "") return null;

  if (kind === "notes") {
    // A third segment naming a note the book no longer has is not caught here — whether it
    // exists is a question for the database, and `Reader.tsx` answers it by dropping back to
    // the list. A fourth segment is nothing this app ever wrote.
    if (parts.length > 3 || noteId === "") return null;
    return { kind, bookId, ...(noteId === undefined ? {} : { noteId }) };
  }
  if (parts.length > 2) return null;
  if (kind === "about") return { kind, bookId };
  if (kind !== undefined && isPanel(kind)) return { kind, bookId };
  return null;
}

function panelSegment(panel: Panel): string {
  const note = panel.kind === "notes" && panel.noteId ? `/${encodeURIComponent(panel.noteId)}` : "";
  return `${panel.kind}/${encodeURIComponent(panel.bookId)}${note}`;
}

/**
 * The same panel, if it is one of the three the reader's own bar raises.
 *
 * `null` for [[About]] as well as for no panel at all, and both callers want exactly that: the
 * reader's chrome is the three, and [[About]] standing means the chrome has none of them up.
 */
export function barPanel(panel: Panel | null): (Panel & { kind: PanelKind }) | null {
  return panel !== null && isPanel(panel.kind) ? (panel as Panel & { kind: PanelKind }) : null;
}

/**
 * One percent-decoded field of the address, or `""` for one that cannot be decoded at all.
 *
 * ⚠️ **`decodeURIComponent` throws on a half-written escape** — `#/book/100%` is enough — and an
 * address is whatever somebody typed or a link somewhere truncated. Thrown, it comes out of
 * `parseHash`, which runs inside the opening `useState` and inside the `hashchange` listener:
 * a blank app rather than a lost book. Empty is what every caller here already treats as "not
 * given", so the reader lands on the shelf or on the book with no panel, which is this file's
 * answer to every other unreadable address.
 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

// Unreadable means "no address", on the same grounds as an unknown panel: the reader still gets
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

// An empty `?select=` is "nothing to select" rather than "select nothing", on the same grounds
// as an unreadable `?at=`: the book still opens.
function selectFrom(value: string | null): Select | undefined {
  if (value === null || value === "") return undefined;
  return value.startsWith(CFI_PREFIX) ? { kind: "cfi", cfi: value } : { kind: "text", text: value };
}

function wholeNumber(value: string | undefined): number | undefined {
  // `Number` alone would take `1e3`, ` 4` and `2.5`; a section index and a character count are
  // neither negative nor fractional, and a hash that says otherwise is not one this app wrote.
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function selectSegment(select: Select): string {
  return select.kind === "cfi" ? select.cfi : select.text;
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
