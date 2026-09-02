// The one place an account's book limit changes, and where freezing and thawing happen with it.
//
// A lapsed subscription shrinks the limit back to three but deletes nothing: the books past the
// limit are marked frozen, the server keeps them, the sync push drops their changes and
// `/auth/me` stops listing them, so every device shows them as only on that device (ADR-0016).
// The three that stay are the three most recently read, because at the moment of a lapse every
// book has long been on the server and "recently read" is the only order that says which ones
// the reader cares about now. Resubscribing thaws everything and the usual LWW merge takes over.
//
// Freezing does not touch `updated_at`. It is a fact the server decided on its own and tells the
// device through `/auth/me`; a bumped `updated_at` would make the next pull carry the book back
// to every device as a change (see CONTEXT.md, on subscriptions).
import type { Env } from "./auth";

interface QuotaBook {
  id: string;
  added_at: number;
  deleted_at: number | null;
}

interface QuotaProgress {
  book_id: string;
  last_read_at: number;
}

/**
 * The ids to freeze once the account may keep only `limit` books: every live book past the
 * `limit` most recently read. A book nobody has opened counts as read when it was added — an
 * unopened book is the one least worth a slot. Deleted books neither take a slot nor get frozen.
 */
export function booksToFreeze(
  books: QuotaBook[],
  progress: QuotaProgress[],
  limit: number | null,
): string[] {
  if (limit === null) return [];
  const lastRead = new Map(progress.map((p) => [p.book_id, p.last_read_at]));
  return books
    .filter((b) => b.deleted_at === null)
    .map((b) => ({ id: b.id, at: lastRead.get(b.id) ?? b.added_at }))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(limit)
    .map((b) => b.id);
}

/** Sets the account's limit and, in the same batch, freezes or thaws its books to match. */
export async function setBookLimit(env: Env, userId: string, limit: number | null): Promise<void> {
  const [books, progress] = await Promise.all([
    env.DB.prepare("SELECT id, added_at, deleted_at FROM books WHERE user_id = ?")
      .bind(userId)
      .all<QuotaBook>(),
    env.DB.prepare("SELECT book_id, last_read_at FROM progress WHERE user_id = ?")
      .bind(userId)
      .all<QuotaProgress>(),
  ]);
  const frozen = booksToFreeze(books.results, progress.results, limit);
  const marks = frozen.map(() => "?").join(", ");

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET book_limit = ? WHERE id = ?").bind(limit, userId),
    // SQLite accepts an empty `IN ()`, so thawing everything is the same statement.
    env.DB.prepare(
      `UPDATE books SET frozen_at = NULL WHERE user_id = ? AND id NOT IN (${marks})`,
    ).bind(userId, ...frozen),
    // A book already frozen keeps its original time.
    ...(frozen.length
      ? [
          env.DB.prepare(
            `UPDATE books SET frozen_at = COALESCE(frozen_at, ?) WHERE user_id = ? AND id IN (${marks})`,
          ).bind(Date.now(), userId, ...frozen),
        ]
      : []),
  ]);
}
