import type { Env } from "./env.ts";
import type { ServerApp } from "./apps.ts";

/*
 * Hostnames that apps serve themselves, such as a company's own domain for Pages.
 * Pure, so tests can load it without the Worker.
 */

/** The deploy's own hostname, from APP_URL. Null when APP_URL is empty: then apps with hosts are asked about every host. */
export function deployHost(env: Pick<Env, "APP_URL">): string | null {
  const url = (env.APP_URL || "").trim();
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The first app that serves this hostname, or null for the deploy's own host and for hosts that no app owns.
 * An app whose `owns` throws does not own the host.
 */
export async function hostApp(apps: readonly ServerApp[], env: Env, hostname: string): Promise<ServerApp | null> {
  const host = hostname.toLowerCase();
  if (host === deployHost(env)) return null;
  for (const a of apps) {
    if (!a.hosts) continue;
    if (await a.hosts.owns(env, host).catch(() => false)) return a;
  }
  return null;
}
