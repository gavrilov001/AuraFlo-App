import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";
import type { Database } from "@/lib/types/database.types";
import { SUPABASE_URL } from "./env";

/**
 * Service-role Supabase client for the Dreamcatcher feature's trusted
 * server-side-only operations: the inbound-email webhook
 * (src/app/api/webhooks/resend/route.ts) and the Email to Dream Catcher
 * Server Actions that mint a verification token
 * (src/app/app/settings/sender-emails-actions.ts — sender_email_add,
 * sender_email_resend, primary_email_request_verification). Those three
 * RPCs are intentionally NOT granted to `authenticated`: calling them with
 * the user-scoped client would hand the verification token straight back to
 * whichever client called it — any authenticated user, not just the
 * legitimate Server Action — defeating email-ownership verification
 * entirely. Only this service-role client may call them; the user identity
 * they act on is passed explicitly as `p_user_id`, sourced from
 * requireUser()'s independently-verified session, never from client input.
 *
 * Kept separate from createAdminClient() in ./admin: that one is
 * synchronous and env-var based for any other trusted server-only caller,
 * while this one is necessarily async because its service-role key comes
 * from AWS Secrets Manager in production (see
 * src/lib/secrets/dreamcatcher.ts) rather than from process.env directly.
 *
 * Same RLS-bypass caveat as ./admin applies: never let a caller pass this
 * client a user_id/workspace_id to trust blindly — resolve ownership via
 * workspace_members (or, for this feature, the caller's own verified
 * session) first.
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
