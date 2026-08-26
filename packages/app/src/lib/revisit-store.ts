/**
 * The revisit card's two writes: which five passages today's batch is, and that one of them has
 * now been seen.
 *
 * Split from `revisit.ts` for the reason every `*-store.ts` here is: the rules about who comes
 * up are answerable without a database, and keeping the reads and writes out of them is what
 * makes them testable at all.
 *
 * **The batch is device-local and the viewing is not**, and the two halves are deliberate.
 * `lastShownAt` rides on the annotation because "I have seen this passage" is a fact about the
 * reader (see `types.ts`). Which five happen to be showing today is a fact about this screen,
 * so it sits in `meta`, which syncs nothing. A second device gets a batch of its own, drawn
 * from the same memory of what has already been shown.
 */

import { db } from "./db";
import { localDay, type StoredBatch } from "./revisit";
import type { Annotation } from "./types";

const BATCH_KEY = "revisitBatch";

export async function loadStoredBatch(): Promise<StoredBatch | null> {
  const row = await db.meta.get(BATCH_KEY);
  if (typeof row?.value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!isStoredBatch(parsed)) return null;
    return parsed;
  } catch {
    // Unreadable rather than absent, which is the same thing to the caller: draw a new batch.
    return null;
  }
}

export async function saveStoredBatch(marks: Annotation[], at: number): Promise<void> {
  const batch: StoredBatch = { day: localDay(at), ids: marks.map((m) => m.id) };
  await db.meta.put({ key: BATCH_KEY, value: JSON.stringify(batch) });
}

/**
 * Records that the card has now put this passage in front of the reader.
 *
 * ⚠️ **`updatedAt` is deliberately left alone.** Annotations are last-write-wins on it, so
 * stamping it here would let opening the shelf on one device beat a note written on another.
 * `dirtyAt` still moves, because the field does have to go up; `mergeAnnotation` settles it by
 * taking the later of the two rather than by who won the row.
 *
 * Idempotent within a batch: a reader flicking back and forth over the same five re-stamps
 * rows that are already stamped today, which costs one write and changes nothing.
 */
export async function noteShown(id: string, at: number): Promise<void> {
  await db.annotations.update(id, { lastShownAt: at, dirtyAt: at });
}

function isStoredBatch(value: unknown): value is StoredBatch {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredBatch>;
  return (
    typeof candidate.day === "string" &&
    Array.isArray(candidate.ids) &&
    candidate.ids.every((id) => typeof id === "string")
  );
}
