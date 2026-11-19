import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { STATUSES } from "../shared/types";
import { extractJson, toPlannedTasks } from "./plan";
import { requireRole, toTask, type TaskRow } from "./data";
import { effectiveLevel, parsePolicy } from "../shared/agent-policy";
import { HttpError, dateOrNull, readJson, requireUser, text, todayIso } from "./util";
import { aiSetup, deployAi, runModel, type AiSetup } from "./agent/model";

/*
 * AI features. Every request goes through Cloudflare AI Gateway when AI_GATEWAY_ID is set,
 * so you get logs, caching, rate limits and spend controls in one place.
 *
 * The provider, model and key come from aiSetup (agent/model.ts):
 *   the person's own AI, when they set one in Personal account, under My AI, and their company allows it, or
 *   the company's own AI, when a company owner set one in Company settings, under AI provider, or
 *   the deploy default from AI_PROVIDER:
 *     workers-ai (default) uses the Workers AI binding. No API key needed.
 *     anthropic            uses the Anthropic API through AI Gateway. Needs ANTHROPIC_API_KEY and CF_ACCOUNT_ID.
 *     openai               uses the OpenAI Responses API through AI Gateway. Needs OPENAI_API_KEY and CF_ACCOUNT_ID.
 */

interface ChatMessage {
  role: "system" | "user";
  content: string;
}



export async function runChat(env: Env, setup: AiSetup, messages: ChatMessage[], maxTokens = 1500): Promise<string> {
  // dev-scripted has no chat model, so plan and summary use Workers AI, as before.
  const p = setup.provider === "dev-scripted" ? "workers-ai" : setup.provider;
  const m = setup.provider === "dev-scripted" ? deployAi({ ...env, AI_PROVIDER: "workers-ai" }).model : setup.model;

  // Anthropic, OpenAI and Gemini share the agent's request code, with no tools.
  if (p === "anthropic" || p === "openai" || p === "google") {
    const out = await runModel(env, setup, messages, [], maxTokens);
    return out.text;
  }

  // Workers AI through the binding.
  const input = { messages, max_tokens: maxTokens };
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  let out: unknown;
  try {
    try {
      out = await env.AI.run(m as Parameters<Ai["run"]>[0], input as never, gatewayId ? ({ gateway: { id: gatewayId } } as never) : undefined);
    } catch (err) {
      if (!gatewayId || /run remotely/i.test(String(err))) throw err;
      // If the gateway is missing or misconfigured, still answer, and say so in the logs.
      console.warn(`[openact] AI Gateway "${gatewayId}" failed, so the request ran without it:`, err);
      out = await env.AI.run(m as Parameters<Ai["run"]>[0], input as never);
    }
  } catch (err) {
    if (/run remotely/i.test(String(err))) {
      throw new HttpError(503, "AI needs a connection to Cloudflare. For local development, run `npx wrangler login`, then `npm run dev:ai`.");
    }
    console.error("[openact] Workers AI failed:", err);
    throw new HttpError(502, "The AI service did not answer. Try again in a minute.");
  }
  return readWorkersAiText(out);
}

function readWorkersAiText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object") {
    const o = out as { response?: unknown; choices?: Array<{ message?: { content?: string } }> };
    if (typeof o.response === "string") return o.response;
    if (o.response && typeof o.response === "object") return JSON.stringify(o.response);
    if (o.choices?.[0]?.message?.content) return o.choices[0].message.content;
  }
  return "";
}


/** Checks the role, and that the project's AI policy has not turned AI off for that role. */
async function requireAiRole(env: Env, projectId: string, userId: string, min: "viewer" | "editor"): Promise<AiSetup> {
  const role = await requireRole(env, projectId, userId, min);
  const row = await env.DB.prepare("SELECT ai_policy, company_id FROM projects WHERE id = ?").bind(projectId).first<{ ai_policy: string; company_id: string | null }>();
  if (effectiveLevel(role, parsePolicy(row?.ai_policy)) === "off") {
    throw new HttpError(403, "AI is turned off for your role in this project. A project owner can change this in Project settings.");
  }
  return aiSetup(env, row?.company_id, userId);
}

export const aiRoutes = new Hono<AppEnv>();

/** Drafts tasks for a goal. Nothing is saved until the person adds the drafts. */
aiRoutes.post("/:id/ai/plan", async (c) => {
  const user = requireUser(c);
  const projectId = c.req.param("id");
  const ai = await requireAiRole(c.env, projectId, user.id, "editor");
  const body = await readJson(c);
  const goal = text(body.goal, "Goal", { max: 2000, required: true });
  const start = dateOrNull(body.start, "Start date") ?? todayIso();
  const phases = await c.env.DB.prepare("SELECT DISTINCT phase FROM tasks WHERE project_id = ? AND phase != ''").bind(projectId).all<{ phase: string }>();

  const reply = await runChat(c.env, ai, [
    {
      role: "system",
      content:
        "You plan projects for small teams. Reply with JSON only, no other text. " +
        'Use this shape: {"tasks":[{"title":"","phase":"","priority":"high|med|low","startOffsetDays":0,"durationDays":1,"notes":""}]}. ' +
        "Write 5 to 15 tasks in the order they happen. Titles start with a verb and have fewer than 8 words. " +
        "Group tasks into 2 to 5 phases. startOffsetDays counts calendar days from the project start. " +
        "Notes are one short sentence, or empty. Do not invent names of people."
    },
    {
      role: "user",
      content: `Goal: ${goal}\nProject start: ${start}\n${phases.results.length ? `Phases already in use: ${phases.results.map((p) => p.phase).join(", ")}\n` : ""}`
    }
  ]);
  const tasks = toPlannedTasks(extractJson(reply), start);
  if (!tasks.length) throw new HttpError(502, "The AI reply had no usable tasks. Try again, or add more detail to the goal.");
  return c.json({ tasks });
});

/** Writes a short status update from the current tasks. */
aiRoutes.post("/:id/ai/summary", async (c) => {
  const user = requireUser(c);
  const projectId = c.req.param("id");
  const ai = await requireAiRole(c.env, projectId, user.id, "viewer");
  const project = await c.env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(projectId).first<{ name: string }>();
  const rows = await c.env.DB.prepare(
    "SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.start_date"
  )
    .bind(projectId)
    .all<TaskRow & { assignee_name: string | null }>();
  if (!rows.results.length) throw new HttpError(400, "Add some tasks first. Then ask for a summary.");
  const label = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
  // Send only what the summary needs. Emails and notes stay out of the prompt.
  const lines = rows.results.map((r) => {
    const t = toTask(r);
    return `- ${t.title} | ${label[t.status]} | ${t.priority} | ${t.phase || "no phase"} | ${t.start ?? "no start"} to ${t.end ?? "no end"} | ${r.assignee_name ?? "unassigned"}`;
  });
  const reply = await runChat(
    c.env,
    ai,
    [
      {
        role: "system",
        content:
          "You write short project status updates. Use plain, simple English and short sentences. " +
          "Use 3 to 6 bullet points that start with '- '. Cover what is done, what is in progress, what is late, and what is due next. " +
          "Name a risk only if the data shows it. Do not invent facts. No headings."
      },
      { role: "user", content: `Project: ${project?.name}\nToday: ${todayIso()}\nTasks (title | status | priority | phase | dates | assignee):\n${lines.join("\n")}` }
    ],
    700
  );
  const summary = reply.trim();
  if (!summary) throw new HttpError(502, "The AI service sent an empty reply. Try again.");
  return c.json({ summary });
});

