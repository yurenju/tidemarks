// The one place the tools touch Cloudflare. Everything is scoped to a single user id, which
// comes from the OAuth grant — an agent holds a token for one reader, and the `WHERE user_id`
// on every statement here is what makes that true rather than merely intended.
import { EpubBook } from "@yurenju/frond/epub";
import type { Env } from "../auth";
import type { LibraryStore, StoredAnnotation, StoredBook, StoredProgress } from "./store";

interface BookRow {
  id: string;
  title: string;
  author: string;
  added_at: number;
}

interface ProgressRow {
  book_id: string;
  cfi: string;
  page_range: string | null;
  percentage: number;
  last_read_at: number;
}

interface AnnotationRow {
  id: string;
  book_id: string;
  cfi_range: string;
  text: string;
  note: string;
  color: string;
  created_at: number;
  client_updated_at: number;
}

export function d1Store(env: Env, userId: string): LibraryStore {
  // One epub is opened once per request, because a single question ("have I read this
  // elsewhere?") walks the same book several times and unzipping it again each time is the
  // difference between an answer and a timeout.
  const opened = new Map<string, Promise<EpubBook | undefined>>();

  return {
    async books(): Promise<StoredBook[]> {
      const { results } = await env.DB.prepare(
        "SELECT id, title, author, added_at FROM books WHERE user_id = ? AND deleted_at IS NULL",
      )
        .bind(userId)
        .all<BookRow>();
      return results.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        addedAt: r.added_at,
      }));
    },

    async progress(): Promise<StoredProgress[]> {
      const { results } = await env.DB.prepare(
        "SELECT book_id, cfi, page_range, percentage, last_read_at FROM progress WHERE user_id = ?",
      )
        .bind(userId)
        .all<ProgressRow>();
      return results.map((r) => ({
        bookId: r.book_id,
        cfi: r.cfi,
        pageRange: r.page_range,
        percentage: r.percentage,
        lastReadAt: r.last_read_at,
      }));
    },

    async annotations(bookId?: string): Promise<StoredAnnotation[]> {
      const statement = bookId
        ? env.DB.prepare(
            "SELECT * FROM annotations WHERE user_id = ? AND book_id = ? AND deleted_at IS NULL",
          ).bind(userId, bookId)
        : env.DB.prepare("SELECT * FROM annotations WHERE user_id = ? AND deleted_at IS NULL").bind(
            userId,
          );
      const { results } = await statement.all<AnnotationRow>();
      return results.map((r) => ({
        id: r.id,
        bookId: r.book_id,
        cfiRange: r.cfi_range,
        text: r.text,
        note: r.note,
        color: r.color,
        createdAt: r.created_at,
        updatedAt: r.client_updated_at,
      }));
    },

    openBook(bookId: string): Promise<EpubBook | undefined> {
      const cached = opened.get(bookId);
      if (cached) return cached;
      const pending = loadBook(env, userId, bookId);
      opened.set(bookId, pending);
      return pending;
    },
  };
}

async function loadBook(env: Env, userId: string, bookId: string): Promise<EpubBook | undefined> {
  const row = await env.DB.prepare(
    "SELECT r2_key FROM books WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
  )
    .bind(userId, bookId)
    .first<{ r2_key: string | null }>();
  if (!row?.r2_key) return undefined;

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) return undefined;

  try {
    return await EpubBook.open(await object.arrayBuffer());
  } catch {
    // The shelf says this book exists and the bytes will not open. That is a fact about one
    // book; the tools turn it into "this book cannot be read", not into a broken server.
    return undefined;
  }
}
