import type { Env } from "./env";

/** Disconnects every agent of a person in one company. Runs when the person leaves the company. */
export async function removeAgentGrants(env: Env, companyId: string, userId: string): Promise<void> {
  try {
    await env.DB.prepare("DELETE FROM oauth_grants WHERE company_id = ? AND user_id = ?").bind(companyId, userId).run();
  } catch (e) {
    // Before migration 0011 runs, there are no agents to disconnect.
    if (!/no such table/i.test(String(e))) throw e;
  }
}
