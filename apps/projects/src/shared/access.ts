/*
 * Who can open a project, and with which role.
 * Pure module, used by the Worker and by tests.
 *
 *   On the project                  -> their project role (company owners and admins get Owner on company projects)
 *   Company owner or admin          -> Owner, for projects with "company" visibility
 *   Company member                  -> Viewer, for projects with "company" visibility
 *   Guest, or not in the company    -> no access
 *   Anyone not on a secret project  -> no access
 */
import type { CompanyRole, Role, Visibility } from "./types";
export { canManageCompany, emailDomainProblem, PUBLIC_EMAIL_DOMAINS } from "@openact/core/shared";

export function effectiveProjectRole(a: { visibility: Visibility; projectRole: Role | null; companyRole: CompanyRole | null }): Role | null {
  const companyAdmin = a.companyRole === "owner" || a.companyRole === "admin";
  if (a.visibility === "company" && companyAdmin) return "owner";
  if (a.projectRole) return a.projectRole;
  if (a.visibility === "company" && a.companyRole === "member") return "viewer";
  return null;
}

export const canCreateProjects = (r: CompanyRole | null) => r === "owner" || r === "admin" || r === "member";
