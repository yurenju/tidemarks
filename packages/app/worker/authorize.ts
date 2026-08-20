// The one screen where the reader says yes to an agent.
//
// Rendered by the Worker rather than by the React app on purpose: it must be readable before
// any JavaScript loads, it must not be reachable by a client-side route the SPA could get
// wrong, and it is the only page in Tidemarks where getting the origin bar right matters.
//
// The passkey layer and OAuth meet in exactly one line — `completeAuthorization({ userId })`.
// Everything else here is the reader looking at who is asking and pressing a button.
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
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return authorizationErrorResponse(error);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return page(400, "這個應用程式沒有註冊過", "請從你的 agent 重新連線一次。");

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

  return consentPage(client.clientName ?? oauthRequest.clientId);
}

function authorizationErrorResponse(error: AuthorizationError): Response {
  // An error only goes back to the client when the redirect URI has been validated. Otherwise
  // it is shown here — bouncing an unverified URI is how an open redirect is built.
  if (!error.redirectUri) return page(400, "這個授權請求有問題", escapeHtml(error.description));
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

function consentPage(clientName: string): Response {
  // Says what the agent will be able to see, in the words the reader would use. "唯讀" alone
  // is not enough: the thing worth knowing is that the books themselves are readable, not
  // just their titles.
  return page(
    200,
    `要讓「${clientName}」連上你的書架嗎？`,
    `連上之後，它讀得到：

  · 你書架上所有的書，包含內文
  · 你讀到哪裡、當下看到的那一頁
  · 你畫的重點與寫的筆記

它<strong>不能</strong>改動任何東西，也不能刪書。你隨時可以在 Tidemarks 裡收回。`,
    `<form method="post">
      <button type="submit" name="decision" value="approve" class="primary">允許</button>
      <button type="submit" name="decision" value="deny" class="ghost">不要</button>
    </form>`,
  );
}

// `heading` is plain text and gets escaped here; `body` and `actions` are HTML, so anything
// that came from a client has to be escaped by the caller before it goes in.
function page(status: number, heading: string, body: string, actions = ""): Response {
  const html = `<!doctype html>
<html lang="zh-Hant">
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
