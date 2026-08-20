// Sync, running against a real D1 — the columns and the parameter positions, not the merge
// decisions (those are pure and covered in `push.test.ts`).
//
// One test, and it is here for the class of bug the pure tests structurally cannot see: a
// column that does not exist in the schema, and a `bind()` list that has drifted out of step
// with its `?N` placeholders. Both typecheck cleanly and both fail in production. This one
// carries the three columns #129 added, because a reading speed the device measured and the
// server silently dropped would look exactly like a reader who never read anything.
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
});
