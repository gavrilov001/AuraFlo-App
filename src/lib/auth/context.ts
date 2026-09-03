import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type {
  Profile,
  Workspace,
  WorkspaceRole,
} from "@/lib/types/database.types";

export interface WorkspaceContext {
  user: User;
  profile: Profile;
  workspace: Workspace;
  role: WorkspaceRole;
}

/**
 * Returns the authenticated user, or null.
 * `cache()`d so repeated calls within one server request (page render + the
 * Server Actions it triggers) reuse a single `auth.getUser()` round trip.
 */
export const getUser = cache(async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

/** Returns the authenticated user or redirects to /login. */
export async function requireUser(redirectTo?: string): Promise<User> {
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

    // profile and membership are independent — fetch in parallel.
    const [profileRes, membershipRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("role, workspace_id")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (membershipRes.error) throw membershipRes.error;
    if (!profileRes.data || !membershipRes.data) return null;

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", membershipRes.data.workspace_id)
      .maybeSingle();

    if (workspaceError) throw workspaceError;
    if (!workspace) return null;

    return {
      user,
      profile: profileRes.data,
      workspace,
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
