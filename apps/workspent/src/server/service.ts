import { HttpError, newId, nowIso, type Env } from "@openact/core/server";
import { isTimeZone, localDate } from "../shared/rules.ts";

/*
 * The WorkSpent service for other apps, such as DirectCare and Orbytt.
 * Another app reads it with appService<WorkSpentSync>("workspent", "sync"), after it checks that WorkSpent is on
 * for the company with companyAppState. It never reads WorkSpent tables itself.
 *
 * The other app keeps its own record (a home, a staff member). WorkSpent keeps the PIN and the hours.
 * Each call names the other app (sourceApp) and that app's own key (sourceKey), so a second call updates the same row.
 */

export interface SyncLocation {
  sourceApp: string;
  sourceKey: string;
  name: string;
  timeZone: string;
}

export interface SyncPerson {
  sourceApp: string;
  sourceKey: string;
  name: string;
  /** The person's OpenAct account, when they have one in the company. */
  userId?: string | null;
  /** The sourceKey values of the person's locations, from the same app. */
  locationKeys: string[];
  isActive?: boolean;
}

export interface WorkSpentSync {
  upsertLocation(env: Env, companyId: string, input: SyncLocation): Promise<{ id: string }>;
  upsertPerson(env: Env, companyId: string, input: SyncPerson): Promise<{ id: string }>;
}

function checkKeys(sourceApp: unknown, sourceKey: unknown) {
  if (typeof sourceApp !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(sourceApp)) throw new HttpError(400, "sourceApp must be an app id.");
  if (typeof sourceKey !== "string" || !sourceKey || sourceKey.length > 120) throw new HttpError(400, "sourceKey must be text of 120 characters or fewer.");
}

const cleanName = (v: unknown) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > 100) throw new HttpError(400, "name must be text of 100 characters or fewer.");
  return v.trim();
};

export const sync: WorkSpentSync = {
  async upsertLocation(env, companyId, input) {
    checkKeys(input.sourceApp, input.sourceKey);
    const name = cleanName(input.name);
    if (!isTimeZone(input.timeZone)) throw new HttpError(400, "timeZone must be an IANA time zone, such as America/Los_Angeles.");
    const found = await env.DB.prepare("SELECT id FROM workspent_locations WHERE company_id = ? AND source_app = ? AND source_key = ?")
      .bind(companyId, input.sourceApp, input.sourceKey)
      .first<{ id: string }>();
    const now = nowIso();
    if (found) {
      await env.DB.prepare("UPDATE workspent_locations SET name = ?, time_zone = ?, updated_at = ? WHERE id = ? AND company_id = ?")
        .bind(name, input.timeZone, now, found.id, companyId)
        .run();
      return { id: found.id };
    }
    const id = newId();
    // A new location starts with pay periods of 2 weeks from the Sunday of this week. An admin can change it.
    const today = localDate(Date.now(), input.timeZone);
    const sunday = new Date(Date.parse(today + "T00:00:00Z") - new Date(today + "T00:00:00Z").getUTCDay() * 86_400_000).toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO workspent_locations (id, company_id, name, time_zone, clock_rule, period_kind, period_start_date, flags_json, source_app, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'on_site', 'biweekly', ?, '{}', ?, ?, ?, ?)`
    )
      .bind(id, companyId, name, input.timeZone, sunday, input.sourceApp, input.sourceKey, now, now)
      .run();
    return { id };
  },

  async upsertPerson(env, companyId, input) {
    checkKeys(input.sourceApp, input.sourceKey);
    const name = cleanName(input.name);
    if (!Array.isArray(input.locationKeys) || input.locationKeys.length > 200) throw new HttpError(400, "locationKeys must be a list.");
    let userId: string | null = null;
    if (input.userId) {
      const m = await env.DB.prepare("SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, input.userId).first();
      if (m) userId = input.userId;
    }
    const locs = input.locationKeys.length
      ? (
          await env.DB.prepare(
            `SELECT id FROM workspent_locations WHERE company_id = ? AND source_app = ? AND source_key IN (${input.locationKeys.map(() => "?").join(",")})`
          )
            .bind(companyId, input.sourceApp, ...input.locationKeys)
            .all<{ id: string }>()
        ).results.map((r) => r.id)
      : [];
    const found = await env.DB.prepare("SELECT id FROM workspent_people WHERE company_id = ? AND source_app = ? AND source_key = ?")
      .bind(companyId, input.sourceApp, input.sourceKey)
      .first<{ id: string }>();
    // An account links to one person only. Keep an existing link of another person.
    if (userId) {
      const taken = await env.DB.prepare("SELECT id FROM workspent_people WHERE company_id = ? AND user_id = ? AND id != ?")
        .bind(companyId, userId, found?.id ?? "")
        .first();
      if (taken) userId = null;
    }
    const now = nowIso();
    const id = found?.id ?? newId();
    const active = input.isActive === false ? 0 : 1;
    const stmts: D1PreparedStatement[] = [
      found
        ? env.DB.prepare("UPDATE workspent_people SET name = ?, user_id = COALESCE(?, user_id), is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?").bind(
            name,
            userId,
            active,
            now,
            id,
            companyId
          )
        : env.DB.prepare(
            `INSERT INTO workspent_people (id, company_id, name, user_id, source_app, source_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, companyId, name, userId, input.sourceApp, input.sourceKey, active, now, now),
      env.DB.prepare(
        `DELETE FROM workspent_person_locations WHERE person_id = ? AND company_id = ?
         AND location_id IN (SELECT id FROM workspent_locations WHERE company_id = ? AND source_app = ?)`
      ).bind(id, companyId, companyId, input.sourceApp),
      ...locs.map((l) =>
        env.DB.prepare("INSERT OR IGNORE INTO workspent_person_locations (person_id, location_id, company_id) VALUES (?, ?, ?)").bind(id, l, companyId)
      )
    ];
    await env.DB.batch(stmts);
    return { id };
  }
};
