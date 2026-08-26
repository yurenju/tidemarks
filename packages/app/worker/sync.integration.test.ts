// Sync, running against a real D1 — the columns and the parameter positions, not the merge
// decisions (those are pure: `push.test.ts` here, `src/lib/merge.test.ts` on the device, and
// `src/lib/sync-payload.test.ts` for what goes on the wire).
//
// Only for the class of bug the pure ones structurally cannot see: a column that does not exist
// in the schema, a `bind()` list that has drifted out of step with its `?N` placeholders, and a
// `WHERE` whose edge is off by one row. All three typecheck cleanly and all three fail in
// production. The first two carry the three
// columns #129 added, because a reading speed the device measured and the server silently
// dropped would look exactly like a reader who never read anything.
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Progress, ReadingSession } from "../src/lib/types";

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
});
