// What a pull hands back as the caller's next `since`. Pure, so the arithmetic is settled at the
// node layer; `sync.integration.test.ts` only checks that `pullSync` is wired to it.

/**
 * The cursor a pull hands back: **the newest write it actually carried**, never the clock.
 *
 * A clock reading taken in the handler is later than the query it reports on, and a push that
 * commits in between falls in the gap for good: the stamp on that row is the clock reading the
 * push took, which is earlier than this one, so the row is older than the cursor while never
 * having been sent. Every later pull asks for rows newer than a cursor it already passed, and one
 * device silently stops seeing another's positions until something writes that row again.
 *
 * Deriving it from the rows is what removes that: the cursor is a value some row already carries,
 * so a write that lands afterwards is stamped past it.
 *
 * **`since` is the floor.** A pull that carried nothing learnt nothing, so it must not move the
 * cursor either.
 *
 * **`now` is the ceiling**, and it is the one part here that is not obvious. Stamps come from
 * whichever isolate served the push, and those clocks are only as aligned as NTP keeps them — so
 * a row can carry a time slightly in the future. Taking it as the cursor would skip every write
 * from an isolate whose clock is behind it until real time caught up, which is the same permanent
 * loss described above. Refusing to move past `now` turns that back into carrying a row twice,
 * which merges idempotently. Closing it properly means a server sequence rather than a clock:
 * #112.
 */
export function cursorFor(
  written: Record<string, readonly { updated_at: number }[]>,
  since: number,
  now: number,
): number {
  let newest = since;
  for (const rows of Object.values(written)) {
    for (const row of rows) if (row.updated_at > newest) newest = row.updated_at;
  }
  return Math.max(since, Math.min(newest, now));
}
