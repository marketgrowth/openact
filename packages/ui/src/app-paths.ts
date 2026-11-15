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
  routes?: ReadonlyArray<{ pattern: RegExp }>;
  ownsPath?: (path: string) => boolean;
}

/** Apps with an icon or a mark show in the app rail. Others, such as the colophon, do not. */
export const railApps = <A extends AppPathInfo>(apps: readonly A[]): A[] => apps.filter((a) => a.icon || a.Mark);

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
