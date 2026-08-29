// The address bar as a data structure: which screen and which drawer a hash names, what happens
// to one nobody writes any more, and that every route can be written and read back unchanged.
// The app really moving when the hash does is packages/app/tests/browser/library/drawers.spec.ts.
import { describe, expect, it } from "vitest";
import { hashFor, parseHash, type Route } from "./route";

const shelf = { kind: "shelf" } as const;

describe("parseHash", () => {
  it("reads the shelf", () => {
    expect(parseHash("")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#/")).toEqual({ screen: shelf, drawer: null });
  });

  it("reads a book", () => {
    expect(parseHash("#/book/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      drawer: null,
    });
    expect(parseHash("#/book/a%2Fb")).toEqual({
      screen: { kind: "book", bookId: "a/b" },
      drawer: null,
    });
    expect(parseHash("#/book/")).toEqual({ screen: shelf, drawer: null });
  });

  it("reads each settings tab", () => {
    expect(parseHash("#/settings/typography")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      drawer: null,
    });
    expect(parseHash("#/settings/account")).toEqual({
      screen: { kind: "settings", tab: "account" },
      drawer: null,
    });
  });

  // Settings is a floor rather than a drawer now, so a bare `#/settings` names a real screen.
  // It opens on the tab a reader almost always came for, instead of being dropped for the shelf.
  it("lands a tabless settings hash on 排版", () => {
    expect(parseHash("#/settings")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      drawer: null,
    });
    expect(parseHash("#/settings/")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      drawer: null,
    });
    expect(parseHash("#/settings/nope")).toEqual({
      screen: { kind: "settings", tab: "typography" },
      drawer: null,
    });
  });

  // The details drawer always carries a full book id, even when the screen underneath is that
  // same book, so reading the hash never means looking at what is below it.
  it("reads the details drawer's own book id", () => {
    expect(parseHash("#/?d=about/abc")).toEqual({
      screen: shelf,
      drawer: { kind: "about", bookId: "abc" },
    });
    expect(parseHash("#/book/abc?d=about/abc")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      drawer: { kind: "about", bookId: "abc" },
    });
  });

  it("decodes ids on both sides", () => {
    expect(parseHash("#/book/a%2Fb?d=about/c%20d")).toEqual({
      screen: { kind: "book", bookId: "a/b" },
      drawer: { kind: "about", bookId: "c d" },
    });
  });

  // A hash is whatever the address bar happens to hold, so an unknown drawer is the screen with
  // no drawer rather than a crash or a blank overlay.
  it("drops a drawer it does not know", () => {
    expect(parseHash("#/?d=nope")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#/?d=about/")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#/?d=")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#/book/abc?d=nope")).toEqual({
      screen: { kind: "book", bookId: "abc" },
      drawer: null,
    });
  });

  // The three spellings of "open the book here". Each one is what a different caller happens to
  // know: a passage, a chapter, a way through the whole book.
  it("reads each way of naming a place in a book", () => {
    expect(parseHash("#/book/abc?at=cfi:epubcfi(/6/4!/4/2)")).toEqual({
      screen: { kind: "book", bookId: "abc", at: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2)" } },
      drawer: null,
    });
    expect(parseHash("#/book/abc?at=chars:12/300")).toEqual({
      screen: {
        kind: "book",
        bookId: "abc",
        at: { kind: "chars", sectionIndex: 12, characters: 300 },
      },
      drawer: null,
    });
    expect(parseHash("#/book/abc?at=frac:0.5")).toEqual({
      screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.5 } },
      drawer: null,
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
      drawer: null,
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
      "#/book/abc?at=frac:2",
      "#/book/abc?at=frac:half",
    ]) {
      expect(parseHash(hash)).toEqual({ screen: { kind: "book", bookId: "abc" }, drawer: null });
    }
  });

  // Nothing but a book has a place inside it to open at, so the parameter is read nowhere else.
  it("ignores an address on any other screen", () => {
    expect(parseHash("#/?at=frac:0.5")).toEqual({ screen: shelf, drawer: null });
  });

  // `d=settings` and `d=account` were drawers until settings became a floor. They are read as
  // "no drawer" rather than redirected: a stale bookmark lands on the screen it named, which
  // for `#/?d=settings` is the shelf the reader was standing on.
  it("no longer knows the drawers that became a floor", () => {
    expect(parseHash("#/?d=settings")).toEqual({ screen: shelf, drawer: null });
    expect(parseHash("#/?d=account")).toEqual({ screen: shelf, drawer: null });
  });
});

describe("hashFor", () => {
  it("writes every shape parseHash reads", () => {
    const routes: Route[] = [
      { screen: shelf, drawer: null },
      { screen: { kind: "book", bookId: "abc" }, drawer: null },
      { screen: { kind: "settings", tab: "typography" }, drawer: null },
      { screen: { kind: "settings", tab: "account" }, drawer: null },
      { screen: { kind: "book", bookId: "a/b c" }, drawer: null },
      { screen: shelf, drawer: { kind: "about", bookId: "a/b c" } },
      { screen: { kind: "book", bookId: "abc" }, drawer: { kind: "about", bookId: "abc" } },
      // A literal percent is the case a second round of decoding gets wrong.
      { screen: shelf, drawer: { kind: "about", bookId: "100%20" } },
      // A CFI is full of the characters a query string reserves — `/`, `:`, `,` — which is what
      // makes a round trip worth asserting rather than assuming.
      {
        screen: {
          kind: "book",
          bookId: "abc",
          at: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2/2,/1:0,/1:5)" },
        },
        drawer: null,
      },
      {
        screen: {
          kind: "book",
          bookId: "abc",
          at: { kind: "chars", sectionIndex: 12, characters: 0 },
        },
        drawer: null,
      },
      {
        screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.5 } },
        drawer: null,
      },
      // A drawer over a book that was opened at a passage: both halves of the query at once.
      {
        screen: { kind: "book", bookId: "abc", at: { kind: "fraction", fraction: 0.25 } },
        drawer: { kind: "about", bookId: "abc" },
      },
    ];
    for (const route of routes) {
      expect(parseHash(hashFor(route))).toEqual(route);
    }
  });

  it("writes the tab into the path", () => {
    expect(hashFor({ screen: { kind: "settings", tab: "account" }, drawer: null })).toBe(
      "#/settings/account",
    );
  });
});
