// The client side of the two doors: a passkey, or a code mailed to the reader's address.
// A thin wrapper over @simplewebauthn/browser and the Worker's /auth/* endpoints. Sessions
// live in an HttpOnly cookie; this module never touches tokens.
//
// The two doors are one screen, not two. The reader types an address; a reader who has a
// passkey never gets that far, because the browser offers it from the same field. Nothing here
// asks the server which door an address is entitled to — that question would answer "does this
// person have an account", to anyone who cared to ask.
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiFetch } from "./api";
import { setSignedIn } from "./session";
import { forgetQuota, type Account } from "./sync";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // The Worker says what went wrong in `error`; without this the reader is shown the raw
    // JSON that wraps it.
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // not JSON — whatever came back is the best there is
    }
    throw new Error(message || `${url}: ${res.status}`);
  }
  return res.json();
}

/**
 * Who this browser is, according to the server.
 *
 * It also settles `lib/session.ts`'s flag from the answer, which is what makes the flag
 * self-healing: the panel asks this on mount, so a browser holding a valid cookie without the
 * flag — one that was signed in before the flag existed, or that lost localStorage — gets it
 * back the first time the reader opens [[Account]].
 */
export async function me(): Promise<Account | null> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) {
    setSignedIn(false);
    forgetQuota();
    return null;
  }
  setSignedIn(true);
  return res.json();
}

// --- the mailed code ---

/** Ask for a code. Succeeds whether or not the address has an account: that is the point. */
export async function requestMagicCode(email: string): Promise<void> {
  await post("/auth/code/request", { email });
}

/** Spend the code. Creates the account if this address has not got one yet. */
export async function verifyMagicCode(email: string, code: string): Promise<void> {
  await post("/auth/code/verify", { email, code });
  setSignedIn(true);
}

// --- passkeys ---

/**
 * Whether the browser can offer a passkey from inside the email field.
 *
 * False means the reader gets an explicit button instead. Not every engine has conditional
 * mediation, and a passkey that only appears in a popup nobody triggers is a passkey nobody
 * can use.
 */
export function passkeyAutofillAvailable(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill();
}

/**
 * Log in with a passkey, either from an explicit button or from the email field's autofill.
 *
 * `autofill: true` offers the reader's passkeys alongside the email field and resolves only
 * once one is picked — if the reader types an address instead it never resolves, so call
 * `cancelPasskeyPrompt()` when the screen moves on. Everything else about the two is the same
 * ceremony, and the server is not told which one it is answering.
 */
export async function loginWithPasskey({ autofill = false } = {}): Promise<void> {
  const options = await post<PublicKeyCredentialRequestOptionsJSON>("/auth/login/options");
  const assertion = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: autofill,
  });
  await post("/auth/login/verify", assertion);
  setSignedIn(true);
}

export function cancelPasskeyPrompt(): void {
  WebAuthnAbortService.cancelCeremony();
}

/** Add a passkey to the account this browser is already logged into. */
export async function addPasskey(): Promise<void> {
  const options = await post<PublicKeyCredentialCreationOptionsJSON>("/auth/register/options", {});
  const attestation = await startRegistration({ optionsJSON: options });
  await post("/auth/register/verify", attestation);
}

export async function logout(): Promise<void> {
  await post("/auth/logout");
  setSignedIn(false);
  forgetQuota();
}
