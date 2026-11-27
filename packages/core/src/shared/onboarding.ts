/*
 * Onboarding: what a new person tells OpenAct about their company.
 * docs/onboarding.md has the rules.
 */

import type { WorkspaceKind } from "./types.ts";

/** The types of company that a person can pick. The first one is the default in the form. */
export const ENTITY_TYPES = ["corporation", "llc", "sole_proprietorship", "partnership", "nonprofit", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  corporation: "Corporation",
  llc: "LLC",
  sole_proprietorship: "Sole proprietorship",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
  other: "Other"
};

/** The workspace kinds that onboarding offers for the first workspace. */
export const ONBOARDING_KINDS = ["brand", "business_unit"] as const satisfies readonly WorkspaceKind[];
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];

export const ONBOARDING_KIND_LABELS: Record<OnboardingKind, string> = { brand: "Brand", business_unit: "Business unit" };

export const COMPANY_NAME_MAX = 80;

/** The answer of GET /api/onboarding. */
export interface OnboardingState {
  /** True when this person must set up a company now. */
  required: boolean;
}

/** The body of POST /api/onboarding. */
export interface OnboardingInput {
  legalName: string;
  entityType: EntityType;
  brand: string;
  brandKind: OnboardingKind;
}

/** The site setting key. Only the value "0" turns onboarding off. */
export const ONBOARDING_KEY = "onboarding_enabled";
