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

/** The parts of an app that these rules read. ClientApp has all of them. */
export interface AppPathInfo {
  id: string;
  icon?: string;
  Mark?: unknown;
  Home?: unknown;
  home?: string;
  railPlacement?: "apps" | "end";
  routes?: ReadonlyArray<{ pattern: RegExp }>;
  ownsPath?: (path: string) => boolean;
}

/** Apps with an icon or a mark show in the app rail. Others, such as the colophon, do not. */
export const railApps = <A extends AppPathInfo>(apps: readonly A[]): A[] => apps.filter((a) => a.icon || a.Mark);

/**
 * The app rail in groups: the primary app on its own, the other apps in install order,
 * then the apps with `railPlacement: "end"` in their own group, such as an outside tool like EmDash.
 */
export interface RailGroups<A> {
  /** The deploy's primary app, such as a company's own app. Undefined when there is none, or when it is off or has no rail icon. */
  primary: A | undefined;
  /** The other rail apps, such as Projects and Docs, in install order. */
  others: A[];
  /** The apps at the end of the app list, below a divider, in install order. */
  end: A[];
}

/** Splits the rail apps into the primary app, the others and the end group. The primary app stays first, whatever its placement. */
export function railGroups<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): RailGroups<A> {
  const rail = railApps(apps);
  const primary = primaryId ? rail.find((a) => a.id === primaryId) : undefined;
  const rest = rail.filter((a) => a !== primary);
  return { primary, others: rest.filter((a) => a.railPlacement !== "end"), end: rest.filter((a) => a.railPlacement === "end") };
}

/** The rail apps in the order the rail shows them: the primary app first, then the others, then the end group. */
export function railOrder<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): A[] {
  const { primary, others, end } = railGroups(apps, primaryId);
  return [...(primary ? [primary] : []), ...others, ...end];
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
  if (app.ownsPath) return app.ownsPath(path);
  const home = appHome(app, apps);
  if (path === home) return true;
  if (home !== "/" && path.startsWith(`${home}/`)) return true;
  if (path.startsWith(`/a/${app.id}/`) || path === `/a/${app.id}`) return true;
  return (app.routes ?? []).some((r) => r.pattern.test(path));
}

/** The rail app for a path. A path that no rail app owns shows the first rail app. */
export function activeApp<A extends AppPathInfo>(apps: readonly A[], path: string): A | undefined {
  const rail = railApps(apps);
  return rail.find((a) => appOwnsPath(a, apps, path)) ?? rail[0];
}
