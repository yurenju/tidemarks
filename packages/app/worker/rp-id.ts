// Whether this deployment's RP ID belongs to the host a request arrived on.
//
// RP_ID is whatever the deployer put in a build variable, and it is never derived from a
// request (ADR-0030). It is an irreversible binding — every passkey registered against it dies
// the day it changes — so letting an incoming host decide it would hang that binding on
// Cloudflare's routing rather than on a decision somebody made and can find again.
//
// The host is allowed exactly one job here: explaining, in words, that it is not the host this
// deployment was configured for. **Explain, never bind.**

/**
 * Whether a passkey ceremony served from `host` may be scoped to `rpID`.
 *
 * WebAuthn allows an RP ID to be the host itself or a registrable domain above it, so a
 * deployment answering on `app.tidemarks.io` may legitimately scope its passkeys to
 * `tidemarks.io`.
 *
 * **The Public Suffix List is deliberately not consulted**, although the full WebAuthn rule
 * does. Its job is to stop an RP ID of `com` covering half the internet, and the party it
 * defends against is a hostile relying party — which is not who is on the other end of this
 * value. `rpID` arrives from the deployer's own build variable; nothing a request carries
 * reaches it.
 */
export function rpIdCoversHost(rpID: string | undefined, host: string): boolean {
  if (!rpID) return false;
  const scope = normalizeHost(rpID);
  const arrived = normalizeHost(host);
  // The dot is the whole point: a bare `endsWith(rpID)` would let `nottidemarks.io` pass for
  // `tidemarks.io`, which shares the tail and nothing else.
  return arrived === scope || arrived.endsWith(`.${scope}`);
}

/**
 * A hostname in the one spelling two of them can be compared in.
 *
 * Both sides need it, and for different reasons. `RP_ID` is typed by hand into a dashboard
 * field, so it arrives however somebody typed it — `App.Example.com` names the same host as
 * `app.example.com`, and DNS has never cared which. The host off the request is already
 * lower-cased by `URL`, but may carry the root's trailing dot.
 *
 * Getting this wrong would refuse passkeys on a deployment that is configured correctly, with
 * a message insisting the two hostnames differ while printing what looks like the same one
 * twice — the worst kind of wrong answer to be told.
 */
function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Why passkeys cannot work on this host, or null when they can.
 *
 * Both hostnames are named on purpose. "The configuration does not match" would send the
 * reader back to the dashboard to find out what it was configured with; this way the mismatch
 * and its fix are in the same sentence. In Chinese, like every other message from this Worker
 * that reaches a screen.
 *
 * Without this the same mistake still fails, just illegibly: the browser rejects the ceremony
 * inside `navigator.credentials.create()` with a bare `SecurityError`, hours or months after a
 * deploy that succeeded.
 */
export function rpIdMismatchMessage(rpID: string | undefined, host: string): string | null {
  if (rpIdCoversHost(rpID, host)) return null;
  return (
    `這台的 RP_ID 設成 ${rpID || "（沒有設定）"}，但你現在連的是 ${host}，` +
    `passkey 在這個網址上不能用。改用 email 登入碼進去，或修正部署設定。`
  );
}
