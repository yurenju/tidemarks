// Pure push orchestration: given the server's current rows and an incoming
// push body, decide what to upsert (the plan) and which rows lost to a newer
// server copy (the conflicts, echoed back so the client can adopt them).
import {
  annotationRowLost,
  dedupeSessions,
  mergeAnnotation,
  mergeBook,
  mergeProgress,
} from "../src/lib/merge";
import type { Annotation, Progress, ReadingSession, SyncBook } from "../src/lib/types";

export interface PushBody {
  books?: SyncBook[];
  progress?: Progress[];
  annotations?: Annotation[];
  readingSessions?: ReadingSession[];
}

export interface PushExisting {
  books: SyncBook[];
  progress: Progress[];
  annotations: Annotation[];
  sessions: ReadingSession[];
  // Ids of the books the server holds but no longer accepts changes for (ADR-0016). Every
  // frozen book is also in `books`; the set is here because `SyncBook` is the wire shape, and
  // frozen is a fact the device is told through `/auth/me`, not through the sync payload.
  frozen: Set<string>;
  // How many live books this account may keep on the server; null means no limit.
  limit: number | null;
}

export interface PushPlan {
  books: SyncBook[];
  progress: Progress[];
  annotations: Annotation[];
  sessions: ReadingSession[];
}

export interface PushConflicts {
  books: SyncBook[];
  progress: Progress[];
  annotations: Annotation[];
}

export function resolvePush(
  existing: PushExisting,
  body: PushBody,
): { plan: PushPlan; conflicts: PushConflicts } {
  const plan: PushPlan = { books: [], progress: [], annotations: [], sessions: [] };
  const conflicts: PushConflicts = { books: [], progress: [], annotations: [] };

  // The quota is checked here and nowhere else (ADR-0016): a book the server has never seen
  // takes a slot if one is free, and is dropped whole otherwise. Slots go in payload order,
  // because "which three" is the server's call and arrival is the only order it knows.
  //
  // Frozen books are the other kind the server does not take: it holds them, but a change to
  // one is dropped, not merged and not echoed as a conflict — the device is not wrong, it is
  // just not being listened to until the subscription is back.
  //
  // A refused book takes everything of its own with it, so `refused` is consulted by every
  // loop below. Whole or nothing is the definition of a synced book.
  const refused = new Set(existing.frozen);
  let live = existing.books.filter(
    (b) => b.deletedAt === null && !existing.frozen.has(b.id),
  ).length;

  // A row loses only if a server copy exists (merge(undefined, x) always
  // returns x), so `server!` is safe inside every conflict branch below.
  const bookById = new Map(existing.books.map((b) => [b.id, b]));
  for (const incoming of body.books ?? []) {
    if (refused.has(incoming.id)) continue;
    const server = bookById.get(incoming.id);
    if (!server) {
      if (existing.limit !== null && live >= existing.limit) {
        refused.add(incoming.id);
        continue;
      }
      if (incoming.deletedAt === null) live++;
    }
    if (mergeBook(server, incoming) === incoming) plan.books.push(incoming);
    else conflicts.books.push(server!);
  }

  const progById = new Map(existing.progress.map((p) => [p.bookId, p]));
  for (const incoming of body.progress ?? []) {
    if (refused.has(incoming.bookId)) continue;
    const server = progById.get(incoming.bookId);
    if (mergeProgress(server, incoming) === incoming) plan.progress.push(incoming);
    else conflicts.progress.push(server!);
  }

  // Annotations are the one table where a push can lose and still have something to say. The
  // row is last-write-wins like the others, but `lastShownAt` merges on its own (see
  // `mergeAnnotation`), so a device whose note lost can still hold the later viewing. The
  // merged row is written either way, and the echo carries it too — the client `put`s a
  // conflict over its whole local row, so echoing the bare server copy would throw away the
  // viewing this device just recorded.
  const annById = new Map(existing.annotations.map((a) => [a.id, a]));
  for (const incoming of body.annotations ?? []) {
    if (refused.has(incoming.bookId)) continue;
    const server = annById.get(incoming.id);
    const merged = mergeAnnotation(server, incoming);
    // Nothing to write when the merge produced the server's own row back, which is every push
    // that simply lost. `merged` is a fresh object whenever the viewing moved, so identity is
    // the whole test.
    if (merged !== server) plan.annotations.push(merged);
    if (annotationRowLost(server, incoming)) conflicts.annotations.push(merged);
  }

  const existingSessionIds = new Set(existing.sessions.map((s) => s.id));
  plan.sessions = dedupeSessions(
    existingSessionIds,
    (body.readingSessions ?? []).filter((s) => !refused.has(s.bookId)),
  );

  return { plan, conflicts };
}
