/**
 * The revisit card's two writes: which passage is showing today, and that it has now been seen.
 *
 * Split from `revisit.ts` for the reason every `*-store.ts` here is: the rules about who comes
 * up are answerable without a database, and keeping the reads and writes out of them is what
 * makes them testable at all.
 *
 * **Today's passage is device-local and the viewing is not**, and the two halves are deliberate.
 * `lastShownAt` rides on the annotation because "I have seen this passage" is a fact about the
 * reader (see `types.ts`). Which passage happens to be showing today is a fact about this screen,
 * so it sits in `meta`, which syncs nothing — a second device draws one of its own.
 */

import { db } from "./db";
import { localDay, type ShownToday } from "./revisit";

const SHOWN_KEY = "revisitShown";

export async function loadShownToday(): Promise<ShownToday | null> {
  const row = await db.meta.get(SHOWN_KEY);
  if (typeof row?.value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!isShownToday(parsed)) return null;
    return parsed;
  } catch {
    // Unreadable rather than absent, which is the same thing to the caller: draw again.
    return null;
  }
}

export async function saveShownToday(id: string, at: number): Promise<void> {
  const shown: ShownToday = { day: localDay(at), id };
  await db.meta.put({ key: SHOWN_KEY, value: JSON.stringify(shown) });
}

/**
 * Records that the card has now put this passage in front of the reader.
 *
 * ⚠️ **Nothing reads this back at the moment**, and it is written anyway. The draw is random
 * while that is being lived with (ADR-0038); the field is what an ordering by "longest unseen"
 * would need, and a field that stopped being written has no history to offer when that question
 * is asked again. Writing it costs one update per draw.
 *
 * ⚠️ **`updatedAt` is deliberately left alone.** Annotations are last-write-wins on it, so
 * stamping it here would let opening the shelf on one device beat a note written on another.
 * `dirtyAt` still moves, because the field does have to go up; `mergeAnnotation` settles it by
 * taking the later of the two rather than by who won the row.
 */
export async function noteShown(id: string, at: number): Promise<void> {
  await db.annotations.update(id, { lastShownAt: at, dirtyAt: at });
}

function isShownToday(value: unknown): value is ShownToday {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ShownToday>;
  return typeof candidate.day === "string" && typeof candidate.id === "string";
}
