import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";
import type { Database } from "@/lib/types/database.types";
import { SUPABASE_URL } from "./env";

/**
 * Service-role Supabase client for the Dreamcatcher inbound-email webhook
 * only (src/app/api/webhooks/resend/route.ts). Kept separate from
 * createAdminClient() in ./admin: that one is synchronous and env-var based
 * for any other trusted server-only caller, while this one is necessarily
 * async because its service-role key comes from AWS Secrets Manager in
 * production (see src/lib/secrets/dreamcatcher.ts) rather than from
 * process.env directly.
 *
 * Same RLS-bypass caveat as ./admin applies: never let a caller pass this
 * client a user_id/workspace_id to trust blindly — resolve ownership via
 * workspace_members first.
 */
export async function createDreamcatcherAdminClient() {
  const { supabaseServiceRoleKey } = await getDreamcatcherSecrets();

  return createSupabaseClient<Database>(SUPABASE_URL, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
