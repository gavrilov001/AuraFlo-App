import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * `captures.processed_in_daily_plan_id` and `tasks.origin_daily_plan_id` are
 * added by migration 20260904120000_reset_daily_plan.sql. Until that migration
 * is applied the columns do not exist, so every Start My Day write that would
 * stamp them must skip the field. This probes once per server process and
 * caches the result.
 */
let cached: boolean | null = null;

export async function sessionTrackingAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("tasks")
      .select("origin_daily_plan_id")
      .limit(1);
    // Any error on this probe (missing column 42703, PostgREST parse PGRST1xx,
    // schema-cache miss) means the tracking columns are not usable yet.
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}

/** Fields to merge into a `tasks` insert for a session-created task. */
export async function taskOriginFields(
  planId: string,
): Promise<{ origin_daily_plan_id?: string }> {
  return (await sessionTrackingAvailable())
    ? { origin_daily_plan_id: planId }
    : {};
}

/** Fields to merge into a `captures` update when (un)processing in a session. */
export async function captureSessionFields(
  planId: string | null,
): Promise<{ processed_in_daily_plan_id?: string | null }> {
  return (await sessionTrackingAvailable())
    ? { processed_in_daily_plan_id: planId }
    : {};
}
