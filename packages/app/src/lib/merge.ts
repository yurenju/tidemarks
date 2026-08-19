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

export function mergeAnnotation(local: Annotation | undefined, remote: Annotation): Annotation {
  return lww(local, remote);
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

// Pull cursor boundary: strictly greater-than, so a row whose server time
// equals the cursor is never re-sent.
export function rowsSince<T>(rows: T[], getTime: (row: T) => number, cursor: number): T[] {
  return rows.filter((r) => getTime(r) > cursor);
}
