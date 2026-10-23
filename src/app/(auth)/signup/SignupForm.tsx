"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";

import { signUpAction } from "../actions";
import { TextField } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";

export function SignupForm() {
  const [state, formAction] = useActionState(signUpAction, null);

  if (state?.ok && state.data.needsConfirmation) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck aria-hidden className="size-8 text-evergreen" />
        <h2 className="text-base font-semibold text-ink">Check your email</h2>
        <p className="text-sm text-ink-muted">
          We sent you a confirmation link. Open it on this device to finish
          setting up your account.
        </p>
      </div>
    );
  }

  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <TextField
        label="Name"
        name="fullName"
        autoComplete="name"
        required
        error={fieldErrors?.fullName}
      />
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
        autoComplete="new-password"
        required
        hint="At least 8 characters."
        error={fieldErrors?.password}
      />

      <SubmitButton className="mt-1 w-full">Create account</SubmitButton>
    </form>
  );
}
