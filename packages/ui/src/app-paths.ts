/*
 * Which app a path belongs to, and where each app starts.
 * The app rail uses these rules to light the active app and show its panel.
 */

/** The shell's Apps page: the apps in this company, and apps from the directory. The rail's App directory icon opens it. */
export const APPS_PATH = "/apps";

/** The shell's Settings page: company settings and, for super admins, site settings. Each section has its own path under it. */
export const SETTINGS_PATH = "/settings";

/** True for the Settings page and its sections. No app owns these paths. */
export const isSettingsPath = (path: string): boolean => path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`);

/** The values of a route's named parts, such as { id: "abc" } for "/p/:id". A missing optional part is undefined. */
export type RouteParams = Readonly<Record<string, string | undefined>>;

/** The part of a page route that these rules read: a named path, or a RegExp in the older style. */
export interface RouteInfo {
  path?: string;
  pattern?: RegExp;
}

/** The parts of an app that these rules read. ClientApp has all of them. */
export interface AppPathInfo {
  id: string;
  icon?: string;
  Mark?: unknown;
  Home?: unknown;
  home?: string;
  /** "end": its own group at the end of the app list, such as Pages. "footer": the bottom of the rail, above Settings, such as Advisory. Default: "apps". */
  railPlacement?: "apps" | "end" | "footer";
  routes?: ReadonlyArray<RouteInfo>;
  publicRoutes?: Readonly<Record<string, unknown>>;
  ownsPath?: (path: string) => boolean;
}

/*
 * Named paths, in the style of React Router and TanStack Router:
 *   "/a/academy/mission/:id"   a required part
 *   "/p/:id/:view?"            an optional part at the end
 *   "/a/files/*"               the rest of the path, as params["*"]
 * A final slash is optional. Parts match one path segment and are URL-decoded.
 */

const warned = new Set<string>();
function warnOnce(msg: string, warn: (msg: string) => void) {
  if (warned.has(msg)) return;
  warned.add(msg);
  warn(msg);
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const compiled = new Map<string, { re: RegExp; keys: string[] }>();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Turns a named path into a RegExp and the names of its parts. Throws on a path it cannot read. */
export function compilePath(path: string): { re: RegExp; keys: string[] } {
  const hit = compiled.get(path);
  if (hit) return hit;
  if (!path.startsWith("/")) throw new Error(`The route path "${path}" must start with "/".`);
  const parts = path.split("/").slice(1);
  if (parts[parts.length - 1] === "") parts.pop();
  const keys: string[] = [];
  let src = "";
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    if (part === "*") {
      if (!last) throw new Error(`In the route path "${path}", "*" must be the last part.`);
      keys.push("*");
      src += "(?:/(.*))?";
    } else if (part.startsWith(":")) {
      const optional = part.endsWith("?");
      const name = part.slice(1, optional ? -1 : undefined);
      if (!NAME.test(name)) throw new Error(`The route path "${path}" has a part "${part}" with a name that is not valid.`);
      if (optional && !last) throw new Error(`In the route path "${path}", only the last part can be optional.`);
      if (keys.includes(name)) throw new Error(`The route path "${path}" uses the name "${name}" two times.`);
      keys.push(name);
      src += optional ? "(?:/([^/]+))?" : "/([^/]+)";
    } else {
      if (!part || /[:*?]/.test(part)) throw new Error(`The route path "${path}" has a part "${part}" that is not valid.`);
      src += "/" + escapeRe(part);
    }
  });
  const out = { re: new RegExp(src ? `^${src}/?$` : "^/$"), keys };
  compiled.set(path, out);
  return out;
}

function decode(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Matches a route against a path. Returns its params and the RegExp match, or null. */
export function matchRoute(route: RouteInfo, path: string): { params: RouteParams; match: RegExpMatchArray } | null {
  if (route.path !== undefined) {
    let c: { re: RegExp; keys: string[] };
    try {
      c = compilePath(route.path);
    } catch (e) {
      // A bad path in one app must not stop the shell. The route never matches.
      warnOnce(`[openact] ${(e as Error).message} This route is off.`, (m) => console.warn(m));
      return null;
    }
    const { re, keys } = c;
    const m = path.match(re);
    if (!m) return null;
    const params: Record<string, string | undefined> = {};
    keys.forEach((k, i) => (params[k] = decode(m[i + 1])));
    return { params, match: m };
  }
  if (!route.pattern) return null;
  const m = path.match(route.pattern);
  return m ? { params: { ...(m.groups ?? {}) }, match: m } : null;
}

/* Route prefixes. */

/** True when the path is an app's own space: /a/<id> or a path under it. */
export const inAppSpace = (id: string, path: string): boolean => path === `/a/${id}` || path.startsWith(`/a/${id}/`);

/** What the shell trusts. Official apps keep short paths, such as /p/... for Projects. */
export interface AppTrust {
  /** The app directory. An app whose id is reserved there is official: `npm run openact` lets only the official source use that id. */
  directory?: ReadonlyArray<{ id: string; reserved?: boolean }>;
  /** Ids that belong to OpenAct and the host, such as "site". `npm run openact` never installs an app with one. */
  systemIds?: readonly string[];
  /** The deploy's primary app. The person who runs the deploy chose it. */
  primary?: string | null;
}

export function isOfficialApp(id: string, trust: AppTrust): boolean {
  if (trust.primary && trust.primary === id) return true;
  if (trust.systemIds?.includes(id)) return true;
  return !!trust.directory?.some((a) => a.id === id && a.reserved === true);
}

/** True when a RegExp can only match inside /a/<id>. */
function patternInSpace(id: string, pattern: RegExp): boolean {
  return new RegExp(`^\\^(?:\\\\)?/a(?:\\\\)?/${escapeRe(id)}(?![A-Za-z0-9-])`).test(pattern.source);
}

/** A copy of the RegExp that matches only inside /a/<id>. Capture groups keep their numbers. */
function confine(id: string, pattern: RegExp): RegExp {
  return new RegExp(`^(?=/a/${escapeRe(id)}(?:/|$))(?:${pattern.source})`, pattern.flags.replace(/[gy]/g, ""));
}

/**
 * Keeps each community app inside its own space, /a/<id>. Official apps pass unchanged.
 * A community app cannot take a page of another app, such as /p/... of Projects, by accident or on purpose.
 *   - Named paths outside the space are dropped.
 *   - RegExp routes only match inside the space.
 *   - Public routes outside the space are dropped.
 *   - A `home` outside the space is dropped, so the default home applies.
 *   - `ownsPath` only answers inside the space.
 * Each problem logs one warning that names the app and the route.
 */
export function guardApps<A extends AppPathInfo>(apps: readonly A[], trust: AppTrust, warn: (msg: string) => void = (m) => console.warn(m)): A[] {
  return apps.map((app) => {
    if (isOfficialApp(app.id, trust)) return app;
    const id = app.id;
    const space = `/a/${id}/`;
    const out: A = { ...app };
    if (app.routes) {
      const routes: RouteInfo[] = [];
      for (const r of app.routes) {
        if (r.path !== undefined) {
          if (inAppSpace(id, r.path)) routes.push(r);
          else warnOnce(`[openact] The app "${id}" has the route "${r.path}" outside ${space}. Community apps can only use paths under ${space}, so this route is off.`, warn);
        } else if (r.pattern) {
          if (!patternInSpace(id, r.pattern))
            warnOnce(`[openact] The app "${id}" has the route ${String(r.pattern)}, which does not start with ${space}. It matches only paths under ${space}.`, warn);
          routes.push({ ...r, pattern: confine(id, r.pattern) });
        }
      }
      (out as AppPathInfo).routes = routes;
    }
    if (app.publicRoutes) {
      const pub: Record<string, unknown> = {};
      for (const [p, page] of Object.entries(app.publicRoutes)) {
        if (inAppSpace(id, p)) pub[p] = page;
        else warnOnce(`[openact] The app "${id}" has the public page "${p}" outside ${space}. Community apps can only use paths under ${space}, so this page is off.`, warn);
      }
      (out as AppPathInfo).publicRoutes = pub;
    }
    if (app.home !== undefined && !inAppSpace(id, app.home)) {
      warnOnce(`[openact] The app "${id}" sets home to "${app.home}", outside ${space}. The default home applies.`, warn);
      delete (out as AppPathInfo).home;
    }
    if (app.ownsPath) {
      const own = app.ownsPath;
      (out as AppPathInfo).ownsPath = (p) => inAppSpace(id, p) && own(p);
    }
    return out;
  });
}

/** Apps with an icon or a mark show in the app rail. Others, such as the colophon, do not. */
export const railApps = <A extends AppPathInfo>(apps: readonly A[]): A[] => apps.filter((a) => a.icon || a.Mark);

/**
 * The app rail in groups: the primary app on its own, the other apps in install order,
 * then the apps with `railPlacement: "end"` in their own group, such as the Pages app.
 */
export interface RailGroups<A> {
  /** The deploy's primary app, such as a company's own app. Undefined when there is none, or when it is off or has no rail icon. */
  primary: A | undefined;
  /** The other rail apps, such as Projects and Docs, in install order. */
  others: A[];
  /** The apps at the end of the app list, below a divider, in install order. */
  end: A[];
  /** Apps with `railPlacement: "footer"`, such as Advisory. Their icons sit at the bottom of the rail, above Settings. */
  footer: A[];
}

/** Splits the rail apps into the primary app, the others, the end group and the footer apps. The primary app stays first, whatever its placement. */
export function railGroups<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): RailGroups<A> {
  const rail = railApps(apps);
  const primary = primaryId ? rail.find((a) => a.id === primaryId) : undefined;
  const rest = rail.filter((a) => a !== primary);
  return {
    primary,
    others: rest.filter((a) => a.railPlacement !== "end" && a.railPlacement !== "footer"),
    end: rest.filter((a) => a.railPlacement === "end"),
    footer: rest.filter((a) => a.railPlacement === "footer")
  };
}

/** The rail apps in the order the rail shows them: the primary app first, then the others, the end group and the footer apps. */
export function railOrder<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): A[] {
  const { primary, others, end, footer } = railGroups(apps, primaryId);
  return [...(primary ? [primary] : []), ...others, ...end, ...footer];
}

/** Where an app starts: its own `home`, "/" for the first app with a home page, or /a/<id>. */
export function appHome(app: AppPathInfo, apps: readonly AppPathInfo[]): string {
  if (app.home) return app.home;
  if (app.Home && apps.find((a) => a.Home) === app) return "/";
  return `/a/${app.id}`;
}

/**
 * An app's own path, `/a/<id>`, goes to its home. Apps use it in links and nav items,
 * so the link works whether or not the app owns "/".
 */
export function resolveAppPath(app: AppPathInfo, apps: readonly AppPathInfo[], path: string): string {
  return path === `/a/${app.id}` ? appHome(app, apps) : path;
}

/** The app with a home page whose own path is `path` (`/a/<id>`, with or without a final slash). */
export function homeAppAt<A extends AppPathInfo>(apps: readonly A[], path: string): A | undefined {
  const m = path.match(/^\/a\/([^/]+)\/?$/);
  return m ? apps.find((a) => a.Home && a.id === m[1]) : undefined;
}

/** True when the path belongs to the app. */
export function appOwnsPath(app: AppPathInfo, apps: readonly AppPathInfo[], path: string): boolean {
  const home = appHome(app, apps);
  if (path === home) return true;
  if (app.ownsPath) return app.ownsPath(path);
  if (home !== "/" && path.startsWith(`${home}/`)) return true;
  if (path.startsWith(`/a/${app.id}/`) || path === `/a/${app.id}`) return true;
  return (app.routes ?? []).some((r) => matchRoute(r, path) !== null);
}

/** The rail app for a path. A path that no rail app owns shows the first rail app. */
export function activeApp<A extends AppPathInfo>(apps: readonly A[], path: string): A | undefined {
  const rail = railApps(apps);
  return rail.find((a) => appOwnsPath(a, apps, path)) ?? rail[0];
}
