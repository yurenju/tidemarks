// The one screen where the reader says yes to an agent.
//
// Rendered by the Worker rather than by the React app on purpose: it must be readable before
// any JavaScript loads, it must not be reachable by a client-side route the SPA could get
// wrong, and it is the only page in Tidemarks where getting the origin bar right matters.
//
// The passkey layer and OAuth meet in exactly one line — `completeAuthorization({ userId })`.
// Everything else here is the reader looking at who is asking and pressing a button.
import type { I18n } from "@lingui/core";
import { i18nFor } from "./i18n";
import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { AUTHORIZE_PATH, RETURN_PARAM } from "../src/lib/authorize-return";
import { sessionUserId, type Env } from "./auth";

/** The only scope this server issues. Read-only is the whole shape of #63. */
export const READ_SCOPE = "tidemarks:read";

export interface AuthorizeEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

export async function handleAuthorize(request: Request, env: AuthorizeEnv): Promise<Response> {
  const i18n = i18nFor(request);
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return authorizationErrorResponse(i18n, error);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client)
    return page(
      i18n,
      400,
      i18n._({
        id: "authorize.unknownClient.heading",
        message: "This app is not registered",
        comment:
          "Heading of the consent page when the agent's client id is unknown to this deployment.",
      }),
      i18n._({
        id: "authorize.unknownClient.body",
        message: "Start the connection again from your agent.",
        comment:
          "What to do about an unregistered app. The reader cannot fix it here, so it points them back at the thing that sent them.",
      }),
    );

  const userId = await sessionUserId(env, request);
  if (!userId) {
    // No session in *this* browser — an agent may well have opened a different one from the
    // one the reader reads in. Send them to the app to log in; it comes back here (see
    // `authorize-return.ts`), so approving never means starting the whole flow again.
    const url = new URL(request.url);
    const back = new URL("/", url);
    back.searchParams.set(RETURN_PARAM, `${AUTHORIZE_PATH}${url.search}`);
    return Response.redirect(back.toString(), 302);
  }

  if (request.method === "POST") {
    // No CSRF token, and that is not an omission: the session cookie is `SameSite=Lax`, which
    // browsers do not attach to a cross-site POST. A forged approval therefore arrives with no
    // session and lands on the redirect above instead of granting anything.
    const form = await request.formData();
    if (form.get("decision") !== "approve") {
      return denied(oauthRequest);
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId,
      metadata: { clientName: client.clientName ?? null },
      scope: [READ_SCOPE],
      // What the MCP handler gets as `ctx.props`. The user id and nothing else: every query
      // the tools make is scoped by it, and anything more here would be a second copy of
      // state that can disagree with the database.
      props: { userId },
    });
    return Response.redirect(redirectTo, 302);
  }

  return consentPage(i18n, client.clientName ?? oauthRequest.clientId);
}

function authorizationErrorResponse(i18n: I18n, error: AuthorizationError): Response {
  // An error only goes back to the client when the redirect URI has been validated. Otherwise
  // it is shown here — bouncing an unverified URI is how an open redirect is built.
  if (!error.redirectUri)
    return page(
      i18n,
      400,
      i18n._({
        id: "authorize.badRequest.heading",
        message: "There is something wrong with this authorisation request",
        comment:
          "Heading of the consent page when the request itself is malformed and there is nowhere safe to redirect to.",
      }),
      escapeHtml(error.description),
    );
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

function denied(oauthRequest: AuthRequest): Response {
  const redirect = new URL(oauthRequest.redirectUri);
  redirect.searchParams.set("error", "access_denied");
  redirect.searchParams.set("error_description", "the reader did not approve this connection");
  if (oauthRequest.state) redirect.searchParams.set("state", oauthRequest.state);
  return Response.redirect(redirect.toString(), 302);
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function consentPage(i18n: I18n, clientName: string): Response {
  // Says what the agent will be able to see, in the words the reader would use. "read-only" on
  // its own is not enough: the thing worth knowing is that the books themselves are readable,
  // not just their titles.
  return page(
    i18n,
    200,
    i18n._({
      id: "authorize.consent.heading",
      message: "Let “{clientName}” connect to your shelf?",
      comment:
        "The question on the consent page. The value is the name the agent registered under, and is escaped before it reaches the page. The quotation marks are this language's — Chinese uses 「」.",
      values: { clientName },
    }),
    i18n._({
      id: "authorize.consent.body",
      message: `Once connected, it can read:

  · every book on your shelf, text and all
  · where you are in each one, and the page in front of you
  · the passages you marked and the notes you wrote

It <strong>cannot</strong> change anything, and cannot delete a book. You can take this back in Tidemarks at any time.`,
      comment:
        "The whole body of the consent page. It is HTML: keep the <strong> tags around whatever carries the emphasis in this language, and keep the three bullet lines starting with '  · '. The first bullet is the one that matters — an agent reads the books themselves, not merely their titles.",
    }),
    `<form method="post">
      <button type="submit" name="decision" value="approve" class="primary">${escapeHtml(
        i18n._({
          id: "authorize.consent.approve",
          message: "Allow",
          comment: "The button that grants the agent access to the shelf.",
        }),
      )}</button>
      <button type="submit" name="decision" value="deny" class="ghost">${escapeHtml(
        i18n._({
          id: "authorize.consent.deny",
          message: "No",
          comment:
            "The button that refuses the agent. Short and plain — it is the safe answer, not an apology.",
        }),
      )}</button>
    </form>`,
  );
}

// `heading` is plain text and gets escaped here; `body` and `actions` are HTML, so anything
// that came from a client has to be escaped by the caller before it goes in.
//
// `lang` follows the language the page was written in, which is the one the request asked for.
// It is not decoration: the CJK faces a machine has hold one set of glyphs for the Han
// characters Chinese and Japanese share, and `lang` is what picks between the regional forms
// (`src/lib/i18n.ts` has the long version).
function page(i18n: I18n, status: number, heading: string, body: string, actions = ""): Response {
  const html = `<!doctype html>
<html lang="${i18n.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} — Tidemarks</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2rem 1.25rem; line-height: 1.7;
    font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
    max-width: 34rem; margin-inline: auto;
  }
  h1 { font-size: 1.35rem; line-height: 1.5; }
  pre { white-space: pre-wrap; font: inherit; margin: 1.5rem 0; }
  form { display: flex; gap: .75rem; margin-top: 2rem; }
  button {
    flex: 1; padding: .8rem 1rem; font: inherit; border-radius: .5rem;
    border: 1px solid currentColor; background: transparent; cursor: pointer;
  }
  button.primary { background: CanvasText; color: Canvas; border-color: CanvasText; }
</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
<pre>${body}</pre>
${actions}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
