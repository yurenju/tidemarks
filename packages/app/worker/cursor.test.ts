import { describe, expect, it } from "vitest";
import { cursorFor } from "./cursor";

const NOW = 5_000;

describe("cursorFor", () => {
  it("hands back the newest write it carried, across every table", () => {
    const carried = {
      books: [{ updated_at: 1200 }],
      progress: [{ updated_at: 900 }, { updated_at: 1400 }],
      annotations: [],
      sessions: [{ updated_at: 1100 }],
    };
    expect(cursorFor(carried, 800, NOW)).toBe(1400);
  });

  // The row that was written while this pull's query was already running. Moving the cursor past
  // it is what made a position from another device disappear for good.
  it("leaves the cursor where it was when it carried nothing", () => {
    expect(cursorFor({ books: [], progress: [], annotations: [], sessions: [] }, 1000, NOW)).toBe(
      1000,
    );
  });

  // Stamps come from whichever isolate served the push, and those clocks only agree to within
  // whatever NTP holds them to. Taking a future stamp as the cursor would skip every write from
  // an isolate running behind it; refusing to pass `now` costs one row carried twice instead.
  it("does not move past the current time when a row is stamped ahead of it", () => {
    const carried = { books: [{ updated_at: NOW + 3_000 }], progress: [], annotations: [] };
    expect(cursorFor(carried, 1000, NOW)).toBe(NOW);
  });

  // A cursor already past `now` is a device holding one of those future stamps from before the
  // ceiling existed. Handing back less would re-send rows it has, every pull, for as long as the
  // gap lasted.
  it("never moves backwards", () => {
    expect(cursorFor({ books: [] }, NOW + 3_000, NOW)).toBe(NOW + 3_000);
  });
});
