import type { Case } from "../harness/cases.ts";

/* The CMS app. Its company setting holds the company's own site address. */
export const cases: Case[] = [
  { route: "GET /api/apps/cms/companies/:id/site", path: (a) => `/api/apps/cms/companies/${a.companyId}/site`, expect: "denied" }
];
