import type { Context } from "hono";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { siteState } from "./site-state";

export class HttpError extends Error {
  /** code: a stable name the web app can act on, such as "no_access". */
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const newId = () => crypto.randomUUID();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function requireUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return user;
}

export function appUrl(c: Context<AppEnv>): string {
  const configured = (c.env.APP_URL || "").trim().replace(/\/+$/, "");
  return configured || new URL(c.req.url).origin;
}

/** The app name: the one a super admin set, or APP_NAME. */
export function appName(env: Env): string {
  return (siteState()?.name || env.APP_NAME || "OpenAct").trim();
}

/* Input checks. Each one throws a 400 with a plain message the web app can show. */

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "Send the request body as JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send the request body as a JSON object.");
  return body as Record<string, unknown>;
}

export function text(v: unknown, field: string, opts: { max: number; required?: boolean }): string {
  if (v === undefined || v === null) {
    if (opts.required) throw new HttpError(400, `${field} is required.`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text.`);
  const s = v.trim();
  if (opts.required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > opts.max) throw new HttpError(400, `${field} is too long. Use ${opts.max} characters or fewer.`);
  return s;
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}.`);
}

export function dateOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z"))) {
    throw new HttpError(400, `${field} must be a date like 2026-11-05.`);
  }
  return v;
}

export function num(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number.`);
  return v;
}

export function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function isEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
