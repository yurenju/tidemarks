// The Worker, running, with a real D1, R2 and KV behind it.
//
// Deliberately few. This layer is slow and the pure tests already cover every decision worth
// making — `mcp/protocol.test.ts` for the transport, `mcp/tools.test.ts` for what each tool
// answers, `mcp/library.test.ts` for the reading underneath. What this buys is the class of bug
// those tests structurally cannot see — a column name
// that does not exist, a bound parameter in the wrong position, a route that answers without a
// token. Each of those typechecks cleanly and fails in production.
import { env, SELF } from "cloudflare:test";
import { ContentDocument, EpubBook, serializeCfi } from "@yurenju/frond/epub";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./auth";
import { setBookLimit } from "./quota";

const USER = "u-test";
const SESSION = "session-test";
const BOOK = "book-test";

interface TestEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  TEST_EPUB: string;
}

function testEnv(): TestEnv {
  return env as unknown as TestEnv;
}

/** The bytes of a real book, handed in as base64 because workerd cannot read the disk. */
function epubBytes(): Uint8Array {
  const binary = atob(testEnv().TEST_EPUB);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A logged-in reader with one book whose epub is really in R2.
 *
 * Clears first: storage lives for the whole file, not for one test, so without this the tests
 * would only pass in the order they happen to be written in.
 */
async function seedShelf(): Promise<void> {
  const { DB, BUCKET } = testEnv();
  const now = Date.now();
  await BUCKET.put(`${USER}/${BOOK}/file`, epubBytes());
  await DB.batch(
    ["progress", "annotations", "reading_sessions", "books", "auth_sessions", "users"].map(
      (table) => DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await DB.batch([
    DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(
      USER,
      "test@example.com",
      now,
    ),
    DB.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(
      SESSION,
      USER,
      now + 3_600_000,
    ),
    DB.prepare(
      `INSERT INTO books (id, user_id, title, author, added_at, r2_key, cover_key, client_updated_at, updated_at, deleted_at)
       VALUES (?, ?, 'Kusamakura', 'Natsume Soseki', ?, ?, NULL, ?, ?, NULL)`,
    ).bind(BOOK, USER, now, `${USER}/${BOOK}/file`, now, now),
  ]);
}

/** The section of the seeded book with enough prose to slice a page out of, and its text. */
async function proseSection(): Promise<{ index: number; text: string }> {
  const book = await EpubBook.open(epubBytes());
  for (let index = 0; index < book.readingOrder.length; index++) {
    const xhtml = new TextDecoder().decode(book.bytes(book.readingOrder[index]!.path));
    const doc = ContentDocument.parse(xhtml, index);
    if (doc.characters > 400) return { index, text: doc.text };
  }
  throw new Error("the test book has no section long enough");
}

/** The range CFI a reader's device would have stored for characters [start, end). */
async function pageRangeFor(index: number, start: number, end: number): Promise<string> {
  const book = await EpubBook.open(epubBytes());
  const xhtml = new TextDecoder().decode(book.bytes(book.readingOrder[index]!.path));
  const cfi = ContentDocument.parse(xhtml, index).cfiForCharacters(start, end);
  if (!cfi) throw new Error("section has no text to address");
  return serializeCfi(cfi);
}

/** Walks the whole OAuth flow the way an agent's client does, and returns the access token. */
async function connectAgent(): Promise<string> {
  // RFC 7636 appendix B's verifier/challenge pair, so the exchange below is a real S256 check
  // rather than a value this test computed and could get wrong in both places.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const redirect = "https://agent.example/callback";

  const registered = await SELF.fetch("https://tidemarks.test/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Agent",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  expect(registered.status).toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const query =
    `response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&state=xyz` +
    `&code_challenge=${challenge}&code_challenge_method=S256&scope=tidemarks:read`;

  const approved = await SELF.fetch(`https://tidemarks.test/authorize?${query}`, {
    method: "POST",
    headers: {
      cookie: `tidemarks_session=${SESSION}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "decision=approve",
    redirect: "manual",
  });
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code");
  expect(code).toBeTruthy();

  const exchanged = await SELF.fetch("https://tidemarks.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  expect(exchanged.status).toBe(200);
  const { access_token: token } = (await exchanged.json()) as { access_token: string };
  return token;
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await SELF.fetch("https://tidemarks.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  expect(body.result.isError).toBeUndefined();
  return JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
}

beforeEach(seedShelf);

describe("/mcp without a token", () => {
  it("refuses, and says where to go and get one", async () => {
    // The only test of this that means anything: the tools are read-only but the shelf is not
    // public, and nothing in the pure tests would notice if the route stopped being wrapped.
    const response = await SELF.fetch("https://tidemarks.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });
});

describe("an agent that has been through the OAuth flow", () => {
  it("reads the page the reader was on, out of the real book in R2", async () => {
    // The whole path in one: a stored range CFI, out of D1, resolved against epub bytes pulled
    // from R2, by a Worker that had to hold a valid access token to get here.
    const { index, text } = await proseSection();
    const pageRange = await pageRangeFor(index, 100, 300);
    const cfi = await pageRangeFor(index, 100, 100);
    await testEnv()
      .DB.prepare(
        `INSERT INTO progress (book_id, user_id, cfi, page_range, percentage, last_read_at, updated_at)
         VALUES (?, ?, ?, ?, 0.25, ?, ?)`,
      )
      .bind(BOOK, USER, cfi, pageRange, Date.now(), Date.now())
      .run();

    const token = await connectAgent();
    const position = await callTool(token, "get_reading_position");

    expect(position.bookId).toBe(BOOK);
    expect(position.passage).toEqual({ kind: "page", text: text.slice(100, 300) });
  });

  it("lists the shelf it was granted, and nobody else’s", async () => {
    const { DB } = testEnv();
    await DB.prepare(
      `INSERT INTO books (id, user_id, title, author, added_at, r2_key, cover_key, client_updated_at, updated_at, deleted_at)
       VALUES ('other-book', 'someone-else', 'Not Yours', '', 1, NULL, NULL, 1, 1, NULL)`,
    ).run();

    const token = await connectAgent();
    const { books } = (await callTool(token, "list_books")) as { books: { title: string }[] };

    expect(books.map((b) => b.title)).toEqual(["Kusamakura"]);
  });
});

describe("the page range a device pushes", () => {
  it("survives a round trip through D1", async () => {
    // A guard on the SQL, which no pure test can see: `?N` and `bind()` drifting out of step
    // writes a value into the wrong column, and typechecks perfectly on the way (#28).
    const pageRange = "epubcfi(/6/4!/4,/2/1:10,/8/1:40)";
    const pushed = await SELF.fetch("https://tidemarks.test/api/sync", {
      method: "POST",
      headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
      body: JSON.stringify({
        progress: [
          {
            bookId: BOOK,
            cfi: "epubcfi(/6/4!/4/2/1:10)",
            pageRange,
            percentage: 0.5,
            lastReadAt: 1_000_000,
          },
        ],
      }),
    });
    expect(pushed.status).toBe(200);

    const pulled = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const body = (await pulled.json()) as { progress: { pageRange: string; percentage: number }[] };
    expect(body.progress).toHaveLength(1);
    expect(body.progress[0]!.pageRange).toBe(pageRange);
    expect(body.progress[0]!.percentage).toBe(0.5);
  });
});

describe("an account whose limit shrinks back to three", () => {
  it("freezes the book read longest ago, hides it from /auth/me and the agent, and thaws it again", async () => {
    // The whole freeze in one, against the real schema: the seeded book has a real epub in R2 and
    // is the one read longest ago, so its disappearance can only come from `frozen_at`. Four
    // reads of the same column (`quota.ts`, `/auth/me`, two store queries) have to agree.
    const { DB } = testEnv();
    const others = ["book-2", "book-3", "book-4"];
    await DB.batch([
      DB.prepare("UPDATE users SET book_limit = NULL WHERE id = ?").bind(USER),
      ...others.map((id) =>
        DB.prepare(
          `INSERT INTO books (id, user_id, title, author, added_at, r2_key, cover_key, client_updated_at, updated_at, deleted_at)
           VALUES (?, ?, ?, '', 1, NULL, NULL, 1, 1, NULL)`,
        ).bind(id, USER, id),
      ),
      ...[BOOK, ...others].map((id, i) =>
        DB.prepare(
          `INSERT INTO progress (book_id, user_id, cfi, page_range, percentage, last_read_at, updated_at)
           VALUES (?, ?, 'epubcfi(/6/4!/4/2/1:0)', NULL, 0.1, ?, 1)`,
        ).bind(id, USER, 1000 * (i + 1)),
      ),
    ]);
    const synced = async () => {
      const me = await SELF.fetch("https://tidemarks.test/auth/me", {
        headers: { cookie: `tidemarks_session=${SESSION}` },
      });
      return ((await me.json()) as { synced: string[] }).synced;
    };
    const stampOf = async () =>
      (await DB.prepare("SELECT updated_at FROM books WHERE id = ?")
        .bind(BOOK)
        .first<{ updated_at: number }>())!.updated_at;
    const before = await stampOf();
    const token = await connectAgent();

    await setBookLimit(env as unknown as Env, USER, 3);

    const row = await DB.prepare("SELECT frozen_at FROM books WHERE id = ?")
      .bind(BOOK)
      .first<{ frozen_at: number | null }>();
    expect(row?.frozen_at).not.toBeNull();
    // Freezing is told through /auth/me, never through the sync payload.
    expect(await stampOf()).toBe(before);
    expect(await synced()).toEqual(others);
    const { books } = (await callTool(token, "list_books")) as { books: { bookId: string }[] };
    expect(books.map((b) => b.bookId).sort()).toEqual(others);
    const refused = await SELF.fetch("https://tidemarks.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_section_text", arguments: { bookId: BOOK, sectionIndex: 0 } },
      }),
    });
    const body = (await refused.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBe(true);

    await setBookLimit(env as unknown as Env, USER, null);

    expect(await synced()).toEqual([...others, BOOK]);
    const thawed = (await callTool(token, "list_books")) as { books: { bookId: string }[] };
    expect(thawed.books).toHaveLength(4);
  });
});
