/*
 * The Model Context Protocol over Streamable HTTP, without sessions. Pure module: tests run it with fake tools.
 *
 * Each POST to /mcp holds one JSON-RPC message. A request gets one JSON reply. A notification gets none (202).
 * The server offers tools only: initialize, ping, tools/list and tools/call.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];

/** A JSON Schema for tool input. OpenAct checks the subset below before it runs a tool. */
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface PropertySchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: ReadonlyArray<string | number>;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: PropertySchema;
  maxItems?: number;
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export interface McpCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpHandlers {
  serverInfo: { name: string; title?: string; version: string };
  instructions?: string;
  listTools: () => Promise<McpToolInfo[]>;
  /** Runs a tool. Throw ToolNotFound for an unknown name. Other errors become a tool result with isError. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpCallResult>;
}

export class ToolNotFound extends Error {}

type Id = string | number;
export type JsonRpcReply = { jsonrpc: "2.0"; id: Id | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const err = (id: Id | null, code: number, message: string): JsonRpcReply => ({ jsonrpc: "2.0", id, error: { code, message } });
const isId = (v: unknown): v is Id => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

function typeOk(schema: PropertySchema, v: unknown): boolean {
  switch (schema.type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return !!v && typeof v === "object" && !Array.isArray(v);
  }
}

function valueProblem(name: string, schema: PropertySchema, v: unknown): string | null {
  if (!typeOk(schema, v)) return `"${name}" must be ${schema.type === "integer" ? "a whole number" : `a ${schema.type}`}.`;
  if (schema.enum && !schema.enum.includes(v as string | number)) return `"${name}" must be one of: ${schema.enum.join(", ")}.`;
  if (typeof v === "string" && schema.maxLength !== undefined && v.length > schema.maxLength) return `"${name}" is too long. Use ${schema.maxLength} characters or fewer.`;
  if (typeof v === "number" && schema.minimum !== undefined && v < schema.minimum) return `"${name}" must be ${schema.minimum} or more.`;
  if (typeof v === "number" && schema.maximum !== undefined && v > schema.maximum) return `"${name}" must be ${schema.maximum} or less.`;
  if (Array.isArray(v)) {
    if (schema.maxItems !== undefined && v.length > schema.maxItems) return `"${name}" can hold ${schema.maxItems} items or fewer.`;
    if (schema.items) for (const [i, item] of v.entries()) {
      const p = valueProblem(`${name}[${i}]`, schema.items, item);
      if (p) return p;
    }
  }
  return null;
}

/** Checks tool arguments against the tool's input schema. Returns a message for the agent, or null when they are fine. */
export function argsProblem(schema: ToolInputSchema, args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "Send the arguments as a JSON object.";
  const a = args as Record<string, unknown>;
  for (const key of schema.required ?? []) if (a[key] === undefined || a[key] === null) return `"${key}" is required.`;
  for (const [key, v] of Object.entries(a)) {
    const prop = schema.properties?.[key];
    if (!prop) {
      if (schema.additionalProperties === false) return `"${key}" is not an argument of this tool.`;
      continue;
    }
    if (v === undefined || v === null) continue;
    const p = valueProblem(key, prop, v);
    if (p) return p;
  }
  return null;
}

/** Handles one JSON-RPC message. Returns the reply, or null for a notification. */
export async function handleMcpMessage(message: unknown, h: McpHandlers): Promise<JsonRpcReply | null> {
  if (Array.isArray(message)) return err(null, RPC.invalidRequest, "Send one JSON-RPC message per request. Batches are not supported.");
  if (!message || typeof message !== "object") return err(null, RPC.invalidRequest, "Send a JSON-RPC 2.0 message.");
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    // A reply from the client (to a request the server never sends) or a malformed message.
    return "id" in m && isId(m.id) ? err(m.id, RPC.invalidRequest, "Send a JSON-RPC 2.0 request with a method.") : null;
  }
  const notification = !("id" in m);
  if (notification) return null; // notifications/initialized, notifications/cancelled and others need no reply.
  if (!isId(m.id)) return err(null, RPC.invalidRequest, "The request id must be a string or a number.");
  const id = m.id;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  try {
    switch (m.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiateVersion(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: h.serverInfo,
            ...(h.instructions ? { instructions: h.instructions } : {})
          }
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: await h.listTools() } };
      case "tools/call": {
        if (typeof params.name !== "string") return err(id, RPC.invalidParams, "Name the tool to call.");
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args)) return err(id, RPC.invalidParams, "Send the tool arguments as a JSON object.");
        try {
          return { jsonrpc: "2.0", id, result: await h.callTool(params.name, args as Record<string, unknown>) };
        } catch (e) {
          if (e instanceof ToolNotFound) return err(id, RPC.invalidParams, `There is no tool named "${params.name}" for you here.`);
          throw e;
        }
      }
      default:
        return err(id, RPC.methodNotFound, `This server does not support "${m.method}".`);
    }
  } catch (e) {
    console.error("[openact] MCP request failed", e);
    return err(id, RPC.internal, "The server could not finish the request. Try again.");
  }
}
