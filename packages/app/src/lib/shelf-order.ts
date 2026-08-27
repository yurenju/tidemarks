/**
 * What order the shelf is in, and where that choice is kept.
 *
 * Two orders, and two is the whole list. Sorting by author was measured against 34 real epubs
 * and abandoned: `dc:creator` carries translators, EPUB packagers and three different
 * separators, so those 34 books fall into 32 groups. Sorting by series was abandoned for a
 * blunter reason — not one of them declares `calibre:series`. Progress and reading time are
 * not orders at all: they answer "how much of this have I read", which is looking back, and
 * the shelf is for picking what to open next.
 */

import type { Progress } from "./types";

export type ShelfOrder = "recent" | "title";

/** The little a book has to have for the shelf to order it. */
export interface ShelfBook {
  id: string;
  title: string;
  addedAt: number;
}

/** The one field of `Progress` the order reads — spelled out so tests can skip the rest. */
type ReadingTime = Pick<Progress, "lastReadAt">;

/** The two orders, as values. What the control calls them is `shelf-order-choices.ts`. */
export const SHELF_ORDER_VALUES: readonly ShelfOrder[] = ["recent", "title"];

export const DEFAULT_SHELF_ORDER: ShelfOrder = "recent";

const KEY = "tidemarks-shelf-order";

/**
 * When the reader last had anything to do with this book — read it, or imported it.
 *
 * The max of the two, not just the reading time, because a book that has never been opened
 * has no `progress` row to read a time from. Ordering on the reading time alone would drop
 * every new import below every book ever opened, so the shelf would answer "what was I
 * reading" and lose "what did I just add" — and the reader has to scroll for the book they
 * imported ten seconds ago.
 */
export function lastTouchedAt(book: ShelfBook, progress: ReadonlyMap<string, ReadingTime>): number {
  return Math.max(book.addedAt, progress.get(book.id)?.lastReadAt ?? 0);
}

/**
 * The shelf in the order the reader asked for. Returns a new array; the input is left alone.
 *
 * `language` is a BCP-47 tag and comes from **Tidemarks' interface language**, not the
 * browser's (`lib/locale.ts` says why). Titles collate through `Intl.Collator`, so what
 * "alphabetical" means is the language's business: a reader in 繁體中文 gets Han characters
 * ordered by stroke count, which is how a Traditional Chinese index reads; the same shelf in
 * English does not. `numeric` is on because without it 「第 10 集」 sorts
 * ahead of 「第 2 集」.
 *
 * Directions are fixed — recency descends, titles ascend — because the reverse of either is a
 * shelf nobody wants, and an asc/desc toggle would be a control that buys nothing.
 *
 * Books that tie on recency fall back to the title, so a batch import — several files in one
 * drop, all stamped within the same millisecond — lands in an order the reader can read rather
 * than in whatever order IndexedDB hands back its keys.
 */
export function sortShelf<T extends ShelfBook>(
  books: readonly T[],
  progress: ReadonlyMap<string, ReadingTime>,
  order: ShelfOrder,
  language: string,
): T[] {
  const collator = new Intl.Collator(language, { numeric: true });
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);

  if (order === "title") return [...books].sort(byTitle);
  return [...books].sort(
    (a, b) => lastTouchedAt(b, progress) - lastTouchedAt(a, progress) || byTitle(a, b),
  );
}

function isShelfOrder(value: unknown): value is ShelfOrder {
  return SHELF_ORDER_VALUES.includes(value as ShelfOrder);
}

/**
 * The choice stays on this device, in localStorage next to the typography settings.
 *
 * Not synced, and not for the reason typography is not (ADR-0026) — "how I look for a book" is
 * a habit that would travel with the reader if it were free. It is not free: it would mean a
 * D1 column, a sync round and a conflict rule, all for a switch with two positions.
 */
export function loadShelfOrder(): ShelfOrder {
  try {
    const stored = localStorage.getItem(KEY);
    return isShelfOrder(stored) ? stored : DEFAULT_SHELF_ORDER;
  } catch {
    return DEFAULT_SHELF_ORDER;
  }
}

export function saveShelfOrder(order: ShelfOrder) {
  try {
    localStorage.setItem(KEY, order);
  } catch {
    // storage unavailable (private mode); the shelf just opens on the default each time
  }
}
