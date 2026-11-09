/*
 * The site settings that this Worker isolate last read from D1.
 * siteMiddleware refreshes them, so appName() can stay a plain function.
 */

export interface SiteState {
  /** The name a super admin set, or "" to use APP_NAME. */
  name: string;
  logoType: string | null;
  logoUpdatedAt: string | null;
  /** Apps that a super admin turned off for the whole site. They are off in every company. */
  appsOff: string[];
  /** When this isolate read the settings, in milliseconds. */
  at: number;
}

let state: SiteState | null = null;

export const siteState = (): SiteState | null => state;

export function setSiteState(next: SiteState): void {
  state = next;
}
