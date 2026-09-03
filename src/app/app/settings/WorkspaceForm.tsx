"use client";

import { useActionState, useEffect, useRef } from "react";

import { TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { useToast } from "@/components/ui/Toast";
import { updateWorkspaceAction } from "./actions";

export function WorkspaceForm({
  initialName,
  canEdit,
}: {
  initialName: string;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [state, formAction] = useActionState(updateWorkspaceAction, null);
  const lastHandled = useRef(state);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;
    if (state?.ok) toast.success("Workspace updated.");
  }, [state, toast]);

  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  if (!canEdit) {
    return (
      <TextField
        label="Workspace name"
        name="name"
        defaultValue={initialName}
        disabled
        readOnly
      />
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <TextField
        label="Workspace name"
        name="name"
        defaultValue={initialName}
        required
        error={fieldErrors?.name}
      />
      <div>
        <SubmitButton>Save workspace</SubmitButton>
      </div>
    </form>
  );
}
