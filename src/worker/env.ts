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
