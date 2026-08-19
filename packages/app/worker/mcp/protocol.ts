// MCP over JSON-RPC, as a pure function from one message to one reply.
//
// Written out rather than pulled in: the official SDK's HTTP transports are built on Node's
// `http` module, and the Workers-native route runs through Durable Objects for a session this
// server does not need. Every request here is self-contained — the tools read D1 and R2 and
// hold nothing between calls — so a **stateless** server is not a shortcut, it is the accurate
// description. Keeping it a pure function is what lets the whole protocol be tested without an
// HTTP server (`protocol.test.ts`).
import { ToolError, type ToolContext, type ToolDefinition } from "./tools";

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

/** Newest first. A client asking for one of these gets that one back. */
export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];

export const SERVER_INFO = { name: "folis", title: "Folis", version: "0.1.0" };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number;
export type JsonValue = unknown;

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: JsonValue;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

function ok(id: JsonRpcId, result: JsonValue): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId | null, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** The version to answer `initialize` with: the client's if we speak it, ours otherwise. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Answers one JSON-RPC message.
 *
 * `null` means "nothing to send back", which is a notification — the client is telling us
 * something (`notifications/initialized`) and the spec forbids a reply. Returning a response
 * there is not a harmless extra; some clients treat an unexpected id as a protocol violation.
 */
export async function handleMessage(
  message: unknown,
  tools: ToolDefinition[],
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return fail(null, INVALID_REQUEST, "not a JSON-RPC 2.0 request");
  }

  const params = isRecord(message.params) ? message.params : {};

  // A notification is a message with **no** id, which is not the same as one whose id is
  // unusable. Collapsing the two would leave a client that sent `"id": null` waiting forever:
  // it is expecting an answer, and it would get the silence a notification earns.
  if (!("id" in message) || message.id === undefined) {
    // Unknown notifications are ignored on purpose: the protocol grows, and refusing one we
    // have no use for would break a client that is behaving correctly.
    return null;
  }

  const rawId = message.id;
  if (typeof rawId !== "string" && typeof rawId !== "number") {
    return fail(null, INVALID_REQUEST, "id must be a string or a number");
  }
  const id: JsonRpcId = rawId;

  switch (message.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "This is one reader’s personal bookshelf: their books, where they are in each, and " +
          "the passages they highlighted. Reading positions come with the time they were " +
          "recorded — say how old a position is before explaining the page, because the " +
          "reader’s device may have been offline since. Everything here is read-only.",
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call":
      return callTool(id, params, tools, ctx);

    default:
      return fail(id, METHOD_NOT_FOUND, `unknown method: ${message.method}`);
  }
}

async function callTool(
  id: JsonRpcId,
  params: Record<string, unknown>,
  tools: ToolDefinition[],
  ctx: ToolContext,
): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string") return fail(id, INVALID_REQUEST, "tools/call needs a tool name");

  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return fail(id, METHOD_NOT_FOUND, `unknown tool: ${name}`);

  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    const result = await tool.run(args, ctx);
    return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  } catch (error) {
    // A tool that could not answer is a result the model should read and work around, not a
    // transport failure — that distinction is why MCP has `isError` at all. A bug in here is
    // a different thing and stays a protocol error, so it shows up as one.
    if (error instanceof ToolError) {
      return ok(id, { content: [{ type: "text", text: error.message }], isError: true });
    }
    return fail(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Answers a whole request body, which is either one message or a batch of them.
 *
 * `null` means every message in it was a notification, and the transport should say "accepted"
 * with no body.
 */
export async function handleBody(
  body: unknown,
  tools: ToolDefinition[],
  ctx: ToolContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return fail(null, INVALID_REQUEST, "empty batch");
    const replies: JsonRpcResponse[] = [];
    for (const message of body) {
      const reply = await handleMessage(message, tools, ctx);
      if (reply) replies.push(reply);
    }
    return replies.length > 0 ? replies : null;
  }
  return handleMessage(body, tools, ctx);
}

/** For the transport: a body that was not JSON at all never reached a method. */
export function parseErrorResponse(): JsonRpcFailure {
  return fail(null, PARSE_ERROR, "request body is not valid JSON");
}
