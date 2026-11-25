/*
 * Bring your own AI.
 * The deploy has a default AI (AI_PROVIDER and AI_MODEL). A company owner can replace it for the company.
 * Each person can replace both with their own provider, model and API key, when their company allows it.
 * Order for each request: the person's own AI, then the company AI, then the deploy default.
 */

/** Providers a company or a person can choose. Each one needs a converter in the agent and a key check in the core. */
export const COMPANY_AI_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type CompanyAiProvider = (typeof COMPANY_AI_PROVIDERS)[number];

export const COMPANY_AI_PROVIDER_LABELS: Record<CompanyAiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "GPT (OpenAI)",
  google: "Gemini (Google)"
};

/** Where to make a key, by provider. */
export const AI_KEY_LINKS: Record<CompanyAiProvider, { url: string; name: string; placeholder: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", name: "console.anthropic.com", placeholder: "sk-ant-..." },
  openai: { url: "https://platform.openai.com/api-keys", name: "platform.openai.com", placeholder: "sk-..." },
  google: { url: "https://aistudio.google.com/apikey", name: "aistudio.google.com", placeholder: "Your Gemini API key" }
};

export interface AiModelChoice {
  id: string;
  label: string;
  help: string;
}

/**
 * The models people can choose, by provider. The first one is the recommended default.
 * List only models that pass `npm run ai:check`: a real request with tools, a tool result, and a second step.
 * The agent depends on tool calls, so a model that is weak at tool use does not go on this list.
 */
export const COMPANY_AI_MODELS: Record<CompanyAiProvider, AiModelChoice[]> = {
  anthropic: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", help: "Strong at planning and tool use. A good default." },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", help: "The fastest and lowest cost." },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", help: "The strongest model. It costs the most." }
  ],
  openai: [
    { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", help: "OpenAI's model for everyday agent work. A good default." },
    { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", help: "OpenAI's strongest model for hard reasoning. It costs the most." }
  ],
  google: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", help: "Google's model for agents. Fast, and a good default." },
    { id: "gemini-4-argon", label: "Gemini 4 Argon", help: "Google's strongest reasoning model. It costs more." }
  ]
};

/** The small, fast model for the topic check, by provider. The topic check sends no tools. */
export const COMPANY_AI_SCOPE_MODELS: Record<CompanyAiProvider, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-6-luna",
  google: "gemini-3.5-flash-lite"
};

/** The longest API key we accept. Real keys are much shorter. */
export const AI_KEY_MAX = 300;

/** Shown wherever a person or a company adds their own key. */
export const AI_KEY_NOTICE = [
  "Your own key charges your account with the provider for each request.",
  "AI output is not deterministic. The same request can give a different answer.",
  "Always check the work before you use it."
] as const;

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
  /** True when members can use their own AI key in this company. On by default. */
  memberKeys: boolean;
  /** True when this person can change the setting. Only company owners can. */
  canEdit: boolean;
  /**
   * Set when the company belongs to a partner (docs/partners.md). With ownAiRequired, the site's own AI never runs
   * here: the person's key, the company key or, for a client company, the partner's key must be set.
   */
  partner?: {
    name: string;
    /** True for a client company of the partner. */
    isClient: boolean;
    ownAiRequired: boolean;
    /** For a client company: the AI that the partner set, which runs when the company has none. */
    partnerAi: { provider: CompanyAiProvider; model: string } | null;
  } | null;
}

/* Keys for other services, such as TypeSafe (Jev). Company settings, under AI provider. */

export const COMPANY_KEY_SERVICES = ["typesafe"] as const;
export type CompanyKeyService = (typeof COMPANY_KEY_SERVICES)[number];

export const COMPANY_KEY_INFO: Record<CompanyKeyService, { label: string; use: string; url: string; name: string }> = {
  typesafe: {
    label: "TypeSafe (Jev)",
    use: "Jev is a judgment model. Apps use it for fast yes-or-no checks, such as whether a page answers a search.",
    url: "https://console.typesafe.ai/keys",
    name: "console.typesafe.ai"
  }
};

export function isCompanyKeyService(v: unknown): v is CompanyKeyService {
  return typeof v === "string" && (COMPANY_KEY_SERVICES as readonly string[]).includes(v);
}

/** Cleans a pasted service key. */
export function cleanServiceKey(raw: unknown): { key: string } | { problem: string } {
  if (typeof raw !== "string") return { problem: "Paste the API key as text." };
  const key = raw.trim();
  if (!key) return { problem: "Paste the API key." };
  if (key.length < 16 || key.length > AI_KEY_MAX || /\s/.test(key)) return { problem: "This does not look like an API key. Copy it again, without spaces." };
  return { key };
}

/** GET /api/companies/:id/keys. Keys never come back, only their last 4 characters. */
export interface CompanyKeySettings {
  keys: Array<{
    service: CompanyKeyService;
    /** The last 4 characters of this company's own key, or null. */
    keyHint: string | null;
    keyBroken: boolean;
    /** Whose key runs now. "none": the service is off for this company. */
    source: "company" | "partner" | "deploy" | "none";
  }>;
  /** The partner's name, when the company belongs to a partner. */
  partnerName: string | null;
  canEdit: boolean;
}

/** GET /api/me/ai. A person's own AI. The key never comes back, only its last 4 characters. */
export interface UserAiSettings {
  /** "default" means the person uses the company AI or the deploy default. */
  provider: CompanyAiProvider | "default";
  model: string | null;
  keyHint: string | null;
  keyBroken: boolean;
  /** The companies of this person that turned off personal keys. The person's key does not run there. */
  blockedIn: string[];
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
  if (provider === "openai" && (!key.startsWith("sk-") || key.startsWith("sk-ant-"))) {
    return { problem: "OpenAI API keys start with sk-. Copy the key again from platform.openai.com." };
  }
  if (provider === "google" && key.startsWith("sk-")) return { problem: "This looks like an OpenAI or Anthropic key. Copy your Gemini key from aistudio.google.com." };
  return { key };
}

/** The last 4 characters of a key, so people can tell which key is saved. */
export const keyHintOf = (key: string) => key.slice(-4);
