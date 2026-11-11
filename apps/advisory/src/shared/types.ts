/*
 * Advisory types, shared by the Worker and the web app.
 * The code uses general words: "advisor" and "offer". Each company can set its own label, such as Consultant, Coach or Mentor.
 */

export const ADVISOR_STATUSES = ["draft", "pending", "approved", "paused", "declined"] as const;
export type AdvisorStatus = (typeof ADVISOR_STATUSES)[number];

export const OFFER_KINDS = ["one_time", "retainer"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];
export const OFFER_KIND_LABELS: Record<OfferKind, string> = { one_time: "One-time", retainer: "Monthly retainer" };

export const REQUEST_STATUSES = ["pending", "accepted", "declined", "canceled", "paid"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Waiting for a reply",
  accepted: "Waiting for payment",
  declined: "Declined",
  canceled: "Canceled",
  paid: "Paid"
};

/** "request": the client asked for a consult first. "direct": the client chose an offer and paid in advance. */
export type RequestSource = "request" | "direct";

export const ENGAGEMENT_STATUSES = ["active", "ended"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const APPROVAL_MODES = ["required", "auto"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const CURRENCIES = ["usd", "eur", "gbp", "cad", "aud", "php"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  /** In the smallest unit, such as cents. */
  amount: number;
  currency: string;
}

/** The brand's settings, in Company settings on the Advisory tab. */
export interface AdvisorySettings {
  /** What the company calls an advisor, such as "Consultant". */
  label: string;
  /** The plural, such as "Consultants". */
  labelPlural: string;
  approvalMode: ApprovalMode;
  /** The fee for new advisors, as a percent, such as 15. */
  defaultFeePercent: number;
  currency: Currency;
}

export interface Offer {
  id: string;
  name: string;
  description: string;
  price: Money;
  kind: OfferKind;
  status: "active" | "archived";
}

export interface AdvisorCard {
  id: string;
  userId: string;
  name: string;
  /** The advisor's role, such as "Fractional CMO". */
  headline: string;
  photoUrl: string | null;
  /** The lowest active offer, for the card. */
  fromPrice: (Money & { kind: OfferKind }) | null;
  /** True when the advisor can take payments now. */
  payable: boolean;
}

export interface AdvisorProfile extends AdvisorCard {
  bio: string;
  offers: Offer[];
  /** True when this is the person's own profile. */
  isMe: boolean;
}

/** What the agreed price is, copied when the advisor accepts, so a later change to the offer does not change it. */
export interface Terms {
  name: string;
  price: Money;
  kind: OfferKind;
}

export interface AdvisoryRequest {
  id: string;
  source: RequestSource;
  status: RequestStatus;
  advisor: { id: string; name: string; headline: string };
  client: { id: string; name: string; email: string | null };
  message: string;
  /** The offer the client picked, if any. */
  offerId: string | null;
  terms: Terms | null;
  declineNote: string;
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  engagement: { id: string; status: EngagementStatus; projectPath: string | null } | null;
}

export interface Engagement {
  id: string;
  requestId: string;
  status: EngagementStatus;
  client: { id: string; name: string };
  advisor: { id: string; name: string };
  terms: Terms;
  /** The brand fee taken from the first payment. */
  fee: Money;
  projectPath: string | null;
  createdAt: string;
  endedAt: string | null;
}

/** GET /companies/:id/home */
export interface AdvisoryHome {
  settings: AdvisorySettings;
  advisors: AdvisorCard[];
  can: { browse: boolean; sell: boolean; manage: boolean };
  /** The person's own advisor status, or null when they never applied. */
  myStatus: AdvisorStatus | null;
  /** True when this site can take payments for advisors. */
  payments: boolean;
}

/** The person's own advisor record, for the advisor dashboard. */
export interface MyAdvisor {
  id: string;
  status: AdvisorStatus;
  headline: string;
  bio: string;
  photoUrl: string | null;
  feePercent: number;
  declineNote: string;
  stripe: { connected: boolean; ready: boolean };
  offers: Offer[];
}

export interface MyAdvisorPage {
  settings: AdvisorySettings;
  advisor: MyAdvisor | null;
  payments: boolean;
  counts: { pending: number };
}

export interface ManagedAdvisor {
  id: string;
  userId: string;
  name: string;
  email: string;
  headline: string;
  bio: string;
  photoUrl: string | null;
  status: AdvisorStatus;
  feePercent: number;
  stripeReady: boolean;
  offers: number;
  engagements: number;
  submittedAt: string | null;
}

export interface ManagePage {
  settings: AdvisorySettings;
  advisors: ManagedAdvisor[];
  engagements: Engagement[];
}
