/*
 * Provider-neutral chat messages with tool calls, and converters to and from each provider's format.
 * Pure functions with type-only imports, so Node can unit test this file directly.
 */
import type { Message } from "@ag-ui/core";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Opaque items a provider needs back on the next step of the same run:
 * OpenAI reasoning items (encrypted) and Gemini thought signatures. They never go to the web app.
 */
export interface ProviderReplay {
  provider: "openai" | "google";
  items: unknown[];
}

export type AgentMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; replay?: ProviderReplay }
  | { role: "tool"; toolCallId: string; name?: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelOutput {
  text: string;
  toolCalls: ToolCall[];
  replay?: ProviderReplay;
}

const NOT_RUN = "This action did not run.";

let counter = 0;
const genId = () => `call_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return {};
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

/** Converts AG-UI messages from the client into agent messages. Unknown roles are skipped. */
export function fromAguiMessages(messages: Message[], max = 24): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (const m of messages.slice(-max)) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user") {
      const t = textOf((m as { content?: unknown }).content);
      if (t.trim()) out.push({ role: "user", content: t.slice(0, 4000) });
    } else if (m.role === "assistant") {
      const a = m as { content?: unknown; toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
      const toolCalls = (a.toolCalls ?? [])
        .filter((t) => t && typeof t.id === "string" && typeof t.function?.name === "string")
        .map((t) => ({ id: t.id!, name: t.function!.name!, args: parseArgs(t.function!.arguments) }));
      const content = textOf(a.content);
      if (content.trim() || toolCalls.length) out.push({ role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) });
    } else if (m.role === "tool") {
      const t = m as { toolCallId?: string; content?: unknown };
      if (typeof t.toolCallId === "string") out.push({ role: "tool", toolCallId: t.toolCallId, content: textOf(t.content).slice(0, 4000) });
    }
  }
  return pairToolResults(out);
}

/**
 * Makes the history valid for strict providers: every tool call gets a result right after its assistant message,
 * and a tool result without a matching call becomes plain user text.
 */
export function pairToolResults(msgs: AgentMsg[]): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "tool") {
      out.push({ role: "user", content: `(Result of an earlier action) ${m.content}` });
      continue;
    }
    out.push(m);
    if (m.role === "assistant" && m.toolCalls?.length) {
      const results = new Map<string, AgentMsg>();
      const orphans: AgentMsg[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === "tool") {
        const t = msgs[j] as Extract<AgentMsg, { role: "tool" }>;
        // One result per call. A later result for the same call replaces an earlier one.
        if (m.toolCalls.some((c) => c.id === t.toolCallId)) results.set(t.toolCallId, t);
        else orphans.push({ role: "user", content: `(Result of an earlier action) ${t.content}` });
        j++;
      }
      for (const c of m.toolCalls) out.push(results.get(c.id) ?? { role: "tool", toolCallId: c.id, name: c.name, content: NOT_RUN });
      // Anthropic needs tool results before any text in the same turn, so orphan text goes last.
      out.push(...orphans);
      i = j - 1;
    }
  }
  return out;
}

/**
 * Puts the results of approved or rejected actions into the history.
 * The history from the web app has the tool call but not its result, so pairToolResults gave it a placeholder.
 * Each result replaces that placeholder, so every call keeps exactly one result.
 * Strict providers (Anthropic, OpenAI) reject a call with two results.
 */
export function withToolResults(msgs: AgentMsg[], results: Array<Extract<AgentMsg, { role: "tool" }>>): AgentMsg[] {
  if (!results.length) return msgs;
  const byId = new Map(results.map((r) => [r.toolCallId, r]));
  const used = new Set<string>();
  const out = msgs.map((m) => {
    if (m.role !== "tool") return m;
    const r = byId.get(m.toolCallId);
    if (!r) return m;
    used.add(m.toolCallId);
    return r;
  });
  // A call that is not in the history (it fell out of the window) becomes plain text in pairToolResults.
  for (const r of results) if (!used.has(r.toolCallId)) out.push(r);
  return pairToolResults(out);
}

/* Anthropic Messages API */

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export function toAnthropic(msgs: AgentMsg[], tools: ToolDef[]) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = m.content.trim() ? [{ type: "text", text: m.content }] : [];
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      push("assistant", blocks);
    } else push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
  }
  return {
    system,
    messages,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  };
}

export function parseAnthropic(data: unknown): ModelOutput {
  const blocks = ((data as { content?: unknown[] })?.content ?? []) as Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  return {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    toolCalls: blocks
      .filter((b) => b.type === "tool_use" && typeof b.name === "string")
      .map((b) => ({ id: b.id || genId(), name: b.name!, args: parseArgs(b.input) }))
  };
}

/* OpenAI Chat Completions API */

export function toOpenAi(msgs: AgentMsg[], tools: ToolDef[]) {
  const messages = msgs.map((m) => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {})
      };
    }
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
  return { messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
}

export function parseOpenAi(data: unknown): ModelOutput {
  const msg = (data as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }> })?.choices?.[0]?.message;
  return {
    text: msg?.content ?? "",
    toolCalls: (msg?.tool_calls ?? [])
      .filter((c) => typeof c.function?.name === "string")
      .map((c) => ({ id: c.id || genId(), name: c.function!.name!, args: parseArgs(c.function!.arguments) }))
  };
}

/*
 * OpenAI Responses API. GPT-6 models need it for tool calls.
 * store is false, so OpenAI keeps nothing. Reasoning items come back encrypted and go back in the next step of the run.
 */

type ResponsesItem = Record<string, unknown>;

export function toOpenAiResponses(msgs: AgentMsg[], tools: ToolDef[]) {
  const instructions = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input: ResponsesItem[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.replay?.provider === "openai") {
        input.push(...(m.replay.items as ResponsesItem[]));
        continue;
      }
      if (m.content.trim()) input.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) });
    } else input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
  }
  return {
    instructions,
    input,
    tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }))
  };
}

export function parseOpenAiResponses(data: unknown): ModelOutput {
  const output = (((data as { output?: unknown[] })?.output ?? []) as ResponsesItem[]).filter((o) => o && typeof o === "object");
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const replay: ResponsesItem[] = [];
  for (const o of output) {
    if (o.type === "message") {
      const t = ((o.content as Array<{ type?: string; text?: string }>) ?? [])
        .filter((p) => p?.type === "output_text")
        .map((p) => p.text ?? "")
        .join("");
      if (t) {
        texts.push(t);
        replay.push({ role: "assistant", content: t });
      }
    } else if (o.type === "function_call" && typeof o.name === "string") {
      const id = typeof o.call_id === "string" && o.call_id ? o.call_id : genId();
      toolCalls.push({ id, name: o.name, args: parseArgs(o.arguments) });
      replay.push({ type: "function_call", ...(typeof o.id === "string" ? { id: o.id } : {}), call_id: id, name: o.name, arguments: typeof o.arguments === "string" ? o.arguments : JSON.stringify(o.arguments ?? {}) });
    } else if (o.type === "reasoning" && typeof o.encrypted_content === "string") {
      // Only encrypted reasoning can go back when store is false.
      replay.push({ type: "reasoning", ...(typeof o.id === "string" ? { id: o.id } : {}), summary: Array.isArray(o.summary) ? o.summary : [], encrypted_content: o.encrypted_content });
    }
  }
  return { text: texts.join(""), toolCalls, ...(toolCalls.length ? { replay: { provider: "openai" as const, items: replay } } : {}) };
}

/*
 * Gemini generateContent API.
 * Gemini 3 and later sign their tool calls (thoughtSignature). The signed parts go back unchanged in the next step of the run.
 * Calls from an earlier request (the web app keeps no signature) get Google's documented placeholder signature.
 */

type GeminiPart = Record<string, unknown>;

/** Google's documented value for a function call whose real signature is not available. */
export const GEMINI_SKIP_SIGNATURE = "skip_thought_signature_validator";

export function toGemini(msgs: AgentMsg[], tools: ToolDef[]) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  const push = (role: "user" | "model", parts: GeminiPart[]) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  const names = new Map<string, string>();
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", [{ text: m.content }]);
    else if (m.role === "assistant") {
      for (const c of m.toolCalls ?? []) names.set(c.id, c.name);
      if (m.replay?.provider === "google") {
        push("model", m.replay.items as GeminiPart[]);
        continue;
      }
      const parts: GeminiPart[] = m.content.trim() ? [{ text: m.content }] : [];
      (m.toolCalls ?? []).forEach((c, i) => parts.push({ functionCall: { name: c.name, args: c.args }, ...(i === 0 ? { thoughtSignature: GEMINI_SKIP_SIGNATURE } : {}) }));
      push("model", parts);
    } else {
      const name = m.name ?? names.get(m.toolCallId) ?? "action";
      push("user", [{ functionResponse: { name, response: { result: m.content } } }]);
    }
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] } : {})
  };
}

export function parseGemini(data: unknown): ModelOutput {
  const parts = (((data as { candidates?: Array<{ content?: { parts?: unknown[] } }> })?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[]).filter(
    (p) => p && typeof p === "object"
  );
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const replay: GeminiPart[] = [];
  for (const p of parts) {
    const fc = p.functionCall as { name?: unknown; args?: unknown } | undefined;
    if (fc && typeof fc.name === "string") {
      toolCalls.push({ id: genId(), name: fc.name, args: parseArgs(fc.args) });
      // Calls are matched by order, so the provider's own id is not sent back.
      replay.push({ functionCall: { name: fc.name, args: parseArgs(fc.args) }, ...(typeof p.thoughtSignature === "string" ? { thoughtSignature: p.thoughtSignature } : {}) });
    } else if (typeof p.text === "string") {
      if (p.thought === true) continue;
      texts.push(p.text);
      replay.push(typeof p.thoughtSignature === "string" ? { text: p.text, thoughtSignature: p.thoughtSignature } : { text: p.text });
    } else if (typeof p.thoughtSignature === "string") replay.push(p);
  }
  if (toolCalls.length && !replay.some((p) => typeof p.thoughtSignature === "string")) {
    const first = replay.find((p) => p.functionCall);
    if (first) first.thoughtSignature = GEMINI_SKIP_SIGNATURE;
  }
  return { text: texts.join(""), toolCalls, ...(toolCalls.length ? { replay: { provider: "google" as const, items: replay } } : {}) };
}

/*
 * One request to a keyed provider, as a pure value. The agent sends it through AI Gateway.
 * scripts/ai-check.ts sends the same request, so the live check tests what the agent really sends.
 */

export type KeyedProvider = "anthropic" | "openai" | "google";

export interface ProviderRequest {
  /** The path after the AI Gateway base, such as "openai/responses". */
  gatewayPath: string;
  /** The same request straight to the provider, without AI Gateway. For the live check. */
  directUrl: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Room for reasoning. OpenAI and Gemini count reasoning tokens in the output limit, so a small limit can end a reply before it starts. */
export const withThinking = (maxTokens: number) => Math.max(maxTokens, 1000) + 4000;

export function providerRequest(provider: KeyedProvider, model: string, apiKey: string, msgs: AgentMsg[], tools: ToolDef[], maxTokens: number): ProviderRequest {
  if (provider === "anthropic") {
    const b = toAnthropic(msgs, tools);
    return {
      gatewayPath: "anthropic/v1/messages",
      directUrl: "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: maxTokens, system: b.system, messages: b.messages, ...(tools.length ? { tools: b.tools } : {}) }
    };
  }
  if (provider === "openai") {
    // The Responses API, because GPT-6 models need it for tool calls. OpenAI stores nothing (store: false).
    const b = toOpenAiResponses(msgs, tools);
    return {
      gatewayPath: "openai/responses",
      directUrl: "https://api.openai.com/v1/responses",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: {
        model,
        ...(b.instructions ? { instructions: b.instructions } : {}),
        input: b.input,
        max_output_tokens: withThinking(maxTokens),
        store: false,
        include: ["reasoning.encrypted_content"],
        ...(tools.length ? { tools: b.tools } : {})
      }
    };
  }
  const path = `v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    gatewayPath: `google-ai-studio/${path}`,
    directUrl: `https://generativelanguage.googleapis.com/${path}`,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: { ...toGemini(msgs, tools), generationConfig: { maxOutputTokens: withThinking(maxTokens) } }
  };
}

export function parseProvider(provider: KeyedProvider, data: unknown): ModelOutput {
  return provider === "anthropic" ? parseAnthropic(data) : provider === "openai" ? parseOpenAiResponses(data) : parseGemini(data);
}

/* Workers AI. Tool results go back as plain text, which every Workers AI chat model accepts. */

export function toWorkersAi(msgs: AgentMsg[], tools: ToolDef[]) {
  const messages: Array<{ role: string; content: string }> = [];
  for (const m of msgs) {
    if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((c) => `I called ${c.name} with ${JSON.stringify(c.args)}.`).join("\n");
      const content = [m.content, calls].filter((x) => x.trim()).join("\n");
      if (content) messages.push({ role: "assistant", content });
    } else if (m.role === "tool") messages.push({ role: "user", content: `Result of ${m.name ?? "the action"}: ${m.content}` });
    else messages.push({ role: m.role, content: m.content });
  }
  return { messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
}

export function parseWorkersAi(out: unknown): ModelOutput {
  if (typeof out === "string") return { text: out, toolCalls: [] };
  const o = (out ?? {}) as {
    response?: unknown;
    tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } }>;
    choices?: unknown;
  };
  if (o.choices) return parseOpenAi(o);
  const calls = (o.tool_calls ?? [])
    .map((c) => ({ id: c.id || genId(), name: c.name ?? c.function?.name ?? "", args: parseArgs(c.arguments ?? c.function?.arguments) }))
    .filter((c) => c.name);
  const text = typeof o.response === "string" ? o.response : o.response && typeof o.response === "object" ? JSON.stringify(o.response) : "";
  return { text, toolCalls: calls };
}

/* Dev-scripted provider for local tests without an AI account. */

/**
 * Turns lines like `/tool update_column {"columnId":"...","name":"QA"}` in the last user message into tool calls.
 * After tool results, it reports them. Use only for development and tests.
 */
export function runDevScripted(msgs: AgentMsg[]): ModelOutput {
  const lastUser = [...msgs].reverse().findIndex((m) => m.role === "user");
  const tail = lastUser === -1 ? [] : msgs.slice(msgs.length - lastUser);
  const results = tail.filter((m): m is Extract<AgentMsg, { role: "tool" }> => m.role === "tool");
  if (results.length) return { text: `Done.\n${results.map((r) => `- ${r.content}`).join("\n")}`, toolCalls: [] };
  const user = lastUser === -1 ? "" : (msgs[msgs.length - 1 - lastUser] as { content: string }).content;
  const calls: ToolCall[] = [];
  for (const line of user.split("\n")) {
    const m = line.trim().match(/^\/tool\s+([a-z_]+)\s*(\{.*\})?\s*$/);
    if (m) calls.push({ id: genId(), name: m[1], args: parseArgs(m[2] ?? "{}") });
  }
  if (calls.length) return { text: "", toolCalls: calls };
  return { text: `(dev-scripted provider) Send lines like "/tool create_task {\\"title\\":\\"Test\\"}" to call tools. You said: ${user}`, toolCalls: [] };
}
