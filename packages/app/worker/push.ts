// Pure push orchestration: given the server's current rows and an incoming
// push body, decide what to upsert (the plan) and which rows lost to a newer
// server copy (the conflicts, echoed back so the client can adopt them).
import { dedupeSessions, mergeAnnotation, mergeBook, mergeProgress } from "../src/lib/merge";
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

  // A row loses only if a server copy exists (merge(undefined, x) always
  // returns x), so `server!` is safe inside every conflict branch below.
  const bookById = new Map(existing.books.map((b) => [b.id, b]));
  for (const incoming of body.books ?? []) {
    const server = bookById.get(incoming.id);
    if (mergeBook(server, incoming) === incoming) plan.books.push(incoming);
    else conflicts.books.push(server!);
  }

  const progById = new Map(existing.progress.map((p) => [p.bookId, p]));
  for (const incoming of body.progress ?? []) {
    const server = progById.get(incoming.bookId);
    if (mergeProgress(server, incoming) === incoming) plan.progress.push(incoming);
    else conflicts.progress.push(server!);
  }

  const annById = new Map(existing.annotations.map((a) => [a.id, a]));
  for (const incoming of body.annotations ?? []) {
    const server = annById.get(incoming.id);
    if (mergeAnnotation(server, incoming) === incoming) plan.annotations.push(incoming);
    else conflicts.annotations.push(server!);
  }

  const existingSessionIds = new Set(existing.sessions.map((s) => s.id));
  plan.sessions = dedupeSessions(existingSessionIds, body.readingSessions ?? []);

  return { plan, conflicts };
}
