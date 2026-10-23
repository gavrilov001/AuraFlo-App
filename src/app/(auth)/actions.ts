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

  let authError: unknown;
  try {
    const supabase = await createClient();
    const result = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    authError = result.error;
  } catch {
    return actionError(
      "We couldn't reach the server. Check your connection and try again.",
    );
  }

  if (authError) {
    return actionError("That email or password isn't right. Please try again.");
  }

  redirect(safeRedirectPath(parsed.data.redirectTo));
}

export async function signUpAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseInput(signupSchema, {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return actionError(parsed.error, parsed.fieldErrors);
  }

  const supabase = await createClient();
  let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"];
  let error: Awaited<ReturnType<typeof supabase.auth.signUp>>["error"];
  try {
    ({ data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
      },
    }));
  } catch {
    return actionError(
      "We couldn't reach the server. Check your connection and try again.",
    );
  }

  if (error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("already registered") ||
      message.includes("already exists") ||
      error.code === "user_already_exists"
    ) {
      return actionError(
        "An account with this email already exists. Try signing in instead.",
      );
    }
    if (message.includes("password")) {
      return actionError(
        "Please choose a stronger password — at least 8 characters.",
      );
    }
    return actionError("We couldn't create your account. Please try again.");
  }

  // Email confirmation is disabled, so Supabase returns a session right away.
  // The database trigger provisions the profile and personal workspace; the
  // /app layout shows a brief holding state if that hasn't landed yet.
  if (!data.session) {
    return actionError("Your account is ready. Please sign in to continue.");
  }

  redirect("/app/capture");
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
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password` },
  );
  // Log server-side only (e.g. SMTP misconfiguration, rate limiting) —
  // the client always sees the same neutral outcome below regardless of
  // what happened, so this never becomes an oracle for whether the email
  // is registered.
  if (error) {
    console.error("requestPasswordResetAction: resetPasswordForEmail failed", error);
  }

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

  // The recovery session has done its job once the password is changed —
  // sign it out so the user lands back at /login rather than being carried
  // straight into the app on a session that only existed to authorize this
  // one action. @supabase/ssr clears the session cookies as part of this
  // call before it attempts the network-side revoke, so the user is signed
  // out locally even if that revoke call itself fails; we only log that case
  // rather than blocking the (already-succeeded) password change on it.
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error("updatePasswordAction: signOut failed", signOutError);
  }

  // Redirect rather than returning action state: a Server Action that
  // returns state in place triggers Next.js to refresh this route's Server
  // Components afterward, and /update-password's own page-level session
  // gate would then see the just-cleared session and swap to "link expired"
  // out from under the success UI. Navigating to a fresh URL instead renders
  // the destination deliberately, with the success marker taking priority
  // over that gate (see update-password/page.tsx).
  redirect("/update-password?reset=success");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
