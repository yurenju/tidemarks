// Pure conflict-resolution rules shared by the sync client and the Worker.
// Cursor uses server time; conflict resolution uses client time (lastReadAt /
// updatedAt), so device clocks never affect "what changed", only "whose intent
// is newer".
import type { Annotation, Progress, ReadingSession, SyncBook } from "./types";

// LWW by lastReadAt: deliberately not furthest-wins, so "flip back and reread"
// is respected. Tie goes to remote so re-applying a pull is idempotent.
export function mergeProgress(local: Progress | undefined, remote: Progress): Progress {
  if (!local) return remote;
  return local.lastReadAt > remote.lastReadAt ? local : remote;
}

// LWW by updatedAt; a tombstone (deletedAt) is just a write and wins like any
// other. On a timestamp tie the deleted side wins: never resurrect.
function lww<T extends { updatedAt: number; deletedAt: number | null }>(
  local: T | undefined,
  remote: T,
): T {
  if (!local) return remote;
  if (local.updatedAt === remote.updatedAt) {
    return local.deletedAt && !remote.deletedAt ? local : remote;
  }
  return local.updatedAt > remote.updatedAt ? local : remote;
}

/**
 * LWW like the rest, **except for `lastShownAt`, which merges on its own**.
 *
 * The row is the reader's words and the field is the shelf's bookkeeping, and they are written
 * at different moments by different devices: opening the shelf on a phone stamps the field,
 * writing a note on a laptop rewrites the row. Left to plain LWW one of those two erases the
 * other, and which one depends on the order the app happened to sync in.
 *
 * So the winner decides the row and the field is settled separately, by taking the later of
 * the two. That is sound because seeing only ever moves forward: a device that has shown a
 * passage more recently knows something the other does not, whichever of them holds the newer
 * note. It also means showing a card must **not** bump `updatedAt` — see `types.ts`.
 */
export function mergeAnnotation(local: Annotation | undefined, remote: Annotation): Annotation {
  const won = lww(local, remote);
  const shown = latest(local?.lastShownAt, remote.lastShownAt);
  // Written back only when there is something to say, so a row that has never reached the card
  // stays exactly as it arrived rather than growing a null.
  return shown === null ? won : { ...won, lastShownAt: shown };
}

/**
 * Whether the reader's words in `incoming` lost to a newer copy already on the server.
 *
 * Asked separately because `mergeAnnotation` no longer answers it by identity: it can return a
 * row that is neither of its arguments, being the winner's words with the later viewing on it.
 * This is the plain last-write-wins question, and only the row is in it.
 */
export function annotationRowLost(local: Annotation | undefined, remote: Annotation): boolean {
  return lww(local, remote) !== remote;
}

function latest(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

export function mergeBook(local: SyncBook | undefined, remote: SyncBook): SyncBook {
  return lww(local, remote);
}

// reading sessions are append-only: insert-or-ignore by id
export function dedupeSessions(
  existingIds: ReadonlySet<string>,
  incoming: ReadingSession[],
): ReadingSession[] {
  return incoming.filter((s) => !existingIds.has(s.id));
}

// After a push, only clear dirty flags set before the push snapshot; a row
// re-dirtied mid-push stays dirty for the next round.
export function clearableDirty<T extends { dirtyAt?: number }>(rows: T[], snapshotAt: number): T[] {
  return rows.filter((r) => r.dirtyAt !== undefined && r.dirtyAt <= snapshotAt);
}
