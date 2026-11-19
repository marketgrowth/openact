/*
 * Live check of the models people can choose for their own AI.
 * Every model in COMPANY_AI_MODELS must pass before it goes on the list, because the agent depends on tool calls.
 *
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... npm run ai:check
 *   npm run ai:check -- openai          (one provider)
 *   npm run ai:check -- gpt-6.2-sol     (one model)
 *
 * Providers without a key are skipped. Set CF_ACCOUNT_ID and AI_GATEWAY_ID (and AI_GATEWAY_TOKEN when the gateway needs it)
 * to send the requests through your AI Gateway, the same way a deploy does. Each model costs a few cents at most.
 *
 * Steps for each model, with the request code the agent uses (providerRequest in messages.ts):
 *   1. tool call: the model must call create_task with a title.
 *   2. next step: the tool result goes back with the provider's replay items. The model must answer.
 *   3. resumed run: the same history without replay items, as after an approval in the web app. The provider must accept it.
 *   4. topic check model: a short request with no tools.
 */
import { COMPANY_AI_MODELS, COMPANY_AI_PROVIDERS, COMPANY_AI_SCOPE_MODELS, type CompanyAiProvider } from "../packages/core/src/shared/ai.ts";
import { parseProvider, providerRequest, type AgentMsg, type ModelOutput, type ToolDef } from "../apps/projects/src/server/agent/messages.ts";

const KEYS: Record<CompanyAiProvider, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GEMINI_API_KEY
};

const gateway = process.env.CF_ACCOUNT_ID && process.env.AI_GATEWAY_ID ? `https://gateway.ai.cloudflare.com/v1/${process.env.CF_ACCOUNT_ID}/${process.env.AI_GATEWAY_ID}/` : null;
const gatewayAuth: Record<string, string> = process.env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${process.env.AI_GATEWAY_TOKEN}` } : {};

const TOOLS: ToolDef[] = [
  {
    name: "create_task",
    description: "Create one task in the current project.",
    parameters: {
      type: "object",
      properties: { title: { type: "string", description: "The task title. Start with a verb." }, priority: { type: "string", enum: ["high", "med", "low"] } },
      required: ["title"],
      additionalProperties: false
    }
  }
];

async function call(provider: CompanyAiProvider, model: string, msgs: AgentMsg[], tools: ToolDef[], maxTokens: number): Promise<ModelOutput> {
  const req = providerRequest(provider, model, KEYS[provider]!, msgs, tools, maxTokens);
  const url = gateway ? gateway + req.gatewayPath : req.directUrl;
  const res = await fetch(url, { method: "POST", headers: { ...req.headers, ...(gateway ? gatewayAuth : {}) }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(90000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`status ${res.status}: ${text.slice(0, 300)}`);
  return parseProvider(provider, JSON.parse(text));
}

async function checkModel(provider: CompanyAiProvider, model: string): Promise<string[]> {
  const problems: string[] = [];
  const history: AgentMsg[] = [
    { role: "system", content: "You manage tasks in one project. Use the tools to change the project. Keep replies short." },
    { role: "user", content: 'Add a high priority task called "Check the AI setup".' }
  ];
  const first = await call(provider, model, history, TOOLS, 1200);
  const tc = first.toolCalls.find((c) => c.name === "create_task");
  if (!tc) return [`step 1: no create_task call. Reply: ${first.text.slice(0, 120)}`];
  if (typeof tc.args.title !== "string" || !tc.args.title.trim()) problems.push("step 1: create_task has no title");

  const results: AgentMsg[] = first.toolCalls.map((c) => ({ role: "tool", toolCallId: c.id, name: c.name, content: c.id === tc.id ? `Created the task "${String(tc.args.title)}".` : "This action did not run." }));
  const withReplay: AgentMsg[] = [...history, { role: "assistant", content: first.text, toolCalls: first.toolCalls, ...(first.replay ? { replay: first.replay } : {}) }, ...results];
  try {
    const second = await call(provider, model, withReplay, TOOLS, 1200);
    if (!second.text.trim() && !second.toolCalls.length) problems.push("step 2: empty answer after the tool result");
  } catch (e) {
    problems.push(`step 2: ${(e as Error).message}`);
  }

  const resumed: AgentMsg[] = [...history, { role: "assistant", content: first.text, toolCalls: first.toolCalls }, ...results];
  try {
    await call(provider, model, resumed, TOOLS, 1200);
  } catch (e) {
    problems.push(`step 3: ${(e as Error).message}`);
  }
  return problems;
}

async function checkScope(provider: CompanyAiProvider, model: string): Promise<string[]> {
  try {
    const out = await call(provider, model, [{ role: "system", content: "Answer with one word: yes or no." }, { role: "user", content: "Is a task list part of a project?" }], [], 120);
    return out.text.trim() ? [] : ["empty answer"];
  } catch (e) {
    return [(e as Error).message];
  }
}

const only = process.argv.slice(2).filter((a) => a !== "--");
let failed = 0;
let ran = 0;
console.log(`AI model check, ${gateway ? "through AI Gateway" : "straight to each provider"}.\n`);
for (const provider of COMPANY_AI_PROVIDERS) {
  const wanted = (id: string) => !only.length || only.includes(provider) || only.includes(id);
  if (!KEYS[provider]) {
    console.log(`- ${provider}: skipped, no key`);
    continue;
  }
  const jobs: Array<[string, () => Promise<string[]>]> = COMPANY_AI_MODELS[provider].filter((m) => wanted(m.id)).map((m) => [m.id, () => checkModel(provider, m.id)]);
  if (wanted(COMPANY_AI_SCOPE_MODELS[provider])) jobs.push([`${COMPANY_AI_SCOPE_MODELS[provider]} (topic check)`, () => checkScope(provider, COMPANY_AI_SCOPE_MODELS[provider])]);
  for (const [label, job] of jobs) {
    ran++;
    let problems: string[];
    try {
      problems = await job();
    } catch (e) {
      problems = [(e as Error).message];
    }
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"} ${provider} ${label}${problems.length ? `\n     ${problems.join("\n     ")}` : ""}`);
  }
}
console.log(`\n${ran - failed} of ${ran} passed.${failed ? " Take a failing model off COMPANY_AI_MODELS, or fix the converter, before you merge." : ""}`);
process.exit(failed ? 1 : 0);
