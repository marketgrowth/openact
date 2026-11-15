/*
 * Which app a path belongs to, and where each app starts.
 * The app rail uses these rules to light the active app and show its panel.
 */

/** The shell's Apps page: the apps in this company, and apps from the directory. The rail's App directory icon opens it. */
export const APPS_PATH = "/apps";

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

/** The app rail in groups: the primary app on its own, then the other apps in install order. */
export interface RailGroups<A> {
  /** The deploy's primary app, such as a company's own app. Undefined when there is none, or when it is off or has no rail icon. */
  primary: A | undefined;
  /** The other rail apps, such as Projects and Docs, in install order. */
  others: A[];
}

/** Splits the rail apps into the primary app and the others. */
export function railGroups<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): RailGroups<A> {
  const rail = railApps(apps);
  const primary = primaryId ? rail.find((a) => a.id === primaryId) : undefined;
  return { primary, others: rail.filter((a) => a !== primary) };
}

/** The rail apps in the order the rail shows them: the primary app first, then the others. */
export function railOrder<A extends AppPathInfo>(apps: readonly A[], primaryId?: string | null): A[] {
  const { primary, others } = railGroups(apps, primaryId);
  return primary ? [primary, ...others] : others;
}

/** Where an app starts: its own `home`, "/" for the first app with a home page, or /a/<id>. */
export function appHome(app: AppPathInfo, apps: readonly AppPathInfo[]): string {
  if (app.home) return app.home;
  if (app.Home && apps.find((a) => a.Home) === app) return "/";
  return `/a/${app.id}`;
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
