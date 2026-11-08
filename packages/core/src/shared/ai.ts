/*
 * The AI agent of a company.
 * A company owner can replace the deploy's AI with their own provider and API key.
 * Without a company setting, the company uses the deploy default (AI_PROVIDER and AI_MODEL).
 */

/** Providers a company can choose. Start with Anthropic. Add more here and in the core's key check. */
export const COMPANY_AI_PROVIDERS = ["anthropic"] as const;
export type CompanyAiProvider = (typeof COMPANY_AI_PROVIDERS)[number];

export const COMPANY_AI_PROVIDER_LABELS: Record<CompanyAiProvider, string> = { anthropic: "Claude (Anthropic)" };

export interface AiModelChoice {
  id: string;
  label: string;
  help: string;
}

/** The models a company can choose, by provider. The first one is the recommended default. */
export const COMPANY_AI_MODELS: Record<CompanyAiProvider, AiModelChoice[]> = {
  anthropic: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", help: "Strong at planning and tool use. A good default." },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", help: "The fastest and lowest cost." },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", help: "The strongest model. It costs the most." }
  ]
};

/** The small, fast model for the topic check, by provider. */
export const COMPANY_AI_SCOPE_MODELS: Record<CompanyAiProvider, string> = { anthropic: "claude-haiku-5-5" };

/** The longest API key we accept. Real keys are much shorter. */
export const AI_KEY_MAX = 300;

/** GET /api/companies/:id/ai. The API key never comes back, only its last 4 characters. */
export interface CompanyAiSettings {
  /** "default" means the company uses the deploy default. */
  provider: CompanyAiProvider | "default";
  /** The chosen model, or null with the deploy default. */
  model: string | null;
  /** The last 4 characters of the saved key, or null. */
  keyHint: string | null;
  /** True when a key is saved but this deploy cannot read it, for example after AUTH_SECRET changed. */
  keyBroken: boolean;
  /** The deploy default, so the page can say what "default" means. */
  deployDefault: { provider: string; model: string };
  /** True when this person can change the setting. Only company owners can. */
  canEdit: boolean;
}

export function isCompanyAiProvider(v: unknown): v is CompanyAiProvider {
  return typeof v === "string" && (COMPANY_AI_PROVIDERS as readonly string[]).includes(v);
}

export function isCompanyAiModel(provider: CompanyAiProvider, model: unknown): model is string {
  return typeof model === "string" && COMPANY_AI_MODELS[provider].some((m) => m.id === model);
}

/** A readable name for a model id, such as "Claude Sonnet 5.5". Unknown ids come back as they are. */
export function aiModelLabel(model: string): string {
  for (const list of Object.values(COMPANY_AI_MODELS)) {
    const found = list.find((m) => m.id === model);
    if (found) return found.label;
  }
  return model;
}

/** Cleans a pasted API key. Returns a problem as text, or the clean key. */
export function cleanApiKey(provider: CompanyAiProvider, raw: unknown): { key: string } | { problem: string } {
  if (typeof raw !== "string") return { problem: "Paste the API key as text." };
  const key = raw.trim();
  if (!key) return { problem: "Paste the API key." };
  if (key.length > AI_KEY_MAX || /\s/.test(key)) return { problem: "This does not look like an API key. Copy it again, without spaces." };
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) return { problem: "Anthropic API keys start with sk-ant-. Copy the key again from console.anthropic.com." };
  return { key };
}

/** The last 4 characters of a key, so people can tell which key is saved. */
export const keyHintOf = (key: string) => key.slice(-4);
