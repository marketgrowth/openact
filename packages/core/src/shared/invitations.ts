import type { CompanyRole } from "./types.ts";

export const INVITATION_LEVELS = ["site", "company", "workspace"] as const;
export type InvitationLevel = (typeof INVITATION_LEVELS)[number];

/** Invitations one company can send in a day. A site invite counts against the super owner. */
export const INVITE_DAILY_LIMIT = 50;
/** Days an invitation stays open. */
export const INVITE_DAYS = 14;

/** An invitation for the signed-in person, to accept or decline. */
export interface PendingInvitation {
  id: string;
  companyId: string;
  companyName: string;
  role: CompanyRole;
  level: InvitationLevel;
  workspaceName: string | null;
  inviterName: string | null;
  expiresAt: string;
}
