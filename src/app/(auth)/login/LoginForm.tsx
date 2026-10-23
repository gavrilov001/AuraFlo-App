"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signInAction } from "../actions";
import { AuthField } from "@/components/auth/AuthField";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import styles from "@/components/welcome/welcome.module.css";

export function LoginForm({
  redirectTo,
  callbackError,
}: {
  redirectTo?: string;
  callbackError?: string;
}) {
  const [state, formAction] = useActionState(signInAction, null);
  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;
  // Once the user has actually submitted the form, its own result takes
  // over — a stale "your link expired" from the URL shouldn't linger once
  // they're interacting with (or have corrected) a real attempt.
  const displayError = state ? formError : callbackError;

  return (
    <>
      <form action={formAction} className={styles.authForm} noValidate>
        {redirectTo && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}
        {displayError && (
          <p className={styles.authAlert} role="alert">
            {displayError}
          </p>
        )}

        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors?.email}
        />
        <AuthPasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          error={fieldErrors?.password}
        />
        <p style={{ textAlign: "right", margin: 0 }}>
          <Link href="/forgot-password" className={styles.authLinkBack}>
            Forgot password?
          </Link>
        </p>

        <AuthSubmitButton>Sign in</AuthSubmitButton>
      </form>

      <div className={styles.authLinks}>
        <Link href="/signup" className={styles.authLinkPrimary}>
          New to AuraFlo? <strong>Create your account</strong>
        </Link>
        <Link href="/" className={styles.authLinkBack}>
          <span aria-hidden>&larr;</span> Back to AuraFlo
        </Link>
      </div>
    </>
  );
}
