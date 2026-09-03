"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUpAction } from "../actions";
import { AuthField } from "@/components/auth/AuthField";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import styles from "@/components/welcome/welcome.module.css";

export function SignupForm() {
  const [state, formAction] = useActionState(signUpAction, null);
  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <>
      <form action={formAction} className={styles.authForm} noValidate>
        {formError && (
          <p className={styles.authAlert} role="alert">
            {formError}
          </p>
        )}

        <AuthField
          label="Full name"
          name="fullName"
          autoComplete="name"
          required
          error={fieldErrors?.fullName}
        />
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
          autoComplete="new-password"
          required
          error={fieldErrors?.password}
        />
        <AuthPasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          error={fieldErrors?.confirmPassword}
        />

        <AuthSubmitButton>Create my account</AuthSubmitButton>
      </form>

      <div className={styles.authLinks}>
        <Link href="/login" className={styles.authLinkPrimary}>
          Already have an account? <strong>Sign in</strong>
        </Link>
        <Link href="/" className={styles.authLinkBack}>
          <span aria-hidden>&larr;</span> Back to AuraFlo
        </Link>
      </div>
    </>
  );
}
