import type { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import type { User } from "../shared/types";
import { COMPANY_ROLES } from "../shared/types";
import { PERMISSION_ID, permissionApp, type PermissionDef } from "../shared/permissions";
import type { CopyCount } from "../shared/site";
import type { CompanyCopyContext } from "./company-copy";
import type { ToolInputSchema } from "./mcp-rpc";

/*
 * Server side of an OpenAct app.
 *
 * The core owns sign-in, people, companies and roles. An app owns its own tables and routes,
 * and joins the core through the hooks below. The host lists the installed apps, and
 * createWorker() mounts them in that order.
 */

export interface ServerApp {
  /** A short, unique id in lowercase, such as "projects". Prefix your tables, routes and file keys with it. */
  id: string;
  name: string;
  /** Adds the app's API routes. New apps should use /api/apps/<id>/... */
  routes?: (api: Hono<AppEnv>) => void;
  /** Middleware that runs on every API request, after the session is read. */
  middleware?: MiddlewareHandler<AppEnv>[];
  /**
   * What people can do in the app, by company role. Ids start with the app id, such as "projects.create".
   * Check them in routes with requirePermission(). Company owners and admins can change the roles in Company settings.
   */
  permissions?: Record<string, PermissionDef>;
  /** Runs on each cron trigger. `cron` is the schedule that fired. */
  scheduled?: (env: Env, cron: string) => Promise<void>;
  hooks?: AppHooks;
  /**
   * Server functions that other apps may call when this app is installed, by name.
   * Another app reads one with appService(appId, name). Use it for an optional link between apps,
   * where a static import would break the build when this app is not installed.
   * A service does not check the caller's access. The calling app checks its own permissions first.
   */
  services?: Record<string, unknown>;
  /**
   * Tools that AI agents can call through the MCP endpoint (/mcp), when the site turns on agent access.
   * An agent acts for one person in one company, and never does more than that person's role allows.
   * See docs/agent-access.md.
   */
  tools?: AgentTool[];
  /**
   * Hostnames that the app answers itself, outside the web app, such as a company's own domain for published pages.
   * For a request to any host that is not the deploy's own (APP_URL), the Worker asks each app's `owns`, in install order.
   * The first app that answers true gets the whole request in `fetch`. That host has no /api, no session and no web app.
   * See "Serve your own hostnames" in docs/apps.md.
   */
  hosts?: HostHandler;
}

/** How an app serves hostnames of its own. */
export interface HostHandler {
  /**
   * True when the app serves this hostname (lowercase, no port). It runs on every request to a host that is not the
   * deploy's own, so keep it fast: cache the answer for a short time. Never answer true for the deploy's own host.
   * An error counts as false.
   */
  owns: (env: Env, hostname: string) => Promise<boolean>;
  /**
   * Answers a request to a host that the app owns. Call loadSite(env) first if you check app or plan state.
   * An error answers 500 with a plain message.
   */
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

/** One tool of an app for AI agents (MCP). */
export interface AgentTool {
  /** "<app id>_<action>", such as "projects_list". Lowercase letters, numbers and underscores. */
  name: string;
  /** A short title for people, such as "List projects". */
  title: string;
  /** What the tool does and when to use it, for the agent. Say what it returns. */
  description: string;
  inputSchema: ToolInputSchema;
  /**
   * The permission the person needs in the company, such as "projects.browse". The core checks it before every call,
   * with the app on/off state and the plan. Required unless the tool is public.
   */
  permission?: string;
  /** True when the tool only reads. Tools that change data need the "mcp:write" scope, which the person allows on the consent screen. */
  readOnly?: boolean;
  /**
   * True when anyone may call the tool without sign-in, at /mcp/public. A public tool gets no person and no company.
   * Use it only for data that is public anyway, such as a free check of a website.
   */
  public?: boolean;
  run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolOutput>;
}

export interface ToolContext {
  env: Env;
  /** The person the agent acts for. Null for a public tool called without sign-in. */
  user: User | null;
  /** The company the person picked when they connected the agent. Null for a public tool called without sign-in. */
  companyId: string | null;
  /** The site's address, such as https://app.example.com. */
  origin: string;
  waitUntil: (p: Promise<unknown>) => void;
}

/** Text for the agent, and optional data in a fixed shape. Throw HttpError for a problem the agent should read. */
export type ToolOutput = string | { text: string; data?: Record<string, unknown> };

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

function checkTool(app: ServerApp, tool: AgentTool, seen: Set<string>): void {
  const prefix = `${app.id.replace(/-/g, "_")}_`;
  if (!TOOL_NAME.test(tool.name) || !tool.name.startsWith(prefix))
    throw new Error(`Tool "${tool.name}" must start with "${prefix}" and use lowercase letters, numbers and underscores (64 at most).`);
  if (seen.has(tool.name)) throw new Error(`Two tools use the name "${tool.name}".`);
  seen.add(tool.name);
  if (!tool.title || !tool.description) throw new Error(`Tool "${tool.name}" needs a title and a description.`);
  if (tool.inputSchema?.type !== "object") throw new Error(`Tool "${tool.name}" needs an inputSchema of type "object".`);
  if (tool.permission && !app.permissions?.[tool.permission])
    throw new Error(`Tool "${tool.name}" uses the permission "${tool.permission}", but the app does not declare it.`);
  if (!tool.permission && !tool.public) throw new Error(`Tool "${tool.name}" needs a permission, or public: true.`);
  if (tool.public && !tool.readOnly) throw new Error(`Public tool "${tool.name}" must be readOnly. Tools that change data need sign-in.`);
}

export interface AppHooks {
  /** Return true to let this email sign up even when sign-up is limited, for example because of a pending invitation. */
  allowSignup?: (env: Env, email: string) => Promise<boolean>;
  /** Runs after a person signs in, before company invitations are applied. */
  signedIn?: (env: Env, user: User) => Promise<void>;
  /** Runs when a person leaves or is removed from a company. Remove their access to the app's data in it. */
  companyMemberRemoved?: (env: Env, companyId: string, userId: string) => Promise<void>;
  /** Runs when a person deletes their account, after they leave each company. Delete the app's personal data for them, such as settings or a profile. */
  userDeleting?: (env: Env, userId: string) => Promise<void>;
  /** Runs before a company is deleted. Delete the app's data and files for it. */
  companyDeleting?: (env: Env, companyId: string) => Promise<void>;
  /** Extra fields for GET /api/companies/:id, such as the app's company settings. */
  companyDetail?: (env: Env, companyId: string) => Promise<Record<string, unknown>>;
  /** Handles the app's fields in PATCH /api/companies/:id. Return true when it changed something. */
  companyUpdate?: (env: Env, companyId: string, body: Record<string, unknown>) => Promise<boolean>;
  /** Settings for a new company, such as defaults. Runs after the company row exists. */
  companyCreated?: (env: Env, companyId: string, userId: string) => Promise<void>;
  /**
   * Runs when a super admin duplicates a company, after the new company exists. Copy the app's data and files
   * from ctx.fromId to ctx.toId with the tools in ctx. Leave out people, comments, share links and history.
   * Return what you copied, for the summary. If the hook throws, the core deletes the new company.
   * Without this hook, the new company starts with none of the app's data.
   */
  companyDuplicating?: (env: Env, ctx: CompanyCopyContext) => Promise<CopyCount[]>;
}

export function defineServerApp(app: ServerApp): ServerApp {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(app.id)) throw new Error(`App id "${app.id}" must be lowercase letters, numbers and dashes.`);
  for (const [id, def] of Object.entries(app.permissions ?? {})) {
    if (!PERMISSION_ID.test(id) || permissionApp(id) !== app.id) throw new Error(`Permission "${id}" must start with "${app.id}.", such as "${app.id}.edit".`);
    if (!def.label || !def.roles.every((r) => (COMPANY_ROLES as readonly string[]).includes(r)))
      throw new Error(`Permission "${id}" needs a label and roles from owner, admin, member and guest.`);
    if (def.roles.includes("guest") && !def.guests) throw new Error(`Permission "${id}" gives guests access. Set guests: true if that is safe.`);
  }
  const seen = new Set<string>();
  for (const tool of app.tools ?? []) checkTool(app, tool, seen);
  return app;
}

let installed: ServerApp[] = [];

/** The installed apps, in order. createWorker() sets them. */
export function setApps(apps: ServerApp[]): void {
  const ids = new Set<string>();
  for (const a of apps) {
    if (ids.has(a.id)) throw new Error(`Two apps use the id "${a.id}".`);
    ids.add(a.id);
  }
  const tools = new Set<string>();
  for (const a of apps)
    for (const t of a.tools ?? []) {
      if (tools.has(t.name)) throw new Error(`Two apps use the tool name "${t.name}".`);
      tools.add(t.name);
    }
  installed = apps;
}

export const getApps = (): readonly ServerApp[] => installed;

/**
 * A service of another installed app, or undefined when that app is not installed or has no such service.
 * The caller gives the type. Check that the app is on for the company with companyAppState before you use it.
 */
export function appService<T>(appId: string, name: string): T | undefined {
  return installed.find((a) => a.id === appId)?.services?.[name] as T | undefined;
}

/** Runs a hook in every app that has it, in install order. */
export async function runHook<K extends keyof AppHooks>(
  name: K,
  ...args: Parameters<NonNullable<AppHooks[K]>>
): Promise<Array<Awaited<ReturnType<NonNullable<AppHooks[K]>>>>> {
  const out: Array<Awaited<ReturnType<NonNullable<AppHooks[K]>>>> = [];
  for (const app of installed) {
    const fn = app.hooks?.[name] as ((...a: unknown[]) => Promise<never>) | undefined;
    if (fn) out.push(await fn(...args));
  }
  return out;
}
