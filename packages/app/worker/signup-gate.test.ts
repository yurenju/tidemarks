import { describe, expect, it, vi } from "vitest";
import { openSignupFrom, signupDecision } from "./signup-gate";

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
  it("sends a code to an address that already has an account", async () => {
    const allowlisted = vi.fn().mockResolvedValue(false);
    expect(await signupDecision({ openSignup: false, hasAccount: true }, allowlisted)).toEqual({
      allowed: true,
    });
  });

  it("does not consult the allowlist for an account that exists", async () => {
    // Removing somebody from the list must not lock them out of data that is already theirs.
    const allowlisted = vi.fn().mockResolvedValue(false);
    await signupDecision({ openSignup: false, hasAccount: true }, allowlisted);
    expect(allowlisted).not.toHaveBeenCalled();
  });

  it("lets a listed address create an account", async () => {
    const allowlisted = vi.fn().mockResolvedValue(true);
    expect(await signupDecision({ openSignup: false, hasAccount: false }, allowlisted)).toEqual({
      allowed: true,
    });
  });

  it("refuses an unlisted address in plain words", async () => {
    // Plain, not vague: the person typing this address is somebody the maintainer knows, and
    // vagueness would leave them watching an empty inbox.
    const decision = await signupDecision(
      { openSignup: false, hasAccount: false },
      vi.fn().mockResolvedValue(false),
    );
    expect(decision).toEqual({ allowed: false, message: "這個信箱還不能註冊" });
  });
});

describe("signupDecision once signup is open", () => {
  it("lets any address create an account", async () => {
    const allowlisted = vi.fn().mockResolvedValue(false);
    expect(await signupDecision({ openSignup: true, hasAccount: false }, allowlisted)).toEqual({
      allowed: true,
    });
  });

  it("never reads the allowlist table at all", async () => {
    // Not "the table is empty so everything passes" — the switch changes which code path runs,
    // so a forgotten row cannot lock anyone out after launch.
    const allowlisted = vi.fn().mockResolvedValue(false);
    await signupDecision({ openSignup: true, hasAccount: false }, allowlisted);
    await signupDecision({ openSignup: true, hasAccount: true }, allowlisted);
    expect(allowlisted).not.toHaveBeenCalled();
  });
});
