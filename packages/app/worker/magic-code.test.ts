// The rules a mailed code lives by, before there is a database: what an address normalises to,
// what a generated code looks like, when the next send is allowed, and the verdict on a stored
// row. The same rules against real D1 rows are auth.integration.test.ts.
import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  generateCode,
  normalizeEmail,
  sendRetryAfterMs,
  verdictFor,
} from "./magic-code";

describe("normalizeEmail", () => {
  it("lowercases and trims, so the same person is the same account", () => {
    expect(normalizeEmail("  Reader@Example.COM ")).toBe("reader@example.com");
  });

  it("leaves the local part otherwise alone", () => {
    // No plus-tag stripping and no dot folding: two addresses the mail provider happens to
    // deliver to one inbox are still two addresses, and guessing which provider does that is
    // how a login lands in the wrong account.
    expect(normalizeEmail("reader+books@example.com")).toBe("reader+books@example.com");
    expect(normalizeEmail("first.last@example.com")).toBe("first.last@example.com");
  });

  it("refuses anything that is not email-shaped", () => {
    for (const bad of ["", "reader", "reader@", "@example.com", "reader@example", "a b@c.com"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("refuses a bare user id, which is what migration 0003 left in the email column", () => {
    expect(normalizeEmail("0d2b8f6e-9d3a-4a1b-9a4e-2f0b3c4d5e6f")).toBeNull();
  });
});

describe("generateCode", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("reaches the whole range, leading zeros included", () => {
    // A code built by multiplying into 100000..999999 would never produce one of these, and
    // "why does it never start with 0" is not a question anyone gets to ask in production.
    const codes = Array.from({ length: 2000 }, generateCode);
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1000);
  });
});

describe("sendRetryAfterMs", () => {
  const NOW = 1_000_000_000_000;

  it("lets the first request through", () => {
    expect(sendRetryAfterMs([], NOW)).toBe(0);
  });

  it("holds the next one for a minute after a send", () => {
    expect(sendRetryAfterMs([NOW - 10_000], NOW)).toBe(50_000);
  });

  it("lets one through again once the minute is up", () => {
    expect(sendRetryAfterMs([NOW - 61_000], NOW)).toBe(0);
  });

  it("holds the sixth request in an hour until the oldest falls out of the window", () => {
    const sends = [
      NOW - 50 * 60_000,
      NOW - 40 * 60_000,
      NOW - 30 * 60_000,
      NOW - 20 * 60_000,
      NOW - 10 * 60_000,
    ];
    // The oldest of the five leaves the window in ten minutes; that is when there is room.
    expect(sendRetryAfterMs(sends, NOW)).toBe(10 * 60_000);
  });

  it("ignores sends that are already outside every window", () => {
    const sends = Array.from({ length: 20 }, (_, i) => NOW - (2 + i) * 3_600_000);
    expect(sendRetryAfterMs(sends, NOW)).toBe(0);
  });

  it("reports the longest wait when both limits bite", () => {
    const sends = [
      NOW - 50 * 60_000,
      NOW - 40 * 60_000,
      NOW - 30 * 60_000,
      NOW - 20 * 60_000,
      NOW - 1_000,
    ];
    // The per-minute limit frees up in 59s, the hourly one in 10 minutes. The answer is the
    // one that actually keeps the caller waiting.
    expect(sendRetryAfterMs(sends, NOW)).toBe(10 * 60_000);
  });
});

describe("verdictFor", () => {
  const NOW = 1_000_000_000_000;
  const HASH = "the-hash-of-the-code-that-was-sent";
  const row = (over: Partial<Parameters<typeof verdictFor>[0]> = {}) => ({
    code_hash: HASH,
    expires_at: NOW + CODE_TTL_MS,
    attempts: 0,
    consumed_at: null,
    ...over,
  });

  it("accepts the code it sent", () => {
    expect(verdictFor(row(), HASH, NOW)).toBe("ok");
  });

  it("rejects a code that was never issued", () => {
    expect(verdictFor(null, HASH, NOW)).toBe("no-code");
  });

  it("rejects the right code after it expired", () => {
    expect(verdictFor(row({ expires_at: NOW - 1 }), HASH, NOW)).toBe("expired");
  });

  it("rejects the right code a second time", () => {
    expect(verdictFor(row({ consumed_at: NOW - 1_000 }), HASH, NOW)).toBe("consumed");
  });

  it("stops accepting anything once the attempts are spent", () => {
    // Including the correct code: five wrong guesses void the code, they do not merely
    // pause it. Otherwise six digits are guessable inside the ten minutes.
    expect(verdictFor(row({ attempts: MAX_ATTEMPTS }), HASH, NOW)).toBe("locked");
    expect(verdictFor(row({ attempts: MAX_ATTEMPTS }), "wrong", NOW)).toBe("locked");
  });

  it("counts a wrong guess as a wrong guess while tries remain", () => {
    expect(verdictFor(row({ attempts: MAX_ATTEMPTS - 1 }), "wrong", NOW)).toBe("mismatch");
  });

  it("checks expiry before the hash, so a stale code cannot burn an attempt", () => {
    expect(verdictFor(row({ expires_at: NOW - 1 }), "wrong", NOW)).toBe("expired");
  });
});
