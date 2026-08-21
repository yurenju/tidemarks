import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHELF_ORDER,
  lastTouchedAt,
  loadShelfOrder,
  saveShelfOrder,
  sortShelf,
  type ShelfBook,
  type ShelfOrder,
} from "./shelf-order";
import { SHELF_ORDERS } from "./shelf-order-choices";

function stubStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const DAY = 86_400_000;
const JAN = Date.parse("2026-01-01T00:00:00Z");

function book(id: string, title: string, addedAt: number): ShelfBook {
  return { id, title, addedAt };
}

function read(entries: [string, number][]) {
  return new Map(entries.map(([id, lastReadAt]) => [id, { lastReadAt }]));
}

describe("lastTouchedAt", () => {
  it("falls back to the import time for a book that was never opened", () => {
    expect(lastTouchedAt(book("a", "A", JAN), new Map())).toBe(JAN);
  });

  it("uses the reading time once the book has been opened", () => {
    const map = read([["a", JAN + 10 * DAY]]);
    expect(lastTouchedAt(book("a", "A", JAN), map)).toBe(JAN + 10 * DAY);
  });

  it("keeps the later of the two when a stale reading time trails the import", () => {
    const map = read([["a", JAN - 10 * DAY]]);
    expect(lastTouchedAt(book("a", "A", JAN), map)).toBe(JAN);
  });
});

describe("sortShelf, by recency", () => {
  const titles = (books: ShelfBook[]) => books.map((b) => b.title);

  it("puts the most recently touched book first", () => {
    const books = [book("a", "A", JAN), book("b", "B", JAN + DAY), book("c", "C", JAN + 2 * DAY)];
    const progress = read([["a", JAN + 30 * DAY]]);
    expect(titles(sortShelf(books, progress, "recent", "zh-Hant"))).toEqual(["A", "C", "B"]);
  });

  // The whole reason the key is a max: a book imported a minute ago has no progress row at
  // all, and it still belongs at the front — ahead of one that was read months ago.
  it("puts a freshly imported book ahead of one read long ago", () => {
    const books = [book("old", "很久以前讀的", JAN), book("new", "剛剛匯入的", JAN + 200 * DAY)];
    const progress = read([["old", JAN + 30 * DAY]]);
    expect(titles(sortShelf(books, progress, "recent", "zh-Hant"))).toEqual([
      "剛剛匯入的",
      "很久以前讀的",
    ]);
  });

  // A batch import stamps several books within the same millisecond, and IndexedDB hands them
  // back in key order — which is UUID order, so without this the shelf would look shuffled.
  it("breaks a tie on the title rather than on whatever order it was handed", () => {
    const books = [book("c", "三體", JAN), book("a", "蛤蟆的油", JAN), book("b", "一九八四", JAN)];
    expect(titles(sortShelf(books, new Map(), "recent", "zh-Hant"))).toEqual([
      "一九八四",
      "三體",
      "蛤蟆的油",
    ]);
  });

  it("leaves the array it was given untouched", () => {
    const books = [book("a", "A", JAN), book("b", "B", JAN + DAY)];
    sortShelf(books, new Map(), "recent", "zh-Hant");
    expect(books.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("sortShelf, by title", () => {
  const sorted = (titles: string[], language: "zh-Hant" | "en" = "zh-Hant") =>
    sortShelf(
      titles.map((t, i) => book(String(i), t, JAN)),
      new Map(),
      "title",
      language,
    ).map((b) => b.title);

  // zh-Hant collates by stroke count, which is what a Traditional Chinese reader expects from
  // an index. Measured the same in chromium, firefox and webkit.
  it("collates Han titles by stroke count under zh-Hant", () => {
    expect(sorted(["蛤蟆的油", "一九八四", "三體"])).toEqual(["一九八四", "三體", "蛤蟆的油"]);
  });

  it("reads runs of digits as numbers, so 10 follows 2", () => {
    expect(sorted(["第 10 集", "第 2 集"])).toEqual(["第 2 集", "第 10 集"]);
  });

  // The collation follows the interface language rather than the browser's, so switching the
  // interface has to switch the shelf with it (#31).
  it("collates by the language it is given, not by one baked in", () => {
    // 金 is 8 strokes and 致 is 10, so stroke order and code point order disagree on this
    // pair (致 is U+81F4, 金 is U+91D1) — which is what makes it worth asserting.
    expect(sorted(["致富心態", "金庸"], "zh-Hant")).toEqual(["金庸", "致富心態"]);
    expect(sorted(["金庸", "致富心態"], "en")).toEqual(["致富心態", "金庸"]);
    expect(sorted(["Zebra", "apple"], "en")).toEqual(["apple", "Zebra"]);
  });
});

describe("the stored choice", () => {
  beforeEach(stubStorage);
  afterEach(() => {
    // @ts-expect-error putting the environment back the way it was found
    delete globalThis.localStorage;
  });

  it("starts on the default before anyone has chosen", () => {
    expect(loadShelfOrder()).toBe(DEFAULT_SHELF_ORDER);
  });

  it("reads back what was saved", () => {
    saveShelfOrder("title");
    expect(loadShelfOrder()).toBe("title");
  });

  it("falls back to the default for a value nobody could have chosen", () => {
    localStorage.setItem("tidemarks-shelf-order", "by-author");
    expect(loadShelfOrder()).toBe(DEFAULT_SHELF_ORDER);
  });

  it("survives storage being unavailable", () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    } as unknown as Storage;
    expect(() => saveShelfOrder("title")).not.toThrow();
    expect(loadShelfOrder()).toBe(DEFAULT_SHELF_ORDER);
  });
});

describe("the offered orders", () => {
  it("offers exactly the two the shelf implements, and every one carries a label", () => {
    expect(SHELF_ORDERS.map((o) => o.value)).toEqual<ShelfOrder[]>(["recent", "title"]);
    // A label is a message descriptor now, so "carries a label" means the catalog has
    // something to look it up by rather than that a string is non-empty.
    expect(SHELF_ORDERS.every((o) => typeof o.label.id === "string" && o.label.id !== "")).toBe(
      true,
    );
  });

  it("defaults to one of them", () => {
    expect(SHELF_ORDERS.map((o) => o.value)).toContain(DEFAULT_SHELF_ORDER);
  });
});
