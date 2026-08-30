// Who is allowed to create an account, and what the refusal is allowed to say.
//
// The gate stands at account creation only. Logging in never passes through it: taking
// somebody off the allowlist does not take away data that is already theirs.
//
// See CONTEXT.md[[Open signup]].

/**
 * Whether signup is open, from `wrangler.jsonc`'s `OPEN_SIGNUP` var.
 *
 * Unset means closed, and so does anything that was not typed as a yes. This flag *is* the
 * launch line (ADR-0004), so the ambiguous readings all resolve to the side where nobody
 * else's data has arrived yet.
 */
export function openSignupFrom(value: string | undefined): boolean {
  return value === "true";
}

import type { I18n } from "@lingui/core";

export type SignupDecision = { allowed: true } | { allowed: false; message: string };

/**
 * Whether a code may be sent to this address, and whether verifying it creates an account.
 *
 * `isAllowlisted` is a callback rather than a boolean so that "once signup is open the
 * allowlist table is not read at all" is something the tests can hold us to. The difference
 * between that and an empty table is invisible in production and very visible the day a
 * leftover row locks somebody out.
 */
export async function signupDecision(
  i18n: I18n,
  { openSignup, hasAccount }: { openSignup: boolean; hasAccount: boolean },
  isAllowlisted: () => Promise<boolean>,
): Promise<SignupDecision> {
  if (hasAccount) return { allowed: true };
  if (openSignup) return { allowed: true };
  // Plain rather than vague, and only while the list exists: the person typing this address is
  // somebody the maintainer knows, and vagueness would leave them watching an empty inbox.
  // After launch there is no refusal to word — every address gets the same answer.
  if (await isAllowlisted()) return { allowed: true };
  return {
    allowed: false,
    message: i18n._({
      id: "signup.notYet",
      message: "This address cannot sign up yet",
      comment:
        "Refusal shown while an allowlist is in force, before this deployment opens signups. Plain rather than vague on purpose: the person reading it is somebody the maintainer knows, and a vague answer would leave them watching an empty inbox.",
    }),
  };
}
