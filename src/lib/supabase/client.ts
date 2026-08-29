import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/types/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * Supabase client for use in Client Components (browser).
 * Uses the publishable key only. RLS enforces access.
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
