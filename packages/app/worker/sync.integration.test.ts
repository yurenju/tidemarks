// Sync, running against a real D1 — the columns and the parameter positions, not the merge
// decisions (those are pure: `push.test.ts` here, `src/lib/merge.test.ts` on the device, and
// `src/lib/sync-payload.test.ts` for what goes on the wire).
//
// Only for the class of bug the pure ones structurally cannot see: a column that does not exist
// in the schema, a `bind()` list that has drifted out of step with its `?N` placeholders, a
// `WHERE` whose edge is off by one row, a handler reporting on the clock rather than on the
// rows it just loaded (`cursor.ts` decides the value; only a real query can show which rows it
// was given), and an `UPDATE` that changes a row without stamping it, which no device is ever
// told about. Every one of them typechecks cleanly and every one of them fails in
// production. The first two carry the three
// columns #129 added, because a reading speed the device measured and the server silently
// dropped would look exactly like a reader who never read anything.
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Progress, ReadingSession, SyncBook } from "../src/lib/types";

const USER = "u-sync";
const SESSION = "session-sync";
const BOOK = "book-sync";

function testEnv(): { DB: D1Database } {
  return env as unknown as { DB: D1Database };
}

beforeEach(async () => {
  const { DB } = testEnv();
  const now = Date.now();
  await DB.batch(
    ["progress", "annotations", "reading_sessions", "books", "auth_sessions", "users"].map(
      (table) => DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await DB.batch([
    DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(
      USER,
      "sync@example.com",
      now,
    ),
    DB.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(
      SESSION,
      USER,
      now + 3_600_000,
    ),
  ]);
});

describe("sync", () => {
  it("carries a sitting's place in the book and the chapter, there and back", async () => {
    const progress: Progress = {
      bookId: BOOK,
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      pageRange: "epubcfi(/6/14!/4,/2/1:0,/8/1:40)",
      percentage: 0.42,
      chapterLabel: "第七章 雨",
      lastReadAt: 1_700_000_000_000,
    };
    const session: ReadingSession = {
      id: "s-sync",
      bookId: BOOK,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_003_600_000,
      startFraction: 0.31,
      endFraction: 0.42,
    };

    const pushed = await SELF.fetch("https://tidemarks.test/api/sync", {
      method: "POST",
      headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
      body: JSON.stringify({
        books: [
          {
            id: BOOK,
            title: "草枕",
            author: "夏目漱石",
            addedAt: 1,
            updatedAt: 1,
            deletedAt: null,
          },
        ],
        progress: [progress],
        readingSessions: [session],
      }),
    });
    expect(pushed.status).toBe(200);

    const pulled = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    expect(pulled.status).toBe(200);
    const body = (await pulled.json()) as {
      progress: Progress[];
      readingSessions: ReadingSession[];
    };

    expect(body.progress).toEqual([progress]);
    expect(body.readingSessions).toEqual([session]);
  });

  // The rows every device already has: written before the columns existed, and pulled back by
  // a device that now reads them. `null` has to survive as `null` — read as 0 it would be a
  // sitting that started at the front of the book and covered 42% of it in an hour.
  it("keeps an unplaced sitting unplaced", async () => {
    const session: ReadingSession = {
      id: "s-old",
      bookId: BOOK,
      startedAt: 10,
      endedAt: 1010,
      startFraction: null,
      endFraction: null,
    };
    const pushed = await SELF.fetch("https://tidemarks.test/api/sync", {
      method: "POST",
      headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
      body: JSON.stringify({ readingSessions: [session] }),
    });
    expect(pushed.status).toBe(200);

    const pulled = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const body = (await pulled.json()) as { readingSessions: ReadingSession[] };
    expect(body.readingSessions).toEqual([session]);
  });

  // The pull selects on `updated_at > ?` rather than filtering in JS, so the cursor edge is now
  // a property of the SQL and only a real database can be asked about it. It has to be strict:
  // the cursor a pull hands back is a server clock reading, and a row written in that same
  // millisecond carries exactly that value — `>=` would hand it back on every sync for as long
  // as the reader kept the app open. Devices ask far more often than they used to
  // (`src/lib/sync-gate.ts`), which is what makes a resend-every-time worth a test.
  //
  // **The two rows are written straight to D1 with times of our choosing**, rather than pushed
  // and then read back through the cursor the pull returns. That cursor is taken after the
  // query it reports on, so it always lands a millisecond or two past anything a push in the
  // same test wrote — an off-by-one at the boundary would never be sitting on the boundary,
  // and the test would pass either way while looking like it had checked.
  it("does not hand back a row whose time is exactly the cursor", async () => {
    const { DB } = testEnv();
    const at = (bookId: string, updatedAt: number) =>
      DB.prepare(
        `INSERT INTO progress (book_id, user_id, cfi, page_range, percentage, chapter_label, last_read_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, ?4, NULL, ?5, ?6)`,
      ).bind(bookId, USER, "epubcfi(/6/14!/4/2/1:0)", 0.1, updatedAt, updatedAt);
    await DB.batch([at("book-at-cursor", 1000), at("book-after-cursor", 1001)]);

    const pulled = await SELF.fetch("https://tidemarks.test/api/sync?since=1000", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const body = (await pulled.json()) as { progress: Progress[] };

    // One of the two, and the one whose time is past the cursor rather than on it. Asserting
    // the whole list rather than the absence of the first row also catches a `WHERE` that
    // matched nothing at all, which would pass any test that only checked for absence.
    expect(body.progress.map((p) => p.bookId)).toEqual(["book-after-cursor"]);
  });

  // The other half of that edge, and the one a reader feels: the cursor must not run past rows
  // the pull did not carry. A push stamps its rows and commits them a moment later, so a pull
  // that lands in between reads none of them — and if it then hands back a clock reading rather
  // than the newest row it saw, that reading is already past the stamp the push took. The row is
  // older than the cursor and was never sent, so no later pull ever asks for it: one device stops
  // seeing another's positions until something writes that row again.
  //
  // **What is being checked here is the wiring**, that `pullSync` reports on the rows it loaded
  // rather than on the clock. Which value comes out of which rows is `cursor.test.ts`, at the
  // node layer, where the ceiling and the `since` floor are settled too.
  //
  // **Both rows go straight to D1**, because the whole point is a row whose stamp is behind the
  // wall clock — which is what a push in flight looks like, and what a push through the API can
  // never be made to look like from out here.
  it("hands back a cursor no later than the newest row it carried", async () => {
    const { DB } = testEnv();
    const at = (bookId: string, updatedAt: number) =>
      DB.prepare(
        `INSERT INTO progress (book_id, user_id, cfi, page_range, percentage, chapter_label, last_read_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, ?4, NULL, ?5, ?6)`,
      ).bind(bookId, USER, "epubcfi(/6/14!/4/2/1:0)", 0.1, updatedAt, updatedAt);

    await at("book-already-synced", 1000).run();
    const first = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const { cursor } = (await first.json()) as { cursor: number };
    expect(cursor).toBe(1000);

    // The other device's push, stamped while this pull was in flight and committed just after.
    await at("book-from-elsewhere", 1500).run();
    const second = await SELF.fetch(`https://tidemarks.test/api/sync?since=${cursor}`, {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const body = (await second.json()) as { cursor: number; progress: Progress[] };

    expect(body.progress.map((p) => p.bookId)).toEqual(["book-from-elsewhere"]);
    expect(body.cursor).toBe(1500);
  });

  // `last_shown_at` is written by a clause of its own — the upsert takes the later of the two
  // rather than whatever arrived last — so the placeholder is used twice in one statement and
  // wrapped in `NULLIF(MAX(...))`. Every part of that is invisible to the pure tests: they can
  // say what the merge decides, and not whether the column exists or whether `?12` reaches both
  // of the places it is named.
  it("carries when a passage was last shown, and never moves it backwards", async () => {
    const post = (lastShownAt: number | null) =>
      SELF.fetch("https://tidemarks.test/api/sync", {
        method: "POST",
        headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
        body: JSON.stringify({
          annotations: [
            {
              id: "a-shown",
              bookId: BOOK,
              cfiRange: "epubcfi(/6/14!/4,/2/1:0,/2/1:8)",
              text: "見わたせば花も紅葉もなかりけり",
              note: "",
              color: "indigo",
              createdAt: 1,
              updatedAt: 1,
              deletedAt: null,
              lastShownAt,
            },
          ],
        }),
      });
    const pull = async () => {
      const res = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
        headers: { cookie: `tidemarks_session=${SESSION}` },
      });
      return ((await res.json()) as { annotations: { lastShownAt: number | null }[] }).annotations;
    };

    expect((await post(5_000)).status).toBe(200);
    expect((await pull())[0]!.lastShownAt).toBe(5_000);

    // A device that has been offline pushes the viewing it recorded days ago. Taking it would
    // put the passage back at the front of the queue and show it again tomorrow.
    expect((await post(2_000)).status).toBe(200);
    expect((await pull())[0]!.lastShownAt).toBe(5_000);

    expect((await post(9_000)).status).toBe(200);
    expect((await pull())[0]!.lastShownAt).toBe(9_000);
  });

  // Every annotation written before the column existed. `null` has to survive as `null`: read
  // back as 0 it would be a passage shown at the epoch rather than one never shown, and the
  // card's queue puts those two at opposite ends.
  it("keeps a passage the card has never shown unshown", async () => {
    const pushed = await SELF.fetch("https://tidemarks.test/api/sync", {
      method: "POST",
      headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
      body: JSON.stringify({
        annotations: [
          {
            id: "a-unseen",
            bookId: BOOK,
            cfiRange: "epubcfi(/6/14!/4,/2/1:0,/2/1:8)",
            text: "秋の暮",
            note: "",
            color: "indigo",
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
          },
        ],
      }),
    });
    expect(pushed.status).toBe(200);

    const pulled = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const body = (await pulled.json()) as { annotations: { lastShownAt: number | null }[] };
    expect(body.annotations[0]!.lastShownAt).toBeNull();
  });

  // A cover reaches the server in a second write: the push creates the book row and stamps it,
  // then `PUT /cover` fills in `cover_key`. `hasCover` rides on that column, so a device that
  // pulled between the two has already been told this book has no cover — and unless the upload
  // moves `updated_at` too, that row never appears in one of its pulls again. The shelf keeps a
  // blank frame until something else writes the book.
  //
  // **The book row goes straight to D1** with a time of our choosing rather than through a push,
  // whose stamp would be a clock reading a millisecond or two from the upload's own. The two
  // landing in the same millisecond would drop the row on `updated_at > ?` for a reason this
  // test is not about.
  it("sends the book row again once its cover lands", async () => {
    const { DB } = testEnv();
    await DB.prepare(
      `INSERT INTO books (id, user_id, title, author, added_at, r2_key, cover_key, client_updated_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, NULL)`,
    )
      .bind(BOOK, USER, "草枕", "夏目漱石", 1, 1, 1000)
      .run();

    const first = await SELF.fetch("https://tidemarks.test/api/sync?since=0", {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const before = (await first.json()) as { cursor: number; books: SyncBook[] };
    expect(before.books.map((b) => b.hasCover)).toEqual([false]);

    const uploaded = await SELF.fetch(`https://tidemarks.test/api/books/${BOOK}/cover`, {
      method: "PUT",
      headers: { cookie: `tidemarks_session=${SESSION}` },
      body: "cover-bytes",
    });
    expect(uploaded.status).toBe(200);

    const second = await SELF.fetch(`https://tidemarks.test/api/sync?since=${before.cursor}`, {
      headers: { cookie: `tidemarks_session=${SESSION}` },
    });
    const after = (await second.json()) as { books: SyncBook[] };
    expect(after.books.map((b) => [b.id, b.hasCover])).toEqual([[BOOK, true]]);
  });

  // The quota, against the real columns: `book_limit` on `users`, `frozen_at` and `deleted_at`
  // on `books`, and the `WHERE` behind `synced`. Which book gets the slot is `push.test.ts`;
  // this is whether the refusal really keeps the row and its position out of D1, and whether a
  // delete really gives the slot back.
  it("holds three books, takes a fourth once one is deleted, and any number with no limit", async () => {
    const { DB } = testEnv();
    const push = (books: SyncBook[]) =>
      SELF.fetch("https://tidemarks.test/api/sync", {
        method: "POST",
        headers: { cookie: `tidemarks_session=${SESSION}`, "content-type": "application/json" },
        body: JSON.stringify({
          books,
          progress: books.map((b) => ({
            bookId: b.id,
            cfi: "epubcfi(/6/2)",
            pageRange: null,
            percentage: 0.1,
            chapterLabel: null,
            lastReadAt: 1,
          })),
        }),
      });
    const me = async () => {
      const res = await SELF.fetch("https://tidemarks.test/auth/me", {
        headers: { cookie: `tidemarks_session=${SESSION}` },
      });
      return (await res.json()) as { userId: string; limit: number | null; synced: string[] };
    };
    const book = (id: string, deletedAt: number | null = null): SyncBook => ({
      id,
      title: id,
      author: "",
      addedAt: 1,
      updatedAt: 1,
      deletedAt,
    });

    expect((await push([book("b1"), book("b2"), book("b3"), book("b4")])).status).toBe(200);
    expect(await me()).toEqual({ userId: USER, limit: 3, synced: ["b1", "b2", "b3"] });
    const rowsFor = (id: string) =>
      DB.prepare(
        "SELECT (SELECT count(*) FROM books WHERE id = ?1) + (SELECT count(*) FROM progress WHERE book_id = ?1) AS n",
      )
        .bind(id)
        .first<{ n: number }>();
    expect((await rowsFor("b4"))?.n).toBe(0);

    expect((await push([book("b2", 2)])).status).toBe(200);
    expect((await push([book("b4")])).status).toBe(200);
    expect((await me()).synced).toEqual(["b1", "b3", "b4"]);
    expect((await rowsFor("b4"))?.n).toBe(2);

    // An account with no limit: `book_limit` NULL has to come back as `limit: null` and stop
    // counting, not be read as zero.
    await DB.prepare("UPDATE users SET book_limit = NULL WHERE id = ?").bind(USER).run();
    expect((await push([book("b5"), book("b6")])).status).toBe(200);
    expect(await me()).toEqual({
      userId: USER,
      limit: null,
      synced: ["b1", "b3", "b4", "b5", "b6"],
    });
  });
});
