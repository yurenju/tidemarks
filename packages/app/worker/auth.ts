// Sessions, and the two doors that open one: a passkey, or a code mailed to the address the
// account is named by. Neither is the main one — see
// docs/adr/0015-an-account-is-only-as-strong-as-its-inbox.md.
//
// A new account can only come in through the mailed code; a passkey is added afterwards, from
// a session. That is why registration here always has a session behind it.
//
// Challenges live in an AES-GCM encrypted cookie, not KV: a challenge is
// written and read back once within seconds and must be atomic, which is the
// worst possible KV use case (eventual consistency across POPs). The cookie
// carries a `purpose` field so a registration challenge can never be replayed
// into a login ceremony.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { magicCodeMail, loginNoticeMail, sendMail } from "./email";
import {
  CODE_TTL_MS,
  RATE_WINDOW_MS,
  generateCode,
  normalizeEmail,
  sendRetryAfterMs,
  verdictFor,
  type CodeVerdict,
  type MagicCodeRow,
} from "./magic-code";
import { rpIdMismatchMessage } from "./rp-id";
import { openSignupFrom, signupDecision } from "./signup-gate";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  RP_ID: string;
  ORIGIN: string;
  COOKIE_SECRET: string;
  // Unset means the allowlist is in force; see worker/signup-gate.ts.
  OPEN_SIGNUP?: string;
  // Unset means magic codes go to the log instead of an inbox; see worker/email.ts.
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

const SESSION_COOKIE = "tidemarks_session";
const CHALLENGE_COOKIE = "tidemarks_challenge";
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = "Tidemarks";

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

/**
 * What went wrong, as a string, for the log.
 *
 * Handing the Error itself to `console.error` as a second argument loses this: the log pipeline
 * renders the object as its stack and drops the `Error: <message>` line, so what arrives is a
 * stack trace with no reason attached — two frames pointing into a bundle, which is exactly no
 * information. That happened in production the first time a mail send failed, and cost a
 * deploy to find out which of two throws it had been. **One interpolated string, always.**
 */
function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A refusal naming both hostnames when this deployment's RP_ID has nothing to do with the host
 * the request arrived on, or null when it has. See worker/rp-id.ts for the rule.
 *
 * **Only the two `options` endpoints call this, and the `verify` ones must not.** A wrong RP ID
 * stops the ceremony inside the browser, before any credential exists to send back, so `verify`
 * is never reached on this path: a check there would be unreachable code that reads like the
 * real defence. `options` is the last moment we can still answer in words.
 *
 * Magic codes are untouched by design (ADR-0030): when RP_ID is wrong, `/auth/code/*` is the
 * only remaining way into your own deployment.
 */
function rpIdRefusal(request: Request, env: Env): Response | null {
  const message = rpIdMismatchMessage(env.RP_ID, new URL(request.url).hostname);
  return message ? json({ error: message }, { status: 400 }) : null;
}

// --- cookies ---

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function cookie(name: string, value: string, maxAgeSec: number, sameSite: "Strict" | "Lax") {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAgeSec}`;
}

// --- challenge cookie crypto (AES-GCM via Web Crypto) ---

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return bytes;
}

async function cookieKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.COOKIE_SECRET));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

interface ChallengePayload {
  challenge: string;
  purpose: "register" | "login";
  // set when registering: the user the credential will belong to
  userId?: string;
  exp: number;
}

async function sealChallenge(env: Env, payload: ChallengePayload): Promise<string> {
  const key = await cookieKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out);
}

async function openChallenge(
  env: Env,
  request: Request,
  purpose: ChallengePayload["purpose"],
): Promise<ChallengePayload | null> {
  const raw = parseCookies(request)[CHALLENGE_COOKIE];
  if (!raw) return null;
  try {
    const bytes = fromB64url(raw);
    const key = await cookieKey(env);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    const payload = JSON.parse(new TextDecoder().decode(pt)) as ChallengePayload;
    if (payload.purpose !== purpose || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function challengeSetCookie(sealed: string): string {
  return cookie(CHALLENGE_COOKIE, sealed, CHALLENGE_TTL_MS / 1000, "Strict");
}

function clearChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

// --- sessions ---

export async function sessionUserId(env: Env, request: Request): Promise<string | null> {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (!id) return null;
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM auth_sessions WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

async function createSession(env: Env, userId: string): Promise<string> {
  const id = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, Date.now() + SESSION_TTL_MS)
    .run();
  // SameSite=Lax (not Strict): phase 2's OAuth redirect returns cross-site
  return cookie(SESSION_COOKIE, id, SESSION_TTL_MS / 1000, "Lax");
}

// --- magic codes ---

// A plain digest of six digits is reversible by anyone willing to try a million inputs, so this
// is not what keeps a stolen database from yielding live codes. Nothing does: whoever can read
// `magic_codes` can read `auth_sessions` next to it and skip the login entirely. What the
// column buys is that the code is not sitting in the clear in a query result or a backup, and
// the real defences are elsewhere — ten minutes, five guesses, one use.
async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function userIdForEmail(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Whether this address may create an account while signup is closed.
 *
 * `lower(email)` because the rows are typed by hand into `wrangler d1 execute`, while the
 * address arriving in a request has already been folded by `normalizeEmail`. Comparing
 * literally would let a capitalised row sit in the table looking correct and matching nothing.
 */
async function isAllowlisted(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT email FROM signup_allowlist WHERE lower(email) = ?")
    .bind(email)
    .first<{ email: string }>();
  return row !== null;
}

/** The gate, with the two things it asks the database for filled in. */
function decideSignup(env: Env, email: string, hasAccount: boolean) {
  return signupDecision({ openSignup: openSignupFrom(env.OPEN_SIGNUP), hasAccount }, () =>
    isAllowlisted(env, email),
  );
}

const VERDICT_MESSAGE: Record<Exclude<CodeVerdict, "ok">, string> = {
  "no-code": "請先要一組登入碼",
  expired: "登入碼過期了，請重新要一組",
  consumed: "這組登入碼已經用過了",
  locked: "錯太多次，這組登入碼作廢了，請重新要一組",
  mismatch: "登入碼不正確",
};

// --- handlers ---

interface StoredCredential {
  id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
}

export async function handleAuth(
  request: Request,
  env: Env,
  path: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method === "GET" && path === "/auth/me") {
    const userId = await sessionUserId(env, request);
    return userId ? json({ userId }) : json({ error: "unauthenticated" }, { status: 401 });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  switch (path) {
    case "/auth/register/options":
      return registerOptions(request, env);
    case "/auth/register/verify":
      return registerVerify(request, env);
    case "/auth/login/options":
      return loginOptions(request, env);
    case "/auth/login/verify":
      return loginVerify(request, env);
    case "/auth/code/request":
      return requestMagicCode(request, env);
    case "/auth/code/verify":
      return verifyMagicCode(request, env, ctx);
    case "/auth/logout":
      return logout(request, env);
    default:
      return json({ error: "not found" }, { status: 404 });
  }
}

async function registerOptions(request: Request, env: Env): Promise<Response> {
  // Before the session, because this one is about the deployment rather than the caller: a
  // passkey registered here would be scoped to a hostname this deployment is not served from,
  // and no session makes that work.
  const misconfigured = rpIdRefusal(request, env);
  if (misconfigured) return misconfigured;

  // Always an existing session: an account is created by the mailed code, and a passkey is
  // something it grows afterwards. There is no longer a door here for a stranger to knock on.
  const userId = await sessionUserId(env, request);
  if (!userId) return json({ error: "unauthenticated" }, { status: 401 });

  const [user, existing] = await Promise.all([
    env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>(),
    env.DB.prepare("SELECT id, transports FROM credentials WHERE user_id = ?")
      .bind(userId)
      .all<{ id: string; transports: string | null }>(),
  ]);
  if (!user) return json({ error: "unauthenticated" }, { status: 401 });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: env.RP_ID,
    // The address, so the passkey shows up in the authenticator's list as this account rather
    // than as an anonymous "Tidemarks" indistinguishable from every other Tidemarks account.
    userName: user.email,
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: existing.results.map((c) => ({
      id: c.id,
      transports: (c.transports ? JSON.parse(c.transports) : undefined) as
        AuthenticatorTransportFuture[] | undefined,
    })),
  });

  const sealed = await sealChallenge(env, {
    challenge: options.challenge,
    purpose: "register",
    userId,
    exp: Date.now() + CHALLENGE_TTL_MS,
  });
  return json(options, { headers: { "set-cookie": challengeSetCookie(sealed) } });
}

async function registerVerify(request: Request, env: Env): Promise<Response> {
  const payload = await openChallenge(env, request, "register");
  if (!payload?.userId) return json({ error: "challenge 過期，請重試" }, { status: 400 });

  const body = (await request.json()) as RegistrationResponseJSON;
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: payload.challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "驗證失敗" }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: "驗證失敗" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  await env.DB.prepare(
    "INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      credential.id,
      payload.userId,
      credential.publicKey.buffer as ArrayBuffer,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
    )
    .run();

  return json({ ok: true }, { headers: { "set-cookie": clearChallengeCookie() } });
}

async function loginOptions(request: Request, env: Env): Promise<Response> {
  const misconfigured = rpIdRefusal(request, env);
  if (misconfigured) return misconfigured;

  // discoverable credentials: no allowCredentials, the authenticator picks
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "preferred",
  });
  const sealed = await sealChallenge(env, {
    challenge: options.challenge,
    purpose: "login",
    exp: Date.now() + CHALLENGE_TTL_MS,
  });
  return json(options, { headers: { "set-cookie": challengeSetCookie(sealed) } });
}

async function loginVerify(request: Request, env: Env): Promise<Response> {
  const payload = await openChallenge(env, request, "login");
  if (!payload) return json({ error: "challenge 過期，請重試" }, { status: 400 });

  const body = (await request.json()) as AuthenticationResponseJSON;
  const cred = await env.DB.prepare("SELECT * FROM credentials WHERE id = ?")
    .bind(body.id)
    .first<StoredCredential>();
  if (!cred) return json({ error: "找不到這把 passkey" }, { status: 400 });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: payload.challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.public_key),
        counter: cred.counter,
        transports: (cred.transports ? JSON.parse(cred.transports) : undefined) as
          AuthenticatorTransportFuture[] | undefined,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "驗證失敗" }, { status: 400 });
  }
  if (!verification.verified) return json({ error: "驗證失敗" }, { status: 400 });

  await env.DB.prepare("UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, Date.now(), cred.id)
    .run();

  const sessionCookie = await createSession(env, cred.user_id);
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", sessionCookie);
  headers.append("set-cookie", clearChallengeCookie());
  return new Response(JSON.stringify({ ok: true }), { headers });
}

/**
 * Mail a magic code to one address.
 *
 * The reply is the same whether the address has an account or not: this endpoint is the only
 * one a stranger can reach, so anything it varies on is a way to ask Tidemarks who its readers
 * are. The one exception is the refusal while the allowlist is in force, which is deliberate
 * and goes away at launch (see worker/signup-gate.ts).
 */
async function requestMagicCode(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = normalizeEmail(body.email ?? "");
  if (!email) return json({ error: "請輸入 email" }, { status: 400 });

  const hasAccount = (await userIdForEmail(env, email)) !== null;
  const decision = await decideSignup(env, email, hasAccount);
  // Refused before anything is written, so an address nobody is going to mail leaves no trace.
  if (!decision.allowed) return json({ error: decision.message }, { status: 403 });

  const now = Date.now();
  const recent = await env.DB.prepare(
    "SELECT created_at FROM magic_codes WHERE email = ? AND created_at > ?",
  )
    .bind(email, now - RATE_WINDOW_MS)
    .all<{ created_at: number }>();
  const retryAfterMs = sendRetryAfterMs(
    recent.results.map((r) => r.created_at),
    now,
  );
  if (retryAfterMs > 0) {
    const seconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: `登入碼剛寄出去過，請 ${seconds} 秒後再試` },
      { status: 429, headers: { "retry-after": String(seconds) } },
    );
  }

  // Sent before anything is written, so that a provider outage costs the reader nothing: no
  // rate-limit slot spent on a letter that never left, and — the one that actually bites — the
  // code already in their inbox is still the code that works. Writing first and undoing on
  // failure cannot restore that, because voiding the previous code is not undoable.
  //
  // The other order of that trade is a code in an inbox that D1 does not know about, if the
  // write below fails after the letter is away. The reader asks again; nobody is locked out.
  const code = generateCode();
  try {
    await sendMail(env, email, magicCodeMail(code));
  } catch (e) {
    console.error(`sending a magic code failed: ${reason(e)}`);
    return json({ error: "寄不出登入碼，請稍後再試" }, { status: 502 });
  }

  await env.DB.batch([
    // Rows older than the longest rate-limit window change no answer any more; keeping them
    // would grow one table forever for nothing.
    env.DB.prepare("DELETE FROM magic_codes WHERE email = ? AND created_at <= ?").bind(
      email,
      now - RATE_WINDOW_MS,
    ),
    // A new code voids the one before it, so two letters in an inbox never means two working
    // codes.
    env.DB.prepare(
      "UPDATE magic_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL",
    ).bind(now, email),
    env.DB.prepare(
      "INSERT INTO magic_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), email, await sha256hex(code), now, now + CODE_TTL_MS),
  ]);
  return json({ ok: true });
}

/** Spend a magic code: a session, and an account first if this address has not got one. */
async function verifyMagicCode(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = normalizeEmail(body.email ?? "");
  // Spaces because a code read off a phone gets pasted with whatever came with it.
  const code = (body.code ?? "").replace(/\s/g, "");
  if (!email || !code) return json({ error: "請輸入 email 與登入碼" }, { status: 400 });

  const now = Date.now();
  const row = await env.DB.prepare(
    // `rowid` breaks the tie: two rows for one address can share a millisecond, and picking
    // the older of them hands the reader "already used" for the code that just arrived.
    `SELECT id, code_hash, expires_at, attempts, consumed_at FROM magic_codes
     WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  )
    .bind(email)
    .first<MagicCodeRow & { id: string }>();
  if (!row) return json({ error: VERDICT_MESSAGE["no-code"] }, { status: 400 });

  const verdict = verdictFor(row, await sha256hex(code), now);
  if (verdict === "mismatch") {
    await env.DB.prepare("UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
  }
  if (verdict !== "ok") return json({ error: VERDICT_MESSAGE[verdict] }, { status: 400 });

  // The gate is asked again here, not carried over from the request that mailed the code: this
  // is the moment an account starts existing, and ten minutes is long enough for the answer to
  // have changed. It runs *before* the code is spent, so a refusal costs the reader nothing —
  // burning a live code on a request that created nothing would lock a de-listed address out
  // for a minute for no reason.
  const existing = await userIdForEmail(env, email);
  const decision = await decideSignup(env, email, existing !== null);
  if (!decision.allowed) return json({ error: decision.message }, { status: 403 });

  // Single use, decided by the database rather than by the check above: two requests carrying
  // the same code can both pass `verdictFor`, and only one of them changes a row here.
  const spent = await env.DB.prepare(
    "UPDATE magic_codes SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL",
  )
    .bind(now, row.id)
    .run();
  if (spent.meta.changes !== 1) return json({ error: VERDICT_MESSAGE.consumed }, { status: 400 });

  let userId = existing;
  if (!userId) {
    userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, email, now)
      .run();
  }

  // The notice is the only way a reader finds out somebody else read their inbox, but it is
  // not worth failing a login that already succeeded — so it goes out after the response.
  const notice = sendMail(env, email, loginNoticeMail()).catch((e: unknown) => {
    console.error(`sending the login notice failed: ${reason(e)}`);
  });
  if (ctx) ctx.waitUntil(notice);
  else await notice;

  const sessionCookie = await createSession(env, userId);
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie } });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (id) await env.DB.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(id).run();
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}
