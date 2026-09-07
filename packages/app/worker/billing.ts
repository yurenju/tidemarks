// Everything Paddle. Signature checking, the status-to-quota mapping and every Paddle URL are
// shut in this one file: changing payment providers should mean rewriting this and nothing else.
//
// The shape of it (ADR-0049): Paddle is a merchant of record, so it — not Tidemarks — sells the
// subscription, charges the card, and files the tax. The truth about who is subscribed lives
// over there and D1 keeps a mirror that the webhook updates (CONTEXT.md, on subscriptions). The
// mirror runs a few seconds behind, which is why the account pane re-reads `/auth/me` after a
// checkout instead of believing the redirect.
//
// **Five settings, all or nothing.** With none of them set this deployment does not sell
// anything: every path here answers 404, and its accounts have no quota at all — `bookLimitOf`
// in worker/auth.ts asks `billingOff` every time it is called, so that holds for accounts made
// before the settings were touched as well as after. Some of them is a mistake rather than a
// choice, and it is caught in two places because no one place can see all five — the three build
// variables stop the deploy (`paddleSettingsError` in scripts/deploy-config.ts), and the two
// secrets, which a build cannot read back, are caught here.
import { FREE_BOOKS, json, sessionUserId, type Env } from "./auth";
import { i18nFor } from "./i18n";
import { setBookLimit } from "./quota";

/**
 * How stale a webhook's own timestamp may be before the signature is refused.
 *
 * This is a replay window, not a latency budget — Paddle's "respond within five seconds" is
 * about our reply, not about how old their signature may be. Five seconds here would refuse
 * perfectly good webhooks whenever the network or either clock is off by that much, and the
 * refusal would only ever show up while a real person was paying.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export interface BillingEnv extends Env {
  // Secrets (`wrangler secret put`).
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  // Build variables. The client token is public — it is printed into the checkout page below.
  PADDLE_PRICE_ID?: string;
  PADDLE_API_URL?: string;
  PADDLE_CLIENT_TOKEN?: string;
}

interface PaddleConfig {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
  priceId: string;
  clientToken: string;
}

/**
 * The five settings, or the names of the ones that are not there.
 *
 * All five missing and some of them missing mean opposite things and get opposite answers:
 * selling nothing is a supported way to run Tidemarks and gets a quiet 404, while a half-filled
 * deployment is a mistake nobody has noticed yet. The caller tells them apart by counting.
 */
function paddleConfig(env: BillingEnv): PaddleConfig | { missing: string[] } {
  const values = {
    PADDLE_API_URL: env.PADDLE_API_URL?.trim(),
    PADDLE_API_KEY: env.PADDLE_API_KEY?.trim(),
    PADDLE_WEBHOOK_SECRET: env.PADDLE_WEBHOOK_SECRET?.trim(),
    PADDLE_PRICE_ID: env.PADDLE_PRICE_ID?.trim(),
    PADDLE_CLIENT_TOKEN: env.PADDLE_CLIENT_TOKEN?.trim(),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return { missing };
  return {
    apiUrl: values.PADDLE_API_URL!.replace(/\/$/, ""),
    apiKey: values.PADDLE_API_KEY!,
    webhookSecret: values.PADDLE_WEBHOOK_SECRET!,
    priceId: values.PADDLE_PRICE_ID!,
    clientToken: values.PADDLE_CLIENT_TOKEN!,
  };
}

/** How many settings there are, so that "none of them" can be told from "some of them". */
const PADDLE_SETTING_COUNT = 5;

// --- pure halves, so the parts that decide anything are testable without a network ---

/**
 * What a subscription in this state is allowed to sync, or `undefined` to leave the account
 * alone.
 *
 * **Read from `status`, never from the event name.** Paddle sends several event types for the
 * same subscription and does not promise an order, so `subscription.canceled` arriving after a
 * later `subscription.updated` would otherwise cancel an account that is paying. A status is a
 * fact about now; an event name is a fact about a moment.
 *
 * `past_due` deliberately changes nothing. Paddle retries a failed renewal for about a month
 * and only then gives up and marks it `canceled` — taking books away on the first failed card
 * would punish an expired card rather than a lapsed subscription (ADR-0011).
 */
export function limitForStatus(status: string): number | null | undefined {
  if (status === "active" || status === "trialing") return null;
  if (status === "canceled" || status === "paused") return FREE_BOOKS;
  return undefined;
}

/** What Paddle signs: the timestamp, a colon, and the raw request body, byte for byte. */
export function signedPayload(timestamp: string, body: string): string {
  return `${timestamp}:${body}`;
}

/** `ts=1671552777;h1=eb4d…` split into its two halves, or null if it is not that shape. */
export function parsePaddleSignature(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  const parts = new Map(
    header.split(";").map((part) => {
      const at = part.indexOf("=");
      return at === -1 ? ["", ""] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }),
  );
  const ts = parts.get("ts");
  const h1 = parts.get("h1");
  if (!ts || !h1 || !/^\d+$/.test(ts)) return null;
  return { ts, h1 };
}

/** Paddle stamps `ts` in whole seconds. */
export function signatureTimestampFresh(ts: string, now: number): boolean {
  return Math.abs(now - Number(ts) * 1000) <= SIGNATURE_MAX_AGE_MS;
}

// --- routing ---

export async function handleBilling(
  request: Request,
  env: BillingEnv,
  path: string,
): Promise<Response> {
  const config = paddleConfig(env);
  if ("missing" in config) {
    // Not 503 for the "sells nothing" case: that deployment has no billing endpoints at all, and
    // "temporarily unavailable" would invite a retry that can never work.
    if (config.missing.length === PADDLE_SETTING_COUNT)
      return json({ error: "not found" }, { status: 404 });
    // Half configured, which is somebody's mistake rather than somebody's choice. It is said out
    // loud here because this is the only place that can see it: two of the five are secrets, and
    // a build environment cannot read those back (scripts/deploy-config.ts).
    console.error(`billing is half configured; these are not set: ${config.missing.join(", ")}`);
    return json({ error: "billing is misconfigured" }, { status: 500 });
  }

  // Neither of these carries a session, and neither needs one. The webhook comes from Paddle and
  // proves itself with a signature; the checkout page comes from a redirect that browsers do not
  // attach cookies to, and the transaction id in its query string is the whole credential.
  if (path === "/billing/webhook" && request.method === "POST")
    return handleWebhook(request, env, config);
  if (path === "/billing/pay" && request.method === "GET") return payPage(request, config);

  // The rest need a session, and the 404 is decided before it: a path nobody serves should say
  // so, not ask the caller to log in first and then say so.
  const signedIn =
    (path === "/billing/checkout" && request.method === "POST") ||
    (path === "/billing/portal" && request.method === "GET");
  if (!signedIn) return json({ error: "not found" }, { status: 404 });

  const userId = await sessionUserId(env, request);
  if (!userId) return json({ error: "unauthenticated" }, { status: 401 });

  if (path === "/billing/checkout") return handleCheckout(config, userId);
  return handlePortal(env, config, userId);
}

async function paddle(
  config: PaddleConfig,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { detail?: string };
  } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(
      `Paddle answered ${response.status} to ${path}: ${payload?.error?.detail ?? "no detail"}`,
    );
  }
  return payload.data;
}

// --- checkout ---

/**
 * A transaction with the reader's id attached, and the URL that opens it.
 *
 * `custom_data` is how the webhook later knows whose account this is: Paddle copies it from the
 * transaction onto the subscription it creates, so it survives every renewal and cancellation
 * afterwards. Nothing else in the flow carries the user id — Paddle's customer record is made by
 * Paddle, from an address the reader types into Paddle's own form.
 *
 * The URL that comes back is this deployment's own `/billing/pay` with `?_ptxn=<id>` on it, and
 * that is not a redundant hop: Paddle only opens a checkout from a page running Paddle.js, and
 * the fully hosted alternative is not available to us (ADR-0049).
 */
async function handleCheckout(config: PaddleConfig, userId: string): Promise<Response> {
  try {
    const data = await paddle(config, "/transactions", {
      items: [{ price_id: config.priceId, quantity: 1 }],
      custom_data: { userId },
    });
    const url = (data.checkout as { url?: string } | undefined)?.url;
    if (!url) throw new Error("the transaction came back without a checkout url");
    return json({ url });
  } catch (e) {
    console.error(`opening a checkout failed: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "checkout unavailable" }, { status: 502 });
  }
}

/**
 * Where cancelling, the card and the invoices live — all of it Paddle's, none of it ours.
 *
 * The URL is a one-off with a token in it, so it is redirected to and never stored. A reader who
 * has never completed a checkout has no customer id yet and nothing to manage.
 */
async function handlePortal(
  env: BillingEnv,
  config: PaddleConfig,
  userId: string,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT provider_customer_id FROM users WHERE id = ?")
    .bind(userId)
    .first<{ provider_customer_id: string | null }>();
  const customerId = row?.provider_customer_id;
  if (!customerId) return json({ error: "no subscription" }, { status: 404 });

  try {
    const data = await paddle(config, `/customers/${customerId}/portal-sessions`, {});
    const overview = (data.urls as { general?: { overview?: string } } | undefined)?.general
      ?.overview;
    if (!overview) throw new Error("the portal session came back without an overview url");
    return Response.redirect(overview, 302);
  } catch (e) {
    console.error(
      `opening the customer portal failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return json({ error: "portal unavailable" }, { status: 502 });
  }
}

// --- webhook ---

interface SubscriptionEvent {
  event_type?: string;
  occurred_at?: string;
  data?: {
    status?: string;
    customer_id?: string;
    custom_data?: { userId?: string } | null;
  };
}

/**
 * Paddle's word on a subscription, applied to the account it names.
 *
 * Three kinds of request get a 200 with nothing written: an event we do not act on, an event
 * older than the one already applied, and an event naming an account this deployment has never
 * heard of. All three are normal — a shared Paddle account, a retry that overtook its original,
 * a subscription made against a database that has since been reset — and answering 4xx to any of
 * them would make Paddle retry for a month. **A 4xx here means one thing: this was not Paddle.**
 */
async function handleWebhook(
  request: Request,
  env: BillingEnv,
  config: PaddleConfig,
): Promise<Response> {
  const body = await request.text();
  const signature = parsePaddleSignature(request.headers.get("paddle-signature"));
  if (!signature) return json({ error: "unsigned" }, { status: 401 });
  if (!signatureTimestampFresh(signature.ts, Date.now()))
    return json({ error: "stale signature" }, { status: 401 });
  if (!(await signatureMatches(config.webhookSecret, signature, body)))
    return json({ error: "bad signature" }, { status: 401 });

  const event = JSON.parse(body) as SubscriptionEvent;
  // **Subscription events only**, checked before the status is read. "Read the status, not the
  // event name" is about choosing between `subscription.updated` and `subscription.canceled`; it
  // was never meant to make this blind to what kind of object arrived. A *transaction* also has
  // a `status`, also goes `canceled`, and also carries `custom_data.userId` — it is where the id
  // is set in the first place — so an abandoned checkout would otherwise read as a cancelled
  // subscription and freeze the shelf of somebody who is paying. Subscribing to transaction
  // events is one click in Paddle's dashboard.
  if (!event.event_type?.startsWith("subscription.")) {
    console.log(`billing: ignoring ${event.event_type ?? "an event"}, which is not a subscription`);
    return json({ ok: true });
  }
  const status = event.data?.status;
  const limit = status ? limitForStatus(status) : undefined;
  if (limit === undefined) {
    console.log(
      `billing: ignoring ${event.event_type ?? "an event"} in status ${status ?? "none"}`,
    );
    return json({ ok: true });
  }

  const userId = event.data?.custom_data?.userId;
  if (!userId) {
    console.log(`billing: ${event.event_type ?? "an event"} carried no userId`);
    return json({ ok: true });
  }

  const occurredAt = Date.parse(event.occurred_at ?? "");
  if (Number.isNaN(occurredAt)) {
    console.log(`billing: ${event.event_type ?? "an event"} carried no usable occurred_at`);
    return json({ ok: true });
  }

  const seen = await env.DB.prepare("SELECT billing_event_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ billing_event_at: number | null }>();
  if (!seen) {
    console.log(`billing: ${userId} is not an account on this deployment`);
    return json({ ok: true });
  }
  if (seen.billing_event_at !== null && seen.billing_event_at >= occurredAt) {
    console.log(`billing: ${userId} has already applied a newer event than this one`);
    return json({ ok: true });
  }

  // **The stamp goes in the same batch as the quota, not before it.** Written first, a quota
  // write that then failed would be unrepeatable: Paddle retries with the same `occurred_at`,
  // the guard would see its own stamp and drop the retry, and a reader who paid would stay on
  // three books with the log claiming the event was old news.
  //
  // The guard is repeated inside the statement so the stamp itself can only move forward.
  //
  // ponytail: the read above and this batch are not one transaction, so two events for the same
  // subscription arriving in the same second could still apply in either order. They arrive
  // seconds apart in practice, and closing it means a D1 transaction around a function that
  // already batches. Revisit if a real out-of-order pair ever shows up in the log.
  await setBookLimit(env, userId, limit, [
    env.DB.prepare(
      `UPDATE users SET billing_event_at = ?1, provider_customer_id = COALESCE(?2, provider_customer_id)
       WHERE id = ?3 AND (billing_event_at IS NULL OR billing_event_at < ?1)`,
    ).bind(occurredAt, event.data?.customer_id ?? null, userId),
  ]);
  return json({ ok: true });
}

async function signatureMatches(
  secret: string,
  signature: { ts: string; h1: string },
  body: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload(signature.ts, body)),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signature.h1.toLowerCase());
}

/** Constant time in the length the two share, so a forged digest cannot be found one nibble at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// --- the checkout page ---

/**
 * The one page in Tidemarks that loads somebody else's script.
 *
 * Paddle calls this the default payment link: every checkout it opens, from anywhere, comes back
 * through here with `?_ptxn=<transaction id>`, and Paddle.js reads that parameter and opens the
 * overlay. There is no way round it for an account like this one (ADR-0049).
 *
 * ⚠️ **Same origin as the app**, so Paddle.js can reach the reader's IndexedDB and call the API
 * with their session, exactly as any script on any page of this origin could. A separate hostname
 * would be a real boundary and this one is not; the cost is written down in ADR-0049.
 *
 * The line of text is the only thing here that is not Paddle's. If Paddle.js fails to load, this
 * page has no other content — and a reader who has just pressed "upgrade" would be looking at a
 * blank page wondering whether their card was charged.
 */
function payPage(request: Request, config: PaddleConfig): Response {
  const i18n = i18nFor(request);
  const opening = i18n._({
    id: "billing.pay.opening",
    message: "Opening the checkout…",
    comment:
      "The only line on the page that hands the reader over to Paddle's checkout window. It is what they see if Paddle's script fails to load, so it says what is happening rather than merely spinning. The ellipsis is one character.",
  });
  // Sandbox and production differ in this one value and nothing else, so the page derives which
  // Paddle it is talking to from the API URL rather than carrying a flag of its own.
  const environment = config.apiUrl.includes("sandbox") ? "sandbox" : "production";
  const successUrl = new URL("/#/settings/account", request.url).toString();

  const html = `<!doctype html>
<html lang="${i18n.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidemarks</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2rem 1.25rem; line-height: 1.7; text-align: center;
    font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
  }
</style>
</head>
<body>
<p>${escapeHtml(opening)}</p>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
  Paddle.Environment.set(${JSON.stringify(environment)});
  Paddle.Initialize({
    token: ${JSON.stringify(config.clientToken)},
    checkout: { settings: { successUrl: ${JSON.stringify(successUrl)} } }
  });
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

/**
 * Whether this deployment sells nothing at all, for the one caller outside this file.
 *
 * **Not "billing does not work".** A half-configured deployment is broken, not free: an upgrade
 * button that cannot work is still the right thing to show somebody whose deployment is meant to
 * sell, because the fix is to finish configuring it. Only a deployment that deliberately sells
 * nothing gives its accounts no quota (worker/auth.ts, ADR-0016).
 */
export function billingOff(env: BillingEnv): boolean {
  const config = paddleConfig(env);
  return "missing" in config && config.missing.length === PADDLE_SETTING_COUNT;
}
