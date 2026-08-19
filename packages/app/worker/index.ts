// The Folis Worker, in two halves.
//
// The reader's own half — /auth/* (passkeys), /api/sync (pull/push), /api/books/:id file &
// cover streaming, and the /authorize consent screen — is `folisApp` below, authenticated by
// the session cookie. Everything it does not claim falls through to static assets (PWA).
//
// The agent's half is /mcp, authenticated by an OAuth access token. It is not reachable from
// here: `OAuthProvider` is the actual entry point and only calls `mcpApi` once a token has
// checked out, handing over the reader's id in `ctx.props`. That is the whole reason the
// wrapper is worth its weight — a route that cannot be reached without a token cannot be
// left unprotected by an edit in this file.
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { rowsSince } from "../src/lib/merge";
import type { Annotation, Progress, ReadingSession, SyncBook } from "../src/lib/types";
import { handleAuth, json, sessionUserId, type Env } from "./auth";
import { handleAuthorize, READ_SCOPE } from "./authorize";
import { d1Store } from "./mcp/d1-store";
import { handleMcp } from "./mcp/http";
import { type PushBody, resolvePush } from "./push";

interface McpEnv extends Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

const folisApp = {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // `ctx` so the mail a login sends afterwards does not hold the response open.
    if (path.startsWith("/auth/")) return handleAuth(request, env, path, ctx);
    if (path === "/authorize") return handleAuthorize(request, env);

    if (path.startsWith("/api/")) {
      const userId = await sessionUserId(env, request);
      if (!userId) return json({ error: "unauthenticated" }, { status: 401 });

      if (path === "/api/sync") {
        if (request.method === "GET") return pullSync(env, userId, url);
        if (request.method === "POST") return pushSync(request, env, userId);
        return json({ error: "method not allowed" }, { status: 405 });
      }

      const fileMatch = path.match(/^\/api\/books\/([^/]+)\/(file|cover)$/);
      if (fileMatch) return handleBookObject(request, env, userId, fileMatch[1]!, fileMatch[2]!);

      return json({ error: "not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<McpEnv>;

// Whose shelf this token opens. Read back out of the grant rather than trusted as typed: it
// has been through KV since it was written, and a Worker that indexed D1 by an undefined user
// id would answer with somebody's books or nobody's, both silently.
function readerId(props: unknown): string | undefined {
  if (typeof props !== "object" || props === null) return undefined;
  const userId = (props as { userId?: unknown }).userId;
  return typeof userId === "string" && userId !== "" ? userId : undefined;
}

// Reached only with a valid access token; `props` is what `completeAuthorization` stored.
const mcpApi = {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const userId = readerId(ctx.props);
    if (!userId) return json({ error: "this token carries no reader" }, { status: 401 });
    return handleMcp(request, d1Store(env, userId));
  },
} satisfies ExportedHandler<McpEnv>;

export default new OAuthProvider<McpEnv>({
  apiHandlers: { "/mcp": mcpApi },
  defaultHandler: folisApp,

  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  // Dynamic client registration, because the reader's agent is theirs to choose: hard-coding
  // client ids would mean Folis deciding which apps are allowed to ask (#63).
  clientRegistrationEndpoint: "/oauth/register",

  scopesSupported: [READ_SCOPE],
  // PKCE with S256 only. `plain` is in the spec for clients that cannot hash, and accepting it
  // would mean the verifier travels in the clear on every flow, including the ones that could
  // have used S256.
  allowPlainPKCE: false,

  // `resourceMetadata.resource` is deliberately left out: the provider then derives it from
  // the request origin, so `wrangler dev` on localhost advertises localhost and production
  // advertises production. Pinning it would put the deployed hostname in the source and make
  // the OAuth flow untestable anywhere else — Folis is one server on one origin, so there is
  // nothing here for a pinned audience to protect against.
});

// --- sync ---

interface BookRow {
  id: string;
  title: string;
  author: string;
  added_at: number;
  cover_key: string | null;
  client_updated_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface ProgressRow {
  book_id: string;
  cfi: string;
  page_range: string | null;
  percentage: number;
  chapter_label: string | null;
  last_read_at: number;
  updated_at: number;
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
  updated_at: number;
  deleted_at: number | null;
}

interface SessionRow {
  id: string;
  book_id: string;
  started_at: number;
  ended_at: number;
  start_fraction: number | null;
  end_fraction: number | null;
  updated_at: number;
}

function bookToWire(r: BookRow): SyncBook {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    addedAt: r.added_at,
    updatedAt: r.client_updated_at,
    deletedAt: r.deleted_at,
    hasCover: !!r.cover_key,
  };
}

function annotationToWire(r: AnnotationRow): Annotation {
  return {
    id: r.id,
    bookId: r.book_id,
    cfiRange: r.cfi_range,
    text: r.text,
    note: r.note,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.client_updated_at,
    deletedAt: r.deleted_at,
  };
}

function progressToWire(r: ProgressRow): Progress {
  return {
    bookId: r.book_id,
    cfi: r.cfi,
    pageRange: r.page_range,
    percentage: r.percentage,
    chapterLabel: r.chapter_label,
    lastReadAt: r.last_read_at,
  };
}

function sessionToWire(r: SessionRow): ReadingSession {
  return {
    id: r.id,
    bookId: r.book_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    startFraction: r.start_fraction,
    endFraction: r.end_fraction,
  };
}

async function loadAll(env: Env, userId: string) {
  const [books, progress, annotations, sessions] = await Promise.all([
    env.DB.prepare("SELECT * FROM books WHERE user_id = ?").bind(userId).all<BookRow>(),
    env.DB.prepare("SELECT * FROM progress WHERE user_id = ?").bind(userId).all<ProgressRow>(),
    env.DB.prepare("SELECT * FROM annotations WHERE user_id = ?").bind(userId).all<AnnotationRow>(),
    env.DB.prepare("SELECT * FROM reading_sessions WHERE user_id = ?")
      .bind(userId)
      .all<SessionRow>(),
  ]);
  return {
    books: books.results,
    progress: progress.results,
    annotations: annotations.results,
    sessions: sessions.results,
  };
}

// ponytail: full-table scan per user + rowsSince in JS keeps the cursor
// boundary in one tested function; switch to SQL WHERE updated_at > ? if a
// library ever outgrows it
async function pullSync(env: Env, userId: string, url: URL): Promise<Response> {
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const all = await loadAll(env, userId);
  return json({
    cursor: Date.now(),
    books: rowsSince(all.books, (r) => r.updated_at, since).map(bookToWire),
    progress: rowsSince(all.progress, (r) => r.updated_at, since).map(progressToWire),
    annotations: rowsSince(all.annotations, (r) => r.updated_at, since).map(annotationToWire),
    readingSessions: rowsSince(all.sessions, (r) => r.updated_at, since).map(sessionToWire),
  });
}

async function pushSync(request: Request, env: Env, userId: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PushBody | null;
  if (!body) return json({ error: "bad request" }, { status: 400 });
  const now = Date.now();
  const all = await loadAll(env, userId);

  // Winner/conflict decisions live in resolvePush (pure, tested); this function
  // only turns the plan into D1 statements. `now` is the server write time.
  const { plan, conflicts } = resolvePush(
    {
      books: all.books.map(bookToWire),
      progress: all.progress.map(progressToWire),
      annotations: all.annotations.map(annotationToWire),
      sessions: all.sessions.map(sessionToWire),
    },
    body,
  );

  const statements: D1PreparedStatement[] = [];
  for (const b of plan.books) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO books (id, user_id, title, author, added_at, r2_key, cover_key, client_updated_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, ?8)
         ON CONFLICT (user_id, id) DO UPDATE SET
           title = ?3, author = ?4, added_at = ?5, client_updated_at = ?6, updated_at = ?7, deleted_at = ?8`,
      ).bind(b.id, userId, b.title, b.author, b.addedAt, b.updatedAt, now, b.deletedAt),
    );
  }

  for (const p of plan.progress) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO progress (book_id, user_id, cfi, page_range, percentage, chapter_label, last_read_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           cfi = ?3, page_range = ?4, percentage = ?5, chapter_label = ?6, last_read_at = ?7, updated_at = ?8`,
      ).bind(
        p.bookId,
        userId,
        p.cfi,
        p.pageRange ?? null,
        p.percentage,
        p.chapterLabel ?? null,
        p.lastReadAt,
        now,
      ),
    );
  }

  for (const a of plan.annotations) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO annotations (id, user_id, book_id, cfi_range, text, note, color, created_at, client_updated_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (user_id, id) DO UPDATE SET
           note = ?6, color = ?7, client_updated_at = ?9, updated_at = ?10, deleted_at = ?11`,
      ).bind(
        a.id,
        userId,
        a.bookId,
        a.cfiRange,
        a.text,
        a.note,
        a.color,
        a.createdAt,
        a.updatedAt,
        now,
        a.deletedAt,
      ),
    );
  }

  for (const s of plan.sessions) {
    // append-only: insert or ignore by id (resolvePush already deduped)
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO reading_sessions (id, user_id, book_id, started_at, ended_at, start_fraction, end_fraction, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        s.id,
        userId,
        s.bookId,
        s.startedAt,
        s.endedAt,
        s.startFraction ?? null,
        s.endFraction ?? null,
        now,
      ),
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);
  return json({ conflicts });
}

// --- epub & cover objects (R2, never public: always streamed after user check) ---

async function handleBookObject(
  request: Request,
  env: Env,
  userId: string,
  bookId: string,
  kind: string,
): Promise<Response> {
  const keyColumn = kind === "file" ? "r2_key" : "cover_key";
  const book = await env.DB.prepare(
    "SELECT r2_key, cover_key FROM books WHERE user_id = ? AND id = ?",
  )
    .bind(userId, bookId)
    .first<{ r2_key: string | null; cover_key: string | null }>();
  if (!book) return json({ error: "not found" }, { status: 404 });

  if (request.method === "PUT") {
    const key = `${userId}/${bookId}/${kind}`;
    await env.BUCKET.put(key, request.body);
    await env.DB.prepare(`UPDATE books SET ${keyColumn} = ? WHERE user_id = ? AND id = ?`)
      .bind(key, userId, bookId)
      .run();
    return json({ ok: true });
  }

  if (request.method === "GET") {
    const key = kind === "file" ? book.r2_key : book.cover_key;
    if (!key) return json({ error: "no object" }, { status: 404 });
    const object = await env.BUCKET.get(key);
    if (!object) return json({ error: "no object" }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": kind === "file" ? "application/epub+zip" : "application/octet-stream",
      },
    });
  }

  return json({ error: "method not allowed" }, { status: 405 });
}
