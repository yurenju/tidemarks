// The MCP endpoint, over Streamable HTTP with no session.
//
// The transport spec allows a server to answer a POST with a single JSON response instead of an
// SSE stream, and to hold no session at all. Both apply here honestly: nothing this server
// does is long-running, and nothing it knows survives a request — the reader's shelf lives in
// D1 and R2, so there is no state a session id could refer to. That is why there is no
// `Mcp-Session-Id` and why GET (which opens a server-to-client stream) is refused rather than
// left half-implemented.
import { json } from "../auth";
import { handleBody, parseErrorResponse } from "./protocol";
import type { LibraryStore } from "./store";
import { TOOLS } from "./tools";

export async function handleMcp(request: Request, store: LibraryStore): Promise<Response> {
  if (request.method !== "POST") {
    // A client that wants to listen for server-initiated messages gets a straight no, so it
    // stops asking instead of holding a connection that will never carry anything.
    return json(
      { error: "this MCP server only answers POST" },
      { status: 405, headers: { allow: "POST" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(parseErrorResponse(), { status: 400 });
  }

  const reply = await handleBody(body, TOOLS, { store, now: Date.now() });
  // Notifications only: there is nothing to say back, and saying something anyway is what
  // makes a strict client call this a protocol violation.
  if (reply === null) return new Response(null, { status: 202 });
  return json(reply);
}
