import { defineServerApp, type Env } from "@openact/core/server";
import { API } from "../shared/rules.ts";
import { deviceRoutes } from "./device.ts";
import { companyRoutes } from "./routes.ts";
import { scheduleRoutes } from "./schedule.ts";
import { sync } from "./service.ts";
import { PROJECT_TABLES, approveRoutes, projectRoutes } from "./projects.ts";

/*
 * WorkSpent: a time clock app. People clock in and out with a PIN on a time clock device.
 * Managers see who is on the clock, fix missed punches with a reason, approve the pay period and export the hours.
 * Two kinds of work: Shifts (PIN clock-in at locations, schedules, pay periods) and Projects (time on client work,
 * with rates and weekly approval). A company turns on one or both. Taxes and payroll stay with the payroll provider.
 * Read docs/workspent-app.md.
 */

export type { WorkSpentSync, SyncLocation, SyncPerson } from "./service.ts";

async function deleteCompany(env: Env, companyId: string): Promise<void> {
  // Children first, so the foreign keys never block a delete.
  await env.DB.batch(
    [
      ...PROJECT_TABLES,
      "workspent_shifts",
      "workspent_changes",
      "workspent_periods",
      "workspent_punches",
      "workspent_person_locations",
      "workspent_devices",
      "workspent_people",
      "workspent_location_managers",
      "workspent_locations"
    ].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE company_id = ?`).bind(companyId))
  );
}

export default defineServerApp({
  id: "workspent",
  name: "WorkSpent",
  permissions: {
    "workspent.clock": {
      label: "Use WorkSpent",
      description: "See My time, and confirm or question a fix of your own hours. People without an account clock in with a PIN on a time clock device.",
      roles: ["owner", "admin", "member"]
    },
    "workspent.track": {
      label: "Log time on projects",
      description: "Use the timer, type in hours and send your week, on projects you can see in the Projects app. Guests can log time on projects shared with them.",
      roles: ["owner", "admin", "member", "guest"],
      guests: true
    },
    "workspent.manage": {
      label: "Manage hours at every location",
      description: "See every timesheet and time log, fix clock-ins with a reason, approve pay periods and project weeks, and export the hours. Location managers get this for their own locations only.",
      roles: ["owner", "admin"]
    },
    "workspent.setup": {
      label: "Set up WorkSpent",
      description: "Turn Projects and Shifts on or off. Add clients, rates, locations, time clock devices, people and PINs, and set the flag limits and pay periods.",
      roles: ["owner", "admin"],
      locked: ["owner"]
    }
  },
  routes: (api) => {
    api.route(`${API}/device`, deviceRoutes);
    api.route(API, companyRoutes);
    api.route(API, scheduleRoutes);
    api.route(API, projectRoutes);
    api.route(`${API}/approve`, approveRoutes);
  },
  services: { sync },
  hooks: {
    // The person keeps their hours. They lose the link to the account and any location manager role.
    companyMemberRemoved: async (env, companyId, userId) => {
      await env.DB.batch([
        env.DB.prepare("UPDATE workspent_people SET user_id = NULL WHERE company_id = ? AND user_id = ?").bind(companyId, userId),
        env.DB.prepare("DELETE FROM workspent_location_managers WHERE company_id = ? AND user_id = ?").bind(companyId, userId)
      ]);
    },
    userDeleting: async (env, userId) => {
      await env.DB.batch([
        env.DB.prepare("UPDATE workspent_people SET user_id = NULL WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM workspent_location_managers WHERE user_id = ?").bind(userId)
      ]);
    },
    companyDeleting: deleteCompany
  }
});
