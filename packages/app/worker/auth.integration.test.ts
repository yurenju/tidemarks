// Login, running, against a real D1.
//
// The pure tests already decide when a code is dead and who may create an account; what these
// buy is the part that only exists once there is a database behind it — that the columns are
// the columns the SQL names, that "used once" survives a second request rather than a second
// call to a function, and that the gate really does stand at account creation and nowhere else.
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EMAIL = "reader@example.com";

interface TestEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

function testEnv(): TestEnv {
  return env as unknown as TestEnv;
}

/** The same digest worker/auth.ts stores, so a test can plant a code it knows. */
async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Put a live code in the database for an address.
 *
 * Planted rather than read out of the sent mail: this is also the shape
 * `scripts/seed-preview-auth.sh` uses to log in without an inbox, so the shortcut the
 * verification path depends on is exercised here too.
 */
async function plantCode(email: string, code: string, over: Record<string, number> = {}) {
  const now = Date.now();
  await testEnv()
    .DB.prepare(
      `INSERT INTO magic_codes (id, email, code_hash, created_at, expires_at, attempts, consumed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
    )
    .bind(
      `code-${email}-${code}`,
      email,
      await sha256hex(code),
      now,
      over.expires_at ?? now + 10 * 60_000,
      over.attempts ?? 0,
    )
    .run();
}

function postJson(path: string, body: unknown, cookie?: string) {
  return SELF.fetch(`https://folis.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function allowlist(email: string) {
  await testEnv()
    .DB.prepare("INSERT INTO signup_allowlist (email, added_at) VALUES (?, ?)")
    .bind(email, Date.now())
    .run();
}

async function accountFor(email: string) {
  return testEnv()
    .DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();
}

beforeEach(async () => {
  const { DB } = testEnv();
  await DB.batch(
    ["magic_codes", "signup_allowlist", "auth_sessions", "credentials", "users"].map((table) =>
      DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

describe("asking for a magic code while signup is closed", () => {
  it("refuses an address nobody put on the list, and writes nothing down", async () => {
    const response = await postJson("/auth/code/request", { email: EMAIL });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("這個信箱還不能註冊");

    const { results } = await testEnv().DB.prepare("SELECT id FROM magic_codes").all();
    expect(results).toHaveLength(0);
  });

  it("sends one to an address that is on the list", async () => {
    await allowlist(EMAIL);
    const response = await postJson("/auth/code/request", { email: EMAIL });
    expect(response.status).toBe(200);

    const { results } = await testEnv()
      .DB.prepare("SELECT email, consumed_at FROM magic_codes")
      .all<{ email: string; consumed_at: number | null }>();
    expect(results).toEqual([{ email: EMAIL, consumed_at: null }]);
  });

  it("matches a list entry that somebody typed with capitals", async () => {
    // The rows are hand-written into `wrangler d1 execute`, the request is folded to lower
    // case. A literal comparison would leave a row sitting in the table looking right and
    // matching nothing, and there is no pure test that can see which comparison the SQL does.
    await allowlist("Reader@Example.COM");
    expect((await postJson("/auth/code/request", { email: EMAIL })).status).toBe(200);
  });

  it("says in the log why a send failed, and charges the reader nothing for it", async () => {
    // Both halves of this were wrong in production once (2026-08-09). The log carried a stack
    // and no reason, because the Error reached `console.error` as an argument rather than
    // interpolated into the string; and a letter that never left must not spend the minute's
    // one send or void a code still sitting in an inbox.
    //
    // Set on `env` itself, one property at a time and put back by hand: `env` is a proxy, so a
    // spread of it copies nothing and "restoring" from that snapshot leaves the key set for
    // every test after this one.
    //
    // `MAIL_FROM` is set here too. It used to arrive from `wrangler.jsonc`, which no longer
    // ships one: that file is the self-hosting default now and a sender address is exactly the
    // kind of value that has no right default (see the note in it). Without this the request
    // fails earlier, on "RESEND_API_KEY is set but MAIL_FROM is not", and never reaches the
    // 403 this test is about.
    const running = testEnv();
    const key = running.RESEND_API_KEY;
    const from = running.MAIL_FROM;
    running.RESEND_API_KEY = "key-test";
    running.MAIL_FROM = "Tidemarks <login@example.test>";
    // Resend is answered here rather than over the network. Without this the test reaches the
    // real api.resend.com, which passed for the wrong reason and would fail in a runner with
    // no way out.
    const realFetch = globalThis.fetch;
    const calls = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.resend.com/")) return realFetch(input, init);
      return Promise.resolve(
        new Response('{"message":"The example.test domain is not verified"}', { status: 403 }),
      );
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await allowlist(EMAIL);
      const response = await postJson("/auth/code/request", { email: EMAIL });
      expect(response.status).toBe(502);

      const line = logged.mock.calls.flat().join(" ");
      expect(line).toContain("403");
      expect(line).toContain("not verified");

      const { results } = await testEnv().DB.prepare("SELECT id FROM magic_codes").all();
      expect(results).toHaveLength(0);
    } finally {
      logged.mockRestore();
      calls.mockRestore();
      running.RESEND_API_KEY = key;
      running.MAIL_FROM = from;
    }
  });

  it("refuses to send a second one within the minute, and leaves the first one working", async () => {
    await allowlist(EMAIL);
    await postJson("/auth/code/request", { email: EMAIL });
    const second = await postJson("/auth/code/request", { email: EMAIL });

    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    const { results } = await testEnv()
      .DB.prepare("SELECT consumed_at FROM magic_codes")
      .all<{ consumed_at: number | null }>();
    // One row, still live: a rate-limited request must not void the code already in the inbox.
    expect(results).toEqual([{ consumed_at: null }]);
  });
});

describe("spending a magic code", () => {
  it("creates the account, and a session that /auth/me recognises", async () => {
    await allowlist(EMAIL);
    await plantCode(EMAIL, "123456");

    const response = await postJson("/auth/code/verify", { email: EMAIL, code: "123456" });
    expect(response.status).toBe(200);

    const account = await accountFor(EMAIL);
    expect(account).not.toBeNull();

    const cookie = response.headers.get("set-cookie") ?? "";
    const me = await SELF.fetch("https://folis.test/auth/me", {
      headers: { cookie: cookie.split(";")[0]! },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { userId: string }).userId).toBe(account?.id);
  });

  it("refuses the same code a second time", async () => {
    await allowlist(EMAIL);
    await plantCode(EMAIL, "123456");

    expect((await postJson("/auth/code/verify", { email: EMAIL, code: "123456" })).status).toBe(
      200,
    );
    const replay = await postJson("/auth/code/verify", { email: EMAIL, code: "123456" });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toContain("用過");
  });

  it("voids the code after five wrong guesses, correct one included", async () => {
    await allowlist(EMAIL);
    await plantCode(EMAIL, "123456");

    for (let i = 0; i < 5; i++) {
      expect((await postJson("/auth/code/verify", { email: EMAIL, code: "000000" })).status).toBe(
        400,
      );
    }
    const withTheRightCode = await postJson("/auth/code/verify", { email: EMAIL, code: "123456" });
    expect(withTheRightCode.status).toBe(400);
    expect(await accountFor(EMAIL)).toBeNull();
  });

  it("does not create an account for an address that was never allowed one", async () => {
    // The code cannot get here on its own — but the gate stands at account creation, so this
    // is where it has to hold even if a code did.
    await plantCode(EMAIL, "123456");
    const response = await postJson("/auth/code/verify", { email: EMAIL, code: "123456" });
    expect(response.status).toBe(403);
    expect(await accountFor(EMAIL)).toBeNull();

    // And the refusal costs nothing: spending the code on a request that created no account
    // would lock the address out for a minute for having been told no.
    const row = await testEnv()
      .DB.prepare("SELECT consumed_at FROM magic_codes")
      .first<{ consumed_at: number | null }>();
    expect(row?.consumed_at).toBeNull();
  });
});

describe("an account that exists", () => {
  beforeEach(async () => {
    await testEnv()
      .DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind("u-existing", EMAIL, Date.now())
      .run();
  });

  it("logs in with a code although the address is not on the allowlist", async () => {
    // Taking somebody off the list must not take away data that is already theirs.
    expect((await postJson("/auth/code/request", { email: EMAIL })).status).toBe(200);

    await plantCode(EMAIL, "654321");
    const response = await postJson("/auth/code/verify", { email: EMAIL, code: "654321" });
    expect(response.status).toBe(200);

    const sessions = await testEnv()
      .DB.prepare("SELECT user_id FROM auth_sessions")
      .all<{ user_id: string }>();
    expect(sessions.results.map((s) => s.user_id)).toEqual(["u-existing"]);
  });
});

describe("registering a passkey", () => {
  it("refuses a browser with no session — there is no signup door here any more", async () => {
    const response = await postJson("/auth/register/options", {});
    expect(response.status).toBe(401);
  });
});
