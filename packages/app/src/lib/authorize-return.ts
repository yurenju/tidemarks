// Where to send the browser back to after a login that started at `/authorize`.
//
// An agent connecting to spine's MCP server opens `/authorize` in a browser that may have no
// session — a different browser from the one the reader reads in, or one whose cookie expired.
// That request bounces to the app with `?next=`, and this decides whether to follow it.
//
// It is a redirect target read out of the URL, which is the shape of an open redirect: land on
// `?next=https://evil.example/` and the app hands the reader over to an attacker's login page
// wearing spine's name. So the answer is not "is it same-origin" but the much narrower "is it
// the authorization endpoint" — nothing else has any business being returned to.
// Both halves of the round trip read these: the Worker writes the parameter on its way out
// (`worker/authorize.ts`), this reads it on the way back. One spelling, so they cannot drift
// into a redirect that silently never happens.
export const AUTHORIZE_PATH = "/authorize";
export const RETURN_PARAM = "next";

export function authorizeReturnTarget(search: string): string | null {
  const next = new URLSearchParams(search).get(RETURN_PARAM);
  if (!next) return null;
  // A path, and specifically this one. `//evil.example/x` is a protocol-relative URL that
  // starts with a slash, which is exactly the case a naive `startsWith('/')` lets through.
  if (next !== AUTHORIZE_PATH && !next.startsWith(`${AUTHORIZE_PATH}?`)) return null;
  return next;
}
