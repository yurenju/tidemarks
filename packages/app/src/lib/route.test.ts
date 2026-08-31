// The address bar as a data structure: which screen and which panel a hash names, what happens
// to one nobody writes any more, and that every route can be written and read back unchanged.
// The app really moving when the hash does is packages/app/tests/browser/library/panels.spec.ts.
import { describe, expect, it } from "vitest";
import {
  barPanel,
  hashFor,
  movedTo,
  panelDepth,
  parseHash,
  samePanel,
  type Route,
  type Screen,
} from "./route";

const shelf = { kind: "shelf" } as const;

describe("parseHash", () => {
  it("reads the shelf", () => {
    expect(parseHash("")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#/")).toEqual({ screen: shelf, panel: null });
  });

  it("reads a book", () => {
    expect(parseHash("#/book/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
    expect(parseHash("#/book/a%2Fb")).toEqual({
      screen: { kind: "book", bookId: "a/b" },
      panel: null,
    });
    expect(parseHash("#/book/")).toEqual({ screen: shelf, panel: null });
  });

  it("reads each settings tab", () => {
    expect(parseHash("#/settings/typography")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      panel: null,
    });
    expect(parseHash("#/settings/account")).toEqual({
      screen: { kind: "settings", tab: "account" },
      panel: null,
    });
  });

  // Settings is a floor rather than a panel now, so a bare `#/settings` names a real screen.
  // It opens on the tab a reader almost always came for, instead of being dropped for the shelf.
  it("lands a tabless settings hash on Type", () => {
    expect(parseHash("#/settings")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      panel: null,
    });
    expect(parseHash("#/settings/")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      panel: null,
    });
    expect(parseHash("#/settings/nope")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      panel: null,
    });
  });

  // Every panel carries a full book id, even when the screen underneath is that same book, so
  // reading the hash never means looking at what is below it.
  it("reads the details panel's own book id", () => {
    expect(parseHash("#/?d=about/abc")).toEqual({
      screen: shelf,
      panel: { kind: "about", bookId: "abc" },
    });
    expect(parseHash("#/book/abc?d=about/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: { kind: "about", bookId: "abc" },
    });
  });

  // All four faces are in `?d=` now, not just [[About]] (ADR-0046): a refresh comes back to the
  // panel that was up, and Android's back button closes it rather than the app.
  it("reads each of the three the reader's own bar raises", () => {
    expect(parseHash("#/book/abc?d=toc/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: { kind: "toc", bookId: "abc" },
    });
    expect(parseHash("#/book/abc?d=notes/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: { kind: "notes", bookId: "abc" },
    });
    expect(parseHash("#/book/abc?d=layout/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: { kind: "layout", bookId: "abc" },
    });
  });

  // The one second storey: the reader walked in in two steps, so the address has two of them.
  it("reads the note open inside the notes panel", () => {
    expect(parseHash("#/book/abc?d=notes/abc/n1")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: { kind: "notes", bookId: "abc", noteId: "n1" },
    });
  });

  // Whether the note still exists is the database's question, not this one's — but a segment
  // this app never wrote is unreadable here, like every other malformed address.
  it("drops a third segment the other three panels cannot have", () => {
    expect(parseHash("#/book/abc?d=toc/abc/n1")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
    expect(parseHash("#/book/abc?d=notes/abc/n1/extra")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
    expect(parseHash("#/book/abc?d=notes/abc/")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
  });

  // ⚠️ The separator the app writes has to stay apart from the ones inside the ids it writes
  // between, which is the whole reason this field is cut out of the raw query rather than read
  // through `URLSearchParams`.
  it("tells an encoded slash inside an id from the separator", () => {
    expect(parseHash("#/?d=notes/a%2Fb")).toEqual({
      screen: shelf,
      panel: { kind: "notes", bookId: "a/b" },
    });
    expect(parseHash("#/?d=notes/a%2Fb/n%2F1")).toEqual({
      screen: shelf,
      panel: { kind: "notes", bookId: "a/b", noteId: "n/1" },
    });
  });

  it("decodes ids on both sides", () => {
    expect(parseHash("#/book/a%2Fb?d=about/c%20d")).toEqual({
      screen: { kind: "book", bookId: "a/b" },
      panel: { kind: "about", bookId: "c d" },
    });
  });

  // A hash is whatever the address bar happens to hold, so an unknown panel is the screen with
  // no panel rather than a crash or a blank overlay.
  it("drops a panel it does not know", () => {
    expect(parseHash("#/?d=nope")).toEqual({ screen: shelf, panel: null });
    // A half-written escape, which is what a hand-typed address gets wrong. It has to read as
    // "no panel" like every other unreadable shape, not throw out of the `hashchange` handler.
    expect(parseHash("#/?d=toc/100%")).toEqual({ screen: shelf, panel: null });
    // ⚠️ **The path is the same hazard one field over**, and throwing there is worse: it comes
    // out of the opening `useState` and the reader gets a blank app rather than a lost panel.
    expect(parseHash("#/book/100%")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#/?d=about/")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#/?d=")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#/book/abc?d=nope")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
  });

  // The three spellings of "open the book here". Each one is what a different caller happens to
  // know: a passage, a chapter, a way through the whole book.
  it("reads each way of naming a place in a book", () => {
    expect(parseHash("#/book/abc?at=cfi:epubcfi(/6/4!/4/2)")).toEqual({
      screen: { kind: "book", bookId: "abc", at: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2)" } },
      panel: null,
    });
    expect(parseHash("#/book/abc?at=chars:12/300")).toEqual({
      screen: {
        kind: "book",
        bookId: "abc",
        at: { kind: "chars", sectionIndex: 12, characters: 300 },
      },
      panel: null,
    });
    expect(parseHash("#/book/abc?at=frac:0.5")).toEqual({
      screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.5 } },
      panel: null,
    });
  });

  // A chapter with no offset is the short form, because a table of contents can say that much
  // and nothing more.
  it("reads a chapter on its own as its first character", () => {
    expect(parseHash("#/book/abc?at=chars:12")).toEqual({
      screen: {
        kind: "book",
        bookId: "abc",
        at: { kind: "chars", sectionIndex: 12, characters: 0 },
      },
      panel: null,
    });
  });

  // Hand-written addresses are the point of this parameter, so a typo costs the jump and not the
  // screen: the book still opens, at wherever the reader left it.
  it("opens the book anyway when the address is unreadable", () => {
    for (const hash of [
      "#/book/abc?at=",
      "#/book/abc?at=page:3",
      "#/book/abc?at=cfi:",
      "#/book/abc?at=chars:-1",
      "#/book/abc?at=chars:2.5",
      "#/book/abc?at=chars:12/300/900",
      "#/book/abc?at=frac:2",
      "#/book/abc?at=frac:half",
    ]) {
      expect(parseHash(hash)).toEqual({ screen: { kind: "book", bookId: "abc" }, panel: null });
    }
  });

  // Nothing but a book has a place inside it to open at, so the parameter is read nowhere else.
  it("ignores an address on any other screen", () => {
    expect(parseHash("#/?at=frac:0.5")).toEqual({ screen: shelf, panel: null });
  });

  // `?select=` takes either spelling with no tag in front, because unlike `?at=`'s three there
  // is nothing here to confuse: a CFI announces itself.
  it("tells a passage to select from a phrase to select by its opening", () => {
    expect(parseHash("#/book/abc?select=epubcfi(/6/4!/4/2,/1:0,/1:5)")).toEqual({
      screen: {
        kind: "book",
        bookId: "abc",
        select: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)" },
      },
      panel: null,
    });
    expect(parseHash("#/book/abc?select=%E5%B1%B1%E8%B7%AF%E3%82%92")).toEqual({
      screen: { kind: "book", bookId: "abc", select: { kind: "text", text: "山路を" } },
      panel: null,
    });
  });

  // Nothing to select is not an error, on the same grounds as an unreadable `?at=`: the book
  // still opens.
  it("opens the book anyway when there is nothing to select", () => {
    expect(parseHash("#/book/abc?select=")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
  });

  // Which of the two selection routes to put it on. Absent means the browser's own, whatever
  // size the window is — see the note on `handles` in route.ts.
  it("reads the handles the take-over route draws", () => {
    expect(parseHash("#/book/abc?select=%E5%B1%B1&handles=1")).toEqual({
      screen: {
        kind: "book",
        bookId: "abc",
        select: { kind: "text", text: "山" },
        handles: true,
      },
      panel: null,
    });
    expect(parseHash("#/book/abc?select=%E5%B1%B1&handles=0")).toEqual({
      screen: { kind: "book", bookId: "abc", select: { kind: "text", text: "山" } },
      panel: null,
    });
  });

  // On its own it says which selection to draw for a selection nobody asked for, so it is read
  // as nothing rather than carried around waiting for one.
  it("ignores handles with nothing to select", () => {
    expect(parseHash("#/book/abc?handles=1")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      panel: null,
    });
  });

  // `d=settings` and `d=account` were panels until settings became a floor. They are read as
  // "no panel" rather than redirected: a stale bookmark lands on the screen it named, which
  // for `#/?d=settings` is the shelf the reader was standing on.
  it("no longer knows the panels that became a floor", () => {
    expect(parseHash("#/?d=settings")).toEqual({ screen: shelf, panel: null });
    expect(parseHash("#/?d=account")).toEqual({ screen: shelf, panel: null });
  });
});

describe("movedTo", () => {
  // The regression this guards is invisible on the machine that causes it and permanent once the
  // address has been sent: a reader who opened a book with `?select=` and then jumped to a note
  // would go on copying that selection out to everyone, on every address, for the rest of the
  // session.
  it("stops carrying the passage to select once the reader has moved", () => {
    const opened: Screen = {
      kind: "book",
      bookId: "abc",
      at: { kind: "chars", sectionIndex: 12, characters: 0 },
      select: { kind: "text", text: "山路を登りながら" },
      handles: true,
    };

    const moved = movedTo(opened, { kind: "cfi", cfi: "epubcfi(/6/4!/4/2)" });

    expect(moved).toEqual({
      kind: "book",
      bookId: "abc",
      at: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2)" },
    });
    expect(hashFor({ screen: moved, panel: null })).not.toContain("select=");
  });

  // Nowhere inside a shelf to be, so there is nothing to say about it.
  it("leaves a screen that is not a book alone", () => {
    expect(movedTo(shelf, { kind: "fraction", fraction: 0.5 })).toEqual(shelf);
  });
});

describe("hashFor", () => {
  it("writes every shape parseHash reads", () => {
    const routes: Route[] = [
      { screen: shelf, panel: null },
      { screen: { kind: "book", bookId: "abc" }, panel: null },
      { screen: { kind: "settings", tab: "typography" }, panel: null },
      { screen: { kind: "settings", tab: "account" }, panel: null },
      { screen: { kind: "book", bookId: "a/b c" }, panel: null },
      { screen: shelf, panel: { kind: "about", bookId: "a/b c" } },
      { screen: { kind: "book", bookId: "abc" }, panel: { kind: "about", bookId: "abc" } },
      // A literal percent is the case a second round of decoding gets wrong.
      { screen: shelf, panel: { kind: "about", bookId: "100%20" } },
      // A CFI is full of the characters a query string reserves — `/`, `:`, `,` — which is what
      // makes a round trip worth asserting rather than assuming.
      {
        screen: {
          kind: "book",
          bookId: "abc",
          at: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2/2,/1:0,/1:5)" },
        },
        panel: null,
      },
      {
        screen: {
          kind: "book",
          bookId: "abc",
          at: { kind: "chars", sectionIndex: 12, characters: 0 },
        },
        panel: null,
      },
      {
        screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.5 } },
        panel: null,
      },
      // A panel over a book that was opened at a passage: both halves of the query at once.
      {
        screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.25 } },
        panel: { kind: "about", bookId: "abc" },
      },
      { screen: { kind: "book", bookId: "abc" }, panel: { kind: "toc", bookId: "abc" } },
      { screen: { kind: "book", bookId: "abc" }, panel: { kind: "layout", bookId: "abc" } },
      { screen: { kind: "book", bookId: "abc" }, panel: { kind: "notes", bookId: "abc" } },
      {
        screen: { kind: "book", bookId: "abc" },
        panel: { kind: "notes", bookId: "abc", noteId: "n1" },
      },
      // Both ids holding the separator, which is the pair a shared `URLSearchParams` decode
      // cannot tell apart.
      {
        screen: shelf,
        panel: { kind: "notes", bookId: "a/b c", noteId: "n/1" },
      },
      {
        screen: {
          kind: "book",
          bookId: "abc",
          select: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2/2,/1:0,/1:5)" },
        },
        panel: null,
      },
      // A phrase full of what a query string reserves, and one that could be mistaken for the
      // other spelling if the test only ever used ASCII.
      {
        screen: { kind: "book", bookId: "abc", select: { kind: "text", text: "a=b&c d/e" } },
        panel: null,
      },
      {
        screen: {
          kind: "book",
          bookId: "abc",
          at: { kind: "chars", sectionIndex: 12, characters: 0 },
          select: { kind: "text", text: "山路を登りながら" },
          handles: true,
        },
        panel: null,
      },
    ];
    for (const route of routes) {
      expect(parseHash(hashFor(route))).toEqual(route);
    }
  });

  // Reading the bar throws `handles` away without a `select`, so writing one there would put a
  // parameter in the address that says nothing and comes back as nothing.
  it("does not write handles with nothing to select", () => {
    expect(hashFor({ screen: { kind: "book", bookId: "abc", handles: true }, panel: null })).toBe(
      "#/book/abc",
    );
  });

  it("writes the tab into the path", () => {
    expect(hashFor({ screen: { kind: "settings", tab: "account" }, panel: null })).toBe(
      "#/settings/account",
    );
  });
});

/**
 * The storey count, which is the whole of how `App.tsx` decides what to do to the history stack:
 * deeper pushes an entry, level replaces one, shallower goes back. Everything the reader can do
 * to a panel — eleven chrome events, eight of which can put one away — comes down to these three
 * numbers, so that there is one history rule rather than eight (ADR-0046).
 */
describe("panelDepth", () => {
  it("counts the screen, a panel over it, and a note inside that panel", () => {
    expect(panelDepth(null)).toBe(0);
    expect(panelDepth({ kind: "toc", bookId: "abc" })).toBe(1);
    expect(panelDepth({ kind: "about", bookId: "abc" })).toBe(1);
    expect(panelDepth({ kind: "notes", bookId: "abc" })).toBe(1);
    expect(panelDepth({ kind: "notes", bookId: "abc", noteId: "n1" })).toBe(2);
  });

  // Swapping [[Contents]] for [[Notes]] is another face on the same storey, so the address is written
  // over rather than pushed — one press of back has to leave the book, not walk the panels the
  // reader tried on the way.
  it("puts every panel on the same storey as every other", () => {
    expect(panelDepth({ kind: "toc", bookId: "abc" })).toBe(
      panelDepth({ kind: "layout", bookId: "abc" }),
    );
  });
});

/**
 * The guard on the mirror. The chrome is the truth and the address reflects it, so each side
 * writes to the other on a disagreement — and comparing by identity would call every fresh parse
 * of the same hash a disagreement, which is a loop rather than a mirror.
 */
describe("samePanel", () => {
  it("compares by value, not by identity", () => {
    expect(samePanel({ kind: "toc", bookId: "a" }, { kind: "toc", bookId: "a" })).toBe(true);
    expect(samePanel(null, null)).toBe(true);
    expect(samePanel(null, { kind: "toc", bookId: "a" })).toBe(false);
    expect(samePanel({ kind: "toc", bookId: "a" }, { kind: "notes", bookId: "a" })).toBe(false);
    expect(samePanel({ kind: "toc", bookId: "a" }, { kind: "toc", bookId: "b" })).toBe(false);
  });

  // The storey the reader is on is part of which panel this is: miss it and stepping into a note
  // never reaches the address, so back walks out of the book instead of out of the note.
  it("tells a note open from the list it came from", () => {
    expect(
      samePanel({ kind: "notes", bookId: "a" }, { kind: "notes", bookId: "a", noteId: "n1" }),
    ).toBe(false);
    expect(
      samePanel(
        { kind: "notes", bookId: "a", noteId: "n1" },
        { kind: "notes", bookId: "a", noteId: "n1" },
      ),
    ).toBe(true);
  });
});

/**
 * [[About]] reads as "no panel" to the reader's chrome, and that is not a special case: `?d=` holds
 * one value, so [[About]] standing *is* the chrome having none of its three up.
 */
describe("barPanel", () => {
  it("keeps the three the reader's bar raises and drops the fourth", () => {
    expect(barPanel({ kind: "toc", bookId: "a" })).toEqual({ kind: "toc", bookId: "a" });
    expect(barPanel({ kind: "about", bookId: "a" })).toBe(null);
    expect(barPanel(null)).toBe(null);
  });
});
