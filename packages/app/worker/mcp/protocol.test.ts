import { describe, expect, it } from "vitest";
import { handleBody, handleMessage, LATEST_PROTOCOL_VERSION, negotiateVersion } from "./protocol";
import { ToolError, type ToolContext, type ToolDefinition } from "./tools";

// The protocol layer knows nothing about books, so the tools here are stand-ins for the three
// things that can happen: an answer, a refusal the model should read, and a bug.
const answering: ToolDefinition = {
  name: "answer",
  description: "answers",
  inputSchema: { type: "object", properties: {} },
  async run(args) {
    return { echoed: args.value };
  },
};

const refusing: ToolDefinition = {
  name: "refuse",
  description: "refuses",
  inputSchema: { type: "object", properties: {} },
  async run() {
    throw new ToolError("no book with that id");
  },
};

const broken: ToolDefinition = {
  name: "broken",
  description: "throws",
  inputSchema: { type: "object", properties: {} },
  async run() {
    throw new TypeError("undefined is not a function");
  },
};

const TOOLS = [answering, refusing, broken];
const CTX = { store: null, now: 0 } as unknown as ToolContext;

function call(method: string, params?: unknown, id: string | number = 1) {
  return handleMessage({ jsonrpc: "2.0", id, method, params }, TOOLS, CTX);
}

describe("initialize", () => {
  it("answers in the version the client asked for, when it is one we speak", async () => {
    const reply = await call("initialize", { protocolVersion: "2024-11-05" });
    expect(reply).toMatchObject({ result: { protocolVersion: "2024-11-05" } });
  });

  it("falls back to our newest version rather than echoing one we do not speak", async () => {
    const reply = await call("initialize", { protocolVersion: "1999-01-01" });
    expect(reply).toMatchObject({ result: { protocolVersion: LATEST_PROTOCOL_VERSION } });
  });

  it("declares tools and nothing else, because nothing else is implemented", async () => {
    const reply = (await call("initialize", {})) as { result: { capabilities: object } };
    expect(Object.keys(reply.result.capabilities)).toEqual(["tools"]);
  });

  it("tells the agent up front that positions have an age", async () => {
    const reply = (await call("initialize", {})) as { result: { instructions: string } };
    expect(reply.result.instructions).toContain("offline");
  });
});

describe("negotiateVersion", () => {
  it("ignores a version that is not a string", () => {
    expect(negotiateVersion(20250618)).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe("tools/list", () => {
  it("gives every tool a name, a description and a schema", async () => {
    const reply = (await call("tools/list")) as {
      result: { tools: { name: string; description: string; inputSchema: object }[] };
    };
    expect(reply.result.tools).toHaveLength(3);
    for (const tool of reply.result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("tools/call", () => {
  it("hands the result back as text content", async () => {
    const reply = (await call("tools/call", {
      name: "answer",
      arguments: { value: 42 },
    })) as { result: { content: { text: string }[] } };
    expect(JSON.parse(reply.result.content[0]!.text)).toEqual({ echoed: 42 });
  });

  it("turns a tool refusal into a result the model can read, not a transport error", async () => {
    // isError exists precisely so the model sees "that book id does not exist" and tries
    // another one. As a JSON-RPC error it would look to the client like the server is broken.
    const reply = (await call("tools/call", { name: "refuse" })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]!.text).toBe("no book with that id");
  });

  it("lets a real bug stay a protocol error, so it is visible as one", async () => {
    const reply = (await call("tools/call", { name: "broken" })) as { error: { code: number } };
    expect(reply.error.code).toBe(-32603);
  });

  it("rejects a tool it does not have", async () => {
    const reply = (await call("tools/call", { name: "nope" })) as { error: { code: number } };
    expect(reply.error.code).toBe(-32601);
  });

  it("treats missing arguments as an empty object, since every argument is optional to omit", async () => {
    const reply = (await call("tools/call", { name: "answer" })) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(reply.result.content[0]!.text)).toEqual({});
  });
});

describe("message shapes", () => {
  it("says nothing back to a notification", async () => {
    const reply = await handleMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      TOOLS,
      CTX,
    );
    expect(reply).toBeNull();
  });

  it("refuses a request whose id it cannot answer to, instead of going quiet", async () => {
    // `"id": null` is a request with a broken id, not a notification. Treating it as one
    // leaves the client waiting for an answer that was never going to come.
    const reply = (await handleMessage(
      { jsonrpc: "2.0", id: null, method: "ping" },
      TOOLS,
      CTX,
    )) as {
      error: { code: number };
    };
    expect(reply.error.code).toBe(-32600);
  });

  it("ignores a notification it has never heard of rather than refusing it", async () => {
    // The protocol grows. Refusing an unknown notification breaks a client that is behaving.
    const reply = await handleMessage({ jsonrpc: "2.0", method: "notifications/new" }, TOOLS, CTX);
    expect(reply).toBeNull();
  });

  it("refuses a body that is not a JSON-RPC 2.0 request", async () => {
    const reply = (await handleMessage({ id: 1, method: "ping" }, TOOLS, CTX)) as {
      error: { code: number };
    };
    expect(reply.error.code).toBe(-32600);
  });

  it("answers ping, which is how a client checks the connection is alive", async () => {
    expect(await call("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("keeps a string id a string, so the client can match it to its request", async () => {
    const reply = (await call("ping", {}, "abc")) as { id: string };
    expect(reply.id).toBe("abc");
  });
});

describe("handleBody", () => {
  it("answers a batch with one reply per request", async () => {
    const replies = (await handleBody(
      [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ],
      TOOLS,
      CTX,
    )) as { id: number }[];
    expect(replies.map((r) => r.id)).toEqual([1, 2]);
  });

  it("has nothing to send back when a batch is all notifications", async () => {
    const replies = await handleBody(
      [{ jsonrpc: "2.0", method: "notifications/initialized" }],
      TOOLS,
      CTX,
    );
    expect(replies).toBeNull();
  });

  it("refuses an empty batch", async () => {
    const reply = (await handleBody([], TOOLS, CTX)) as { error: { code: number } };
    expect(reply.error.code).toBe(-32600);
  });
});
