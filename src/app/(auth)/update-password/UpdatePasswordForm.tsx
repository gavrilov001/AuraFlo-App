"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "../actions";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import styles from "@/components/welcome/welcome.module.css";

export function UpdatePasswordForm() {
  // On success, updatePasswordAction redirects to /update-password?reset=success
  // rather than returning action state — see the comment in that action for
  // why (an in-place success render here would conflict with the page-level
  // session gate once the recovery session is signed out). `state` is only
  // ever populated by a validation/error path here.
  const [state, formAction] = useActionState(updatePasswordAction, null);
  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className={styles.authForm} noValidate>
      {formError && (
        <p className={styles.authAlert} role="alert">
          {formError}
        </p>
      )}

      <AuthPasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        required
        error={fieldErrors?.password}
      />
      <AuthPasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        error={fieldErrors?.confirmPassword}
      />

      <AuthSubmitButton>Update password</AuthSubmitButton>
    </form>
  );
}
