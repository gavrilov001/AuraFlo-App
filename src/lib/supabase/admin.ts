import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database.types";
import { SUPABASE_URL } from "./env";

/**
 * Service-role Supabase client for trusted, server-only code that must act
 * outside any user session (e.g. the Resend inbound-email webhook) and
 * therefore bypasses RLS. Never import this from a Client Component, and
 * never let a caller pass it a user_id/workspace_id to trust blindly — every
 * caller must resolve ownership itself (see workspace_members) before using
 * this client to write.
 *
 * SUPABASE_SERVICE_ROLE_KEY is read directly here (not via env.ts) so the
 * secret is never pulled in by code that also runs in a browser bundle.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing environment variable SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (see .env.example).",
    );
  }

  return createSupabaseClient<Database>(SUPABASE_URL, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
