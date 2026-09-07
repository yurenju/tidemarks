// The two decisions in worker/billing.ts that do not need a network to be wrong: what a
// subscription status means for the quota, and how a signature is read and rebuilt.
//
// The wiring — that a signed request really moves `book_limit`, that a stale one moves nothing —
// is billing.integration.test.ts's, against a real D1.
import { describe, expect, it } from "vitest";
import {
  limitForStatus,
  parsePaddleSignature,
  signatureTimestampFresh,
  signedPayload,
} from "./billing";

describe("what a subscription status is allowed to sync", () => {
  it.each(["active", "trialing"])("lifts the limit while %s", (status) => {
    expect(limitForStatus(status)).toBeNull();
  });

  it.each(["canceled", "paused"])("puts it back to three when %s", (status) => {
    expect(limitForStatus(status)).toBe(3);
  });

  // A card that failed once is not a lapsed subscription. Paddle retries for about a month and
  // only then marks it canceled, and taking books away in between would punish an expiry date
  // (ADR-0011).
  it("leaves the account alone while a payment is being retried", () => {
    expect(limitForStatus("past_due")).toBeUndefined();
  });

  // Statuses arrive that this file has never heard of, from features nobody here turned on. The
  // safe answer is the one that changes nothing.
  it("leaves the account alone for a status it does not know", () => {
    expect(limitForStatus("something_paddle_added_later")).toBeUndefined();
  });
});

describe("reading Paddle's signature header", () => {
  it("splits the timestamp from the digest", () => {
    expect(parsePaddleSignature("ts=1671552777;h1=eb4d0dc8")).toEqual({
      ts: "1671552777",
      h1: "eb4d0dc8",
    });
  });

  it("survives spaces and extra fields Paddle may add", () => {
    expect(parsePaddleSignature("ts=1671552777; h2=future; h1=eb4d0dc8")).toEqual({
      ts: "1671552777",
      h1: "eb4d0dc8",
    });
  });

  it.each([
    ["nothing at all", null],
    ["a header with no digest", "ts=1671552777"],
    ["a header with no timestamp", "h1=eb4d0dc8"],
    // A timestamp that is not a number would go into the signed string as typed and fail the
    // digest anyway, but it would also make the freshness check compare against NaN, which is
    // false for every comparison — including the one that refuses.
    ["a timestamp that is not a number", "ts=yesterday;h1=eb4d0dc8"],
    ["something that is not a header at all", "eb4d0dc8"],
  ])("refuses %s", (_case, header) => {
    expect(parsePaddleSignature(header)).toBeNull();
  });
});

describe("the string Paddle signs", () => {
  // The body goes in exactly as it arrived. Parsing and re-serialising it would reorder keys and
  // drop whitespace, and the digest would never match again.
  it("is the timestamp, a colon, and the raw body", () => {
    expect(signedPayload("1671552777", '{"a":1}')).toBe('1671552777:{"a":1}');
  });
});

describe("how old a signature may be", () => {
  const now = 1_700_000_000_000;
  const seconds = (ms: number) => String(Math.floor(ms / 1000));

  it("accepts one from a moment ago", () => {
    expect(signatureTimestampFresh(seconds(now - 30_000), now)).toBe(true);
  });

  // Both directions, because the clock that is wrong may be either end's.
  it("accepts one stamped slightly in the future", () => {
    expect(signatureTimestampFresh(seconds(now + 60_000), now)).toBe(true);
  });

  it("refuses one from an hour ago", () => {
    expect(signatureTimestampFresh(seconds(now - 3_600_000), now)).toBe(false);
  });
});
