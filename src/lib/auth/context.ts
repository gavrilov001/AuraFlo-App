import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type {
  Profile,
  Workspace,
  WorkspaceRole,
} from "@/lib/types/database.types";

/**
 * The only two fields of the Supabase `User` object this app ever reads
 * (verified by grepping every `user.*` access site). Sourced from verified
 * JWT claims rather than the full Auth-server user record — see `getUser()`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface WorkspaceContext {
  user: AuthenticatedUser;
  profile: Profile;
  workspace: Workspace;
  role: WorkspaceRole;
}

/**
 * Returns the authenticated user, or null.
 * `cache()`d so repeated calls within one server request (page render + the
 * Server Actions it triggers) reuse a single verification.
 *
 * Uses `getClaims()` rather than `getUser()`: it verifies the access token's
 * signature — locally, against a cached copy of this project's asymmetric
 * public keys, since it doesn't use a legacy symmetric JWT secret — instead
 * of making a network round trip to the Auth server for every call. This is
 * the official Supabase recommendation for exactly this use case (protecting
 * pages / reading identity), and it still drives the same lazy session
 * refresh `getUser()` did for a near-expiry token. The one tradeoff is that
 * it can't detect a user banned/disabled *this instant* server-side the way
 * `getUser()` can — that only clears once the current access token expires
 * (1 hour) — which doesn't affect anything this app does today. RLS is
 * unaffected either way: Postgres/PostgREST independently re-verifies the
 * JWT on every query regardless of what this function decides.
 * See https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export const getUser = cache(
  async function getUser(): Promise<AuthenticatedUser | null> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data) return null;
    return { id: data.claims.sub, email: data.claims.email ?? null };
  },
);

/** Returns the authenticated user or redirects to /login. */
export async function requireUser(
  redirectTo?: string,
): Promise<AuthenticatedUser> {
  const user = await getUser();
  if (!user) {
    const target = redirectTo
      ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
      : "/login";
    redirect(target);
  }
  return user;
}

/**
 * Resolves the current user's workspace through workspace_members.
 * The membership row is the trust anchor — we never accept a workspace id from
 * the client. If the user belongs to several workspaces we use their earliest
 * membership (their personal workspace). A workspace switcher is a later phase.
 */
export const getWorkspaceContext = cache(
  async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
    const supabase = await createClient();

    const user = await getUser();
    if (!user) return null;

    // profile and membership+workspace are independent — fetch in parallel.
    // The workspace is embedded in the membership query (one round trip
    // instead of two sequential ones) via the workspace_members ->
    // workspaces foreign key; RLS still applies to the embedded row.
    const [profileRes, membershipRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("role, workspace_id, workspace:workspaces(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true })
        .limit(1)
        .maybeSingle()
        .returns<{
          role: WorkspaceRole;
          workspace_id: string;
          workspace: Workspace | null;
        }>(),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (membershipRes.error) throw membershipRes.error;
    if (!profileRes.data || !membershipRes.data || !membershipRes.data.workspace) {
      return null;
    }

    return {
      user,
      profile: profileRes.data,
      workspace: membershipRes.data.workspace,
      role: membershipRes.data.role,
    };
  },
);

/** Like getWorkspaceContext but redirects when unauthenticated / not ready. */
export async function requireWorkspaceContext(
  redirectTo?: string,
): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!context) {
    const user = await getUser();
    if (!user) {
      const target = redirectTo
        ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/login";
      redirect(target);
    }
    // Authenticated but the signup trigger has not finished provisioning yet.
    // The /app layout renders a holding screen for this case.
    redirect("/app");
  }
  return context;
}

/**
 * Verifies the given user is a member of the given workspace and returns their
 * role. Use in mutations before writing, in addition to RLS.
 */
export async function assertWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("You are not a member of this workspace.");
  }
  return data.role;
}
