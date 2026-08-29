"use client";

import { useActionState } from "react";

import { signInAction } from "../actions";
import { TextField } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState(signInAction, null);
  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {redirectTo && (
        <input type="hidden" name="redirectTo" value={redirectTo} />
      )}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors?.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        error={fieldErrors?.password}
      />

      <SubmitButton className="mt-1 w-full">Sign in</SubmitButton>
    </form>
  );
}
