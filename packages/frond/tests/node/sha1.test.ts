// The bottom of the stack: a hash whose only caller is the obfuscated-font path, checked here
// against an outside implementation because its own callers cannot check it. The callers are in
// epub-book/resources.test.ts, and they would stay green on a wrong hash — see below.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha1 } from "../../src/sha1.ts";

/**
 * The hand-written SHA-1, checked entry by entry against `node:crypto`.
 *
 * The oracle has to be an **independent implementation**, and that matters especially here:
 * the fixture generator creates the obfuscation and the library undoes it, and both sides use
 * the same `sha1()`. If the hash were wrong, both sides would use the same wrong key and
 * cancel each other out — "what comes out equals the original" would still be green, and real
 * books in a reader's hands would be a page full of tofu. Only a third-party implementation
 * guards against that illusion.
 *
 * `node:crypto` appears only in the tests. The `EpubBook` side has zero Node dependencies
 * (ADR-0005).
 */

function expected(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function digest(text: string): string {
  return [...sha1(new TextEncoder().encode(text))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("checked entry by entry against node:crypto", () => {
  const INPUTS = [
    "",
    "a",
    "abc",
    // The lengths 55, 56, 64, 119 and 120 sit exactly on the padding boundaries: from 56 on an
    // extra block is required, and 64 is a whole block. The most typical mistakes in a
    // hand-written implementation land in these cases.
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(63),
    "x".repeat(64),
    "x".repeat(65),
    "x".repeat(119),
    "x".repeat(120),
    "x".repeat(1000),
    // This is the kind of string IDPF's key derivation is fed.
    "urn:uuid:0c4f0b3a-2f5e-4d1a-9f6b-1a2b3c4d5e6f",
    "非 ASCII 的識別碼——UTF-8 編碼之後才雜湊",
  ];

  test.for(INPUTS)("length %#", (input: string) => {
    expect(digest(input)).toBe(expected(input));
  });
});
