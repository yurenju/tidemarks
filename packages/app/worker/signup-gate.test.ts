// The launch line as a decision: how the one environment variable is read, and who may create
// an account while signup is closed. The gate standing at account creation against real rows,
// with a real allowlist table, is auth.integration.test.ts.
import { describe, expect, it, vi } from "vitest";
import { openSignupFrom, signupDecision } from "./signup-gate";
import { i18nOf } from "./i18n";

// Assertions read the source language, so a failure is a difference in behaviour rather than
// one in translation.
const i18n = i18nOf("en");

describe("openSignupFrom", () => {
  it("is closed when the var is missing, which is the state the repo ships in", () => {
    expect(openSignupFrom(undefined)).toBe(false);
    expect(openSignupFrom("")).toBe(false);
  });

  it("opens only on the one value the docs give", () => {
    expect(openSignupFrom("true")).toBe(true);
  });

  it("stays closed on anything else, including values that look like a yes", () => {
    // This flag is the launch line. Anything ambiguous resolves to the side where nobody
    // else's data has arrived yet, and there is exactly one spelling to get right.
    for (const value of ["false", "0", "1", "yes", "open", "TRUE "]) {
      expect(openSignupFrom(value)).toBe(false);
    }
  });
});

describe("signupDecision while signup is closed", () => {
  it("sends a code to an address that already has an account, listed or not", async () => {
    // Removing somebody from the list must not lock them out of data that is already theirs,
    // so the answer here is the same one an unlisted address would otherwise be refused with.
    const allowlisted = vi.fn().mockResolvedValue(false);
    expect(
      await signupDecision(i18n, { openSignup: false, hasAccount: true }, allowlisted),
    ).toEqual({
      allowed: true,
    });
  });

  it("lets a listed address create an account", async () => {
    const allowlisted = vi.fn().mockResolvedValue(true);
    expect(
      await signupDecision(i18n, { openSignup: false, hasAccount: false }, allowlisted),
    ).toEqual({
      allowed: true,
    });
  });

  it("refuses an unlisted address in plain words", async () => {
    // Plain, not vague: the person typing this address is somebody the maintainer knows, and
    // vagueness would leave them watching an empty inbox.
    const decision = await signupDecision(
      i18n,
      { openSignup: false, hasAccount: false },
      vi.fn().mockResolvedValue(false),
    );
    expect(decision).toEqual({ allowed: false, message: "This address cannot sign up yet" });
  });
});

describe("signupDecision once signup is open", () => {
  it("lets any address in, account or not, whatever the list says about it", async () => {
    // A list nobody maintains once signup is open must not lock anyone out, so a `false` from
    // it changes the answer on neither path.
    const allowlisted = vi.fn().mockResolvedValue(false);
    expect(
      await signupDecision(i18n, { openSignup: true, hasAccount: false }, allowlisted),
    ).toEqual({
      allowed: true,
    });
    expect(await signupDecision(i18n, { openSignup: true, hasAccount: true }, allowlisted)).toEqual(
      { allowed: true },
    );
  });
});
