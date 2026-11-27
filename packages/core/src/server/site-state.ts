/*
 * The site settings that this Worker isolate last read from D1.
 * siteMiddleware refreshes them, so appName() can stay a plain function.
 */

import type { PlanId } from "../shared/plans";

export interface SiteState {
  /** The name a super admin set, or "" to use APP_NAME. */
  name: string;
  logoType: string | null;
  logoUpdatedAt: string | null;
  /** The sign-in heading a super admin set, or "" for the default. */
  signInHeading: string;
  /** The credit for a custom heading. It is ignored while the default heading shows. */
  signInCredit: string;
  termsUrl: string;
  privacyUrl: string;
  /** The Submit issues link on the app rail, or "" to hide the icon. */
  issuesUrl: string;
  backgroundType: string | null;
  backgroundUpdatedAt: string | null;
  /** Apps that a super admin turned off for the whole site. They are off in every company. */
  appsOff: string[];
  /** Plan descriptions that a super admin set. A missing plan uses the default. */
  planDescriptions: Partial<Record<PlanId, string>>;
  /** False when a super admin turned onboarding off. Onboarding is on by default. */
  onboardingOn: boolean;
  /** When this isolate read the settings, in milliseconds. */
  at: number;
}

let state: SiteState | null = null;

export const siteState = (): SiteState | null => state;

export function setSiteState(next: SiteState): void {
  state = next;
}
