// The magic code's rules, as functions rather than as branches inside a request handler.
//
// Six digits is a small enough space that the rules *are* the security: how long a code lives,
// how many guesses it survives, and how often a new one can be asked for. Every one of them is
// decided here so it can be tested without a database.
//
// See docs/adr/0015-an-account-is-only-as-strong-as-its-inbox.md.

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

/**
 * How often a code may be sent to one address.
 *
 * The per-minute limit is about the inbox (a resend button held down should not post ten
 * letters); the hourly one is about the bill and about using somebody else's address as a
 * mail cannon.
 */
const SEND_LIMITS = [
  { windowMs: 60_000, max: 1 },
  { windowMs: 60 * 60_000, max: 5 },
];

/**
 * How far back a send still counts. Older rows change no answer here, which is what makes them
 * safe for the request handler to delete.
 */
export const RATE_WINDOW_MS = Math.max(...SEND_LIMITS.map((limit) => limit.windowMs));

/**
 * The address as it is stored and compared, or null if it is not an address.
 *
 * Case is folded because nobody thinks of `Reader@` and `reader@` as two accounts. Nothing
 * else is: plus-tags and dots are folded by *some* mail providers and not others, and guessing
 * which is how a login lands in the wrong person's shelf.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  // Deliberately loose — the only real proof an address exists is that the code arrives. This
  // rejects the shapes that could only be a mistake, and requires a dot in the domain so the
  // user ids migration 0003 parked in the email column can never be asked for a code.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/** A fresh six-digit code, uniformly distributed and including the ones that start with 0. */
export function generateCode(): string {
  // Rejection sampling rather than a plain modulo: 2^32 is not a multiple of 10^6, so `% 1e6`
  // alone makes the low codes marginally likelier. The bias is tiny and the fix is two lines.
  const ceiling = 4_294_000_000;
  const buffer = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buffer);
    n = buffer[0]!;
  } while (n >= ceiling);
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * How long the caller has to wait before another code may be sent, in ms; 0 means now.
 *
 * `sentAt` is every send to this address that is still recent enough to matter, in any order.
 */
export function sendRetryAfterMs(sentAt: number[], now: number): number {
  let wait = 0;
  for (const { windowMs, max } of SEND_LIMITS) {
    const inWindow = sentAt.filter((t) => t > now - windowMs).sort((a, b) => a - b);
    if (inWindow.length < max) continue;
    // Room appears when the oldest send that still counts drops out of the window.
    const freeAt = inWindow[inWindow.length - max]! + windowMs;
    wait = Math.max(wait, freeAt - now);
  }
  return wait;
}

export interface MagicCodeRow {
  code_hash: string;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
}

export type CodeVerdict = "ok" | "no-code" | "expired" | "consumed" | "locked" | "mismatch";

/**
 * What to do with the code a reader typed, given the row that was issued for their address.
 *
 * The order of the checks is the interesting part: expiry and the attempt count come before
 * the hash comparison, so a spent code cannot be used to probe and a stale one cannot burn a
 * guess that belonged to a code the reader never got to use.
 */
export function verdictFor(row: MagicCodeRow | null, hash: string, now: number): CodeVerdict {
  if (!row) return "no-code";
  if (row.consumed_at !== null) return "consumed";
  if (row.expires_at <= now) return "expired";
  if (row.attempts >= MAX_ATTEMPTS) return "locked";
  return row.code_hash === hash ? "ok" : "mismatch";
}
