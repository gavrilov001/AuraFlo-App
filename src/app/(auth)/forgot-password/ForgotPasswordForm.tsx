"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";

import { requestPasswordResetAction } from "../actions";
import { TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordResetAction,
    null,
  );

  if (state?.ok && state.data.sent) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck aria-hidden className="size-8 text-gold-dark" />
        <p className="text-sm text-muted">
          If an account exists for that email, a reset link is on its way.
          Check your inbox.
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
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors?.email}
      />
      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </form>
  );
}
