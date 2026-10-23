"use server";

import { redirect } from "next/navigation";

import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  actionError,
  actionOk,
  parseInput,
  toMessage,
  type ActionResult,
} from "@/lib/actions/result";
import {
  forgotPasswordSchema,
  loginSchema,
  signupSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";

function safeRedirectPath(value: string | undefined | null): string {
  if (!value) return "/app";
  // Only allow app-internal absolute paths — never an external URL.
  if (!value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export async function signInAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseInput(loginSchema, {
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) {
    return actionError(parsed.error, parsed.fieldErrors);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.message.toLowerCase().includes("email not confirmed")) {
      return actionError(
        "Please confirm your email address first — check your inbox for the link.",
      );
    }
    return actionError("That email and password combination doesn't match.");
  }

  redirect(safeRedirectPath(parsed.data.redirectTo));
}

export async function signUpAction(
  _prev: ActionResult<{ needsConfirmation: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  const parsed = parseInput(signupSchema, {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return actionError(parsed.error, parsed.fieldErrors);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return actionError(
        "An account with this email already exists. Try signing in instead.",
      );
    }
    return actionError(toMessage(error, "We couldn't create your account."));
  }

  // The database trigger provisions the profile, workspace, membership and
  // default categories — nothing to do here.
  if (data.session) {
    redirect("/app");
  }

  return actionOk({ needsConfirmation: true });
}

export async function requestPasswordResetAction(
  _prev: ActionResult<{ sent: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ sent: boolean }>> {
  const parsed = parseInput(forgotPasswordSchema, {
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return actionError(parsed.error, parsed.fieldErrors);
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password`,
  });

  // Always report success so we never reveal whether an account exists.
  return actionOk({ sent: true });
}

export async function updatePasswordAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updatePasswordSchema, {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return actionError(parsed.error, parsed.fieldErrors);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return actionError(
      "Your reset link has expired. Request a new password reset email.",
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return actionError(toMessage(error, "We couldn't update your password."));
  }

  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
