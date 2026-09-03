"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "../actions";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, null);
  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters."
        error={fieldErrors?.password}
      />
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        error={fieldErrors?.confirmPassword}
      />
      <SubmitButton className="w-full">Update password</SubmitButton>
    </form>
  );
}
