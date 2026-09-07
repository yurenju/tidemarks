// The webhook, running, against a real D1.
//
// billing.test.ts already decides which statuses mean what and how a signature header is read.
// What this covers is everything that only exists once there is a database and a router behind
// it: that `/billing/webhook` is reachable at all, that the columns are the columns the SQL
// names, that a signature is actually required, and that freezing really happens when the limit
// comes back down — the last of which is worker/quota.ts's logic, checked here only for the wire
// between the two.
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { bookLimitOf } from "./auth";
import { handleBilling, type BillingEnv } from "./billing";

const USER = "reader-1";
const SECRET = "test-webhook-secret";

function testEnv(): BillingEnv & { DB: D1Database } {
  return env as unknown as BillingEnv & { DB: D1Database };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A subscription event as Paddle would send it, signed the way Paddle signs it.
 *
 * Built rather than replayed from a captured payload: the signature has to be over the exact
 * bytes of the body, so a fixture and a separately written header would drift the first time
 * anybody edited one of them.
 */
async function send(
  status: string,
  {
    occurredAt = Date.now(),
    userId = USER as string | null,
    secret = SECRET,
    customerId = "ctm_1",
    eventType = "subscription.updated",
  } = {},
) {
  const body = JSON.stringify({
    event_type: eventType,
    occurred_at: new Date(occurredAt).toISOString(),
    data: {
      status,
      customer_id: customerId,
      custom_data: userId ? { userId } : null,
    },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = await hmacHex(secret, `${ts}:${body}`);
  return SELF.fetch("https://tidemarks.test/billing/webhook", {
    method: "POST",
    headers: { "paddle-signature": `ts=${ts};h1=${h1}`, "content-type": "application/json" },
    body,
  });
}

/** A live session for USER, since /billing/checkout is one of the paths that needs one. */
async function sessionCookie() {
  await testEnv()
    .DB.prepare("INSERT OR REPLACE INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind("checkout-session", USER, Date.now() + 3_600_000)
    .run();
  return "tidemarks_session=checkout-session";
}

async function account() {
  return testEnv()
    .DB.prepare("SELECT book_limit, billing_event_at, provider_customer_id FROM users WHERE id = ?")
    .bind(USER)
    .first<{
      book_limit: number | null;
      billing_event_at: number | null;
      provider_customer_id: string | null;
    }>();
}

async function frozenCount() {
  const row = await testEnv()
    .DB.prepare("SELECT COUNT(*) AS n FROM books WHERE user_id = ? AND frozen_at IS NOT NULL")
    .bind(USER)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  const db = testEnv().DB;
  await db.prepare("DELETE FROM books WHERE user_id = ?").bind(USER).run();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  await db
    .prepare("INSERT INTO users (id, email, created_at, book_limit) VALUES (?, ?, ?, 3)")
    .bind(USER, "reader@example.com", Date.now())
    .run();
  // Five books, so that dropping back to three has something to freeze.
  for (let i = 0; i < 5; i += 1) {
    await db
      .prepare(
        `INSERT INTO books (id, user_id, title, author, added_at, client_updated_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?)`,
      )
      .bind(`book-${i}`, USER, `Book ${i}`, i, i, i)
      .run();
  }
});

describe("the subscription webhook", () => {
  it("lifts the limit when Paddle says the subscription is active", async () => {
    const response = await send("active");
    expect(response.status).toBe(200);

    const row = await account();
    expect(row?.book_limit).toBeNull();
    // Written by the webhook rather than by checkout, because this is the first message that
    // carries it — and it is the only thing that opens the customer portal later.
    expect(row?.provider_customer_id).toBe("ctm_1");
    expect(await frozenCount()).toBe(0);
  });

  it("puts it back to three when the subscription is canceled, freezing the rest", async () => {
    await send("active");
    expect(await frozenCount()).toBe(0);

    expect((await send("canceled")).status).toBe(200);
    expect((await account())?.book_limit).toBe(3);
    // Five books, three slots. Nothing is deleted — the two extra are frozen (ADR-0016), which
    // is worker/quota.ts's decision; what is checked here is that the webhook reaches it.
    expect(await frozenCount()).toBe(2);
  });

  // The one case that deserves a 4xx. Everything else Paddle sends gets a 200, because a 4xx
  // makes Paddle retry for a month.
  it("refuses a request that is not signed with this deployment's secret, and writes nothing", async () => {
    await send("active");
    const before = await account();

    const response = await send("canceled", { secret: "somebody-else's-secret" });
    expect(response.status).toBe(401);
    expect(await account()).toEqual(before);
  });

  it("refuses a request with no signature at all", async () => {
    const response = await SELF.fetch("https://tidemarks.test/billing/webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  // Paddle does not promise order. Without the `occurred_at` check a cancellation that took the
  // slow road would undo a renewal that has already gone through.
  it("takes a 200 but changes nothing when the event is older than the last one applied", async () => {
    await send("active", { occurredAt: Date.now() });
    const before = await account();

    const response = await send("canceled", { occurredAt: Date.now() - 60_000 });
    expect(response.status).toBe(200);
    expect(await account()).toEqual(before);
  });

  // A shared Paddle account, or a subscription made against a database that has since been
  // reset. Neither is Paddle's fault, so neither gets a retry.
  it.each([
    // `null` rather than leaving the key out: a default only fills in for a missing value.
    ["carries no user id", { userId: null }],
    ["names an account this deployment has never heard of", { userId: "nobody" }],
  ])("takes a 200 and writes nothing when the event %s", async (_case, options) => {
    const response = await send("active", options);
    expect(response.status).toBe(200);
    expect((await account())?.book_limit).toBe(3);
  });

  // A transaction has a `status` too, it also goes `canceled`, and `custom_data.userId` is set on
  // the transaction in the first place — so a webhook destination subscribed to transaction events
  // (one click in Paddle's dashboard) would otherwise let an abandoned checkout freeze the shelf of
  // somebody who is paying.
  it("ignores an event that is not about a subscription, however its status reads", async () => {
    await send("active");
    const before = await account();

    const response = await send("canceled", { eventType: "transaction.updated" });
    expect(response.status).toBe(200);
    expect(await account()).toEqual(before);
  });

  // Paddle retries a failed renewal for about a month before giving up (ADR-0011), so this
  // status has to leave the account exactly as it was — including the stamp, or the cancellation
  // that eventually follows could be read as older than it.
  it("leaves everything alone while a payment is being retried", async () => {
    await send("active");
    const before = await account();

    expect((await send("past_due")).status).toBe(200);
    expect(await account()).toEqual(before);
  });
});

// A path nobody serves should say so. Answering 401 first would tell an unauthenticated caller to
// log in and try again, for something that will never exist.
it("answers 404 to a billing path that does not exist, without asking for a session", async () => {
  const response = await SELF.fetch("https://tidemarks.test/billing/nonsense");
  expect(response.status).toBe(404);
});

// Paddle's default payment link is one field for a whole account, so an account selling anything
// else has already spent it. Passing the URL per transaction is what makes this deployment's
// checkout page its own business — and getting it wrong sends paying readers to somebody else's
// product page, which no test below would otherwise notice.
describe("where the checkout page is", () => {
  it("names this deployment's own /billing/pay when it creates the transaction", async () => {
    const sent: { url?: string; body?: string } = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.url = String(input);
      sent.body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ data: { checkout: { url: "https://paddle.test/x" } } }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    try {
      await handleBilling(
        new Request("https://tidemarks.test/billing/checkout", {
          method: "POST",
          headers: { cookie: await sessionCookie() },
        }),
        testEnv(),
        "/billing/checkout",
      );
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(sent.url).toContain("/transactions");
    const body = JSON.parse(sent.body!) as { checkout?: { url?: string }; custom_data?: unknown };
    expect(body.checkout?.url).toBe(
      `${(testEnv() as unknown as { ORIGIN: string }).ORIGIN}/billing/pay`,
    );
    // The other half of the same request, and the only thing that later tells the webhook whose
    // account this is.
    expect(body.custom_data).toEqual({ userId: USER });
  });
});

describe("what the Paddle settings being absent means", () => {
  // These two are the whole point of the section, and they are opposites: none of the settings is
  // a way to run Tidemarks, some of them is somebody's unfinished job. Everything below is called
  // directly rather than through SELF, because the settings are bindings and every test in this
  // file shares one set of them — what is being checked is the answer, not the route, and the
  // route is what every test above walks.
  const sellsNothing = () => ({ DB: testEnv().DB }) as unknown as BillingEnv;
  const halfConfigured = () =>
    ({ ...testEnv(), PADDLE_API_URL: undefined }) as unknown as BillingEnv;

  // migration 0007 puts every existing account on the free three, and SQL cannot ask whether
  // this deployment takes payments — so without this, somebody self-hosting without Paddle pulls
  // that migration and finds their shelf cut to three, behind an upgrade button that 404s for
  // ever. The limit and the freezing have to come back together, or the sync push would go on
  // refusing the thawed books.
  it("lifts an existing account's limit and thaws its books", async () => {
    await testEnv().DB.prepare("UPDATE users SET book_limit = 3 WHERE id = ?").bind(USER).run();
    await send("canceled");
    expect(await frozenCount()).toBe(2);

    expect(await bookLimitOf(sellsNothing(), USER)).toBeNull();
    expect(await frozenCount()).toBe(0);
    // Written down, not merely answered: the next reader of the column has to agree, and the
    // books are only thawed because the write happened.
    expect((await account())?.book_limit).toBeNull();
  });

  it.each(["/billing/checkout", "/billing/portal", "/billing/pay"])(
    "answers 404 to %s",
    async (path) => {
      const env = sellsNothing();
      const response = await handleBilling(
        new Request(`https://tidemarks.test${path}`, { method: "POST" }),
        env,
        path,
      );
      expect(response.status).toBe(404);
    },
  );

  // Half configured is somebody's mistake, and the opposite of a choice: it shouts, because this
  // is the only place that can see it (two of the five are secrets, which a build cannot read).
  it("shouts instead when only some of the settings are there", async () => {
    const response = await handleBilling(
      new Request("https://tidemarks.test/billing/checkout", { method: "POST" }),
      halfConfigured(),
      "/billing/checkout",
    );
    expect(response.status).toBe(500);
  });

  // The other half of that distinction, and the one nothing else pins: a broken deployment is not
  // a free one. Simplifying `billingOff` to "any setting missing" passes every other test in this
  // file and quietly hands unlimited books to every account on a deployment whose owner merely
  // forgot a secret.
  it("leaves the quota alone when the settings are only half there", async () => {
    await testEnv().DB.prepare("UPDATE users SET book_limit = 3 WHERE id = ?").bind(USER).run();
    expect(await bookLimitOf(halfConfigured(), USER)).toBe(3);
  });
});
