/*
 * The Director store client. Pure, so the Worker, the web app and tests share it.
 *
 * A self-hosted OpenAct buys a plan and installs the Director apps from the MarketGrowth store (on.openact.ing).
 * The deploy's Worker talks to the store. The browser never sends the license key or the claim token anywhere.
 * Read docs/plans.md, "Buy and install from your site".
 */

/** The store that sells OpenAct Director. OPENACT_STORE_URL can point at another one, such as a test store. */
export const DEFAULT_STORE_URL = "https://on.openact.ing";

/** One Director app version that the store sells. */
export interface StoreApp {
  id: string;
  name: string;
  version: string;
  plan: "director" | "producer";
  released: string;
  requiresCore: string | null;
  testedCore: string | null;
}

/** What the Plan page reads: GET /api/site/director */
export interface DirectorStatus {
  /** This deploy's host name, from APP_URL. Store keys work only on it. Null when APP_URL is empty. */
  host: string | null;
  license: null | {
    /** "secret": the OPENACT_LICENSE secret. "settings": saved on this page. */
    source: "secret" | "settings";
    licensee: string;
    plan: "director" | "producer";
    expiresAt: string;
    /** valid, grace (ended less than 14 days ago) or ended (the perpetual fallback keeps older app versions). */
    state: "valid" | "grace" | "ended";
  };
  /** Set when a saved or secret key does not work, such as a key for another host. */
  licenseProblem: string | null;
  /** True when this deploy has a store link (it bought through the store, or linked a key from MarketGrowth), so it renews its key by itself. */
  storeOrder: boolean;
  /** The store's apps, or null when the store did not answer. */
  catalog: StoreApp[] | null;
  /** True when the store sells plans online, and when it installs through GitHub. */
  checkout: boolean;
  github: boolean;
  /** The installed paid apps, with their versions. */
  installed: Array<{ id: string; name: string; version: string | null }>;
  storeUrl: string;
}

/** POST /api/site/director/install */
export interface InstallResult {
  commit: string;
  pullRequest: string | null;
  branch: string;
  apps: Array<{ id: string; version: string; from: string | null }>;
  notes: string[];
}

export interface StoreRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** True when the store has a newer version than the installed one. Versions such as 0.2.0. */
export function newerVersion(available: string, installed: string | null): boolean {
  if (!installed) return true;
  const a = available.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}
