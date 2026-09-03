import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * `captures.archived_at` / `captures.discarded_at` are added by migration
 * 20260908120000_capture_lifecycle.sql. Until it's applied the columns don't
 * exist, so ordering / filtering the Archived and Discarded tabs by them would
 * 400. Probe once per server process and fall back to `processed_at`.
 */
let cached: boolean | null = null;

export async function captureLifecycleColumnsAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("captures")
      .select("archived_at")
      .limit(1);
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}
