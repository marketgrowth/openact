/*
 * @openact/core/server: what apps may use on the server.
 * Apps import only from here, never from files inside the core.
 */
export type { AppEnv, Env } from "./env.ts";
export * from "./util.ts";
export { sendEmail, emailLayout, emailButton, type EmailMessage } from "./email.ts";
export { SESSION_COOKIE, sessionMiddleware, authSecret } from "./auth.ts";
export { listCompanies, currentCompanyId, removeFromCompany } from "./companies.ts";
export { companyRole, requireCompanyRole, deletePrefix } from "./data.ts";
export {
  ProjectRoom,
  registerRoomKind,
  markChanged,
  flushChanges,
  disconnectFromRoom,
  acceptLive,
  assertLiveRequest,
  liveChanges,
  type Viewer,
  type LiveMessage
} from "./live.ts";
export { defineServerApp, getApps, runHook, type ServerApp, type AppHooks } from "./apps.ts";
export { createWorker, DAILY_CRON } from "./worker.ts";
export { isSuperAdmin, requireSuperAdmin, loadSite } from "./site.ts";
export { sealSecret, openSecret } from "./secret-box.ts";
export {
  companyAi,
  companyAiChoice,
  deployAiDefault,
  aiGatewayUrl,
  aiGatewayHeaders,
  type CompanyAiOverride,
  type CompanyAiChoice
} from "./company-ai.ts";
export {
  requirePermission,
  hasPermission,
  requireAppOn,
  appOffError,
  siteAppOff,
  companyAppState,
  getCatalog,
  type AppInfo,
  type CompanyAppState
} from "./permissions.ts";
