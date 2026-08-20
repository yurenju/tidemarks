import { db } from "./db";
import type { Progress } from "./types";

/**
 * Where the reader was left, written somewhere a reload can reach it **immediately**.
 *
 * ## Why IndexedDB alone was not enough
 *
 * A page turn writes the new position with `db.progress.put()`, and nobody waits for it —
 * nor can they: `relocate` fires in the middle of a turn, and awaiting a transaction there
 * would put an IndexedDB round trip inside the animation.
 *
 * That was fine as long as the write commits before anything can ask for it back. It does
 * not always. Measured in the test image with eight WebKit contexts competing for two cores,
 * the commit latency of that one `put` was p50 59ms, p90 362ms, **max 1207ms** — and in one
 * run 128 turns produced only 127 commits, the last write dying with the page. A reader who
 * turns a page and reloads inside that window gets back the page they were on *before* the
 * turn; at the tail of the distribution, two turns before.
 *
 * That is what issue #173 caught. It reached CI as a flaky WebKit failure rather than a bug
 * report because WebKit is the only engine whose tests run in a persistent context, with a
 * real profile on disk (`tests/browser/support/fixtures.ts`) — the other two keep IndexedDB
 * in memory, where the write always wins the race. **The exposure is real Safari's, not the
 * suite's**: a reader on a device has a profile too.
 *
 * ## The fix, and why it is `localStorage`
 *
 * `localStorage.setItem` is synchronous and committed before the task that turned the page
 * ends, so nothing that happens afterwards — a reload, a closed tab, a discarded process —
 * can arrive before it. IndexedDB stays the record of truth (it holds every book, it is what
 * sync reads and writes, and it is not capped at a few megabytes); this is a write-ahead note
 * in front of it, consulted only when it is the later of the two.
 *
 * This is the local half of the argument `sync.ts`'s `beaconPositions` already makes for the
 * server half: on the way out there is no time for an `await`, so the position has to be
 * somewhere that needs none.
 */
export interface PositionStores {
  /** Committed synchronously, before the task that turned the page can end. */
  readonly durable: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** The record of truth, which commits whenever IndexedDB gets round to it. */
  readonly settled: {
    get(bookId: string): Promise<Progress | undefined>;
    put(position: Progress): Promise<unknown>;
  };
}

/**
 * One key per book rather than one list.
 *
 * A list would have to be read, parsed and rewritten on every page turn, which is the one
 * moment this exists to keep cheap — and two tabs reading two books would take turns
 * clobbering each other's entry.
 */
const keyFor = (bookId: string): string => `tidemarks.position.${bookId}`;

const browserStores = (): PositionStores => ({
  durable: window.localStorage,
  settled: {
    get: (bookId) => db.progress.get(bookId),
    put: (position) => db.progress.put(position),
  },
});

/**
 * Records where the reader is. Called on every `relocate`.
 *
 * Returns nothing, and is not `async`: the durable half is already done by the time it
 * returns, and the caller has nothing useful to do with the settled half's promise.
 */
export function rememberPosition(
  position: Progress,
  stores: PositionStores = browserStores(),
): void {
  try {
    stores.durable.setItem(keyFor(position.bookId), JSON.stringify(position));
  } catch {
    // Safari in private browsing refuses `setItem`, and a full quota does the same
    // everywhere. Either way the write below is still the record of truth, and a page turn
    // is not the place to tell the reader about storage.
  }
  void stores.settled.put(position);
}

/**
 * Where to open this book, taking whichever copy is the later one.
 *
 * **By `lastReadAt` rather than by preferring one store.** The durable note is usually the
 * fresher of the two, but not always: a position that arrived from another device through
 * sync is written straight into IndexedDB, and this device's note may be days older.
 */
export async function recallPosition(
  bookId: string,
  stores: PositionStores = browserStores(),
): Promise<Progress | undefined> {
  const settled = await stores.settled.get(bookId);
  const noted = readNote(bookId, stores);

  if (noted === undefined) return settled;
  if (settled === undefined) return noted;
  return noted.lastReadAt > settled.lastReadAt ? noted : settled;
}

function readNote(bookId: string, stores: PositionStores): Progress | undefined {
  let raw: string | null;
  try {
    raw = stores.durable.getItem(keyFor(bookId));
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything can be in there — another tab's older format, a half-written value. The two
    // fields this has to have are the one it is read for and the one it is chosen by.
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const note = parsed as Partial<Progress>;
    if (typeof note.cfi !== "string" || typeof note.lastReadAt !== "number") return undefined;
    return note as Progress;
  } catch {
    return undefined;
  }
}
