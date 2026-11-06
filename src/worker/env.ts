import type { User } from "../shared/types";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;

  APP_NAME: string;
  APP_URL?: string;
  EMAIL_FROM: string;
  SIGNUP_MODE?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  /** A small, fast model for the scope check. Empty uses the default for the provider. */
  AI_SCOPE_MODEL?: string;
  /** Vectorize index for search by meaning. Optional: without it, search uses words only. */
  VECTORS?: VectorizeIndex;
  /** Workers AI embedding model. It must give vectors with the index's dimensions (768). */
  AI_EMBED_MODEL?: string;
  /** Secret. When set, Jev (TypeSafe) runs the scope check. */
  TYPESAFE_API_KEY?: string;
  /** A versioned Jev model, such as jev-1.14.0. Empty uses the pinned default. */
  TYPESAFE_MODEL?: string;
  /** Optional. Another base URL for the TypeSafe API, such as a gateway. */
  TYPESAFE_BASE_URL?: string;
  AI_GATEWAY_ID?: string;
  CF_ACCOUNT_ID?: string;

  // Secrets
  RESEND_API_KEY?: string;
  AUTH_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User | null };
};
