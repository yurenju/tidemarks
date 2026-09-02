import { describe, expect, it } from "vitest";
import { booksToFreeze } from "./quota";

const book = (id: string, addedAt: number, deletedAt: number | null = null) => ({
  id,
  added_at: addedAt,
  deleted_at: deletedAt,
});
const read = (bookId: string, lastReadAt: number) => ({
  book_id: bookId,
  last_read_at: lastReadAt,
});

describe("booksToFreeze", () => {
  it("keeps the most recently read books and freezes the rest", () => {
    const books = [book("a", 1), book("b", 1), book("c", 1), book("d", 1)];
    const progress = [read("a", 40), read("b", 10), read("c", 30), read("d", 20)];
    expect(booksToFreeze(books, progress, 3)).toEqual(["b"]);
    expect(booksToFreeze(books, progress, 1)).toEqual(["c", "d", "b"]);
  });

  it("treats a never-opened book as read when it was added", () => {
    // Added after the others were last read, so it is the freshest and stays.
    const books = [book("a", 1), book("b", 1), book("new", 50)];
    const progress = [read("a", 40), read("b", 10)];
    expect(booksToFreeze(books, progress, 2)).toEqual(["b"]);
    // Added before anyone read the others, so it is the first to go.
    expect(booksToFreeze([book("a", 1), book("b", 1), book("old", 5)], progress, 2)).toEqual([
      "old",
    ]);
  });

  it("does not count a deleted book as taking a slot, and never freezes it", () => {
    const books = [book("gone", 1, 99), book("a", 1), book("b", 1), book("c", 1), book("d", 1)];
    const progress = [
      read("gone", 100),
      read("a", 40),
      read("b", 10),
      read("c", 30),
      read("d", 20),
    ];
    expect(booksToFreeze(books, progress, 3)).toEqual(["b"]);
  });

  it("freezes nothing when there is no limit or the shelf fits", () => {
    const books = [book("a", 1), book("b", 2)];
    expect(booksToFreeze(books, [], null)).toEqual([]);
    expect(booksToFreeze(books, [], 2)).toEqual([]);
  });
});
