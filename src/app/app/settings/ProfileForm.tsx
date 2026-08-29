"use client";

import { useActionState } from "react";

import { TextField, SelectField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { updateProfileAction } from "./actions";

export function ProfileForm({
  initialName,
  initialTimezone,
  timezones,
}: {
  initialName: string;
  initialTimezone: string;
  timezones: string[];
}) {
  const [state, formAction] = useActionState(updateProfileAction, null);
  const showSaved = state?.ok === true;

  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  const options = timezones.includes(initialTimezone)
    ? timezones
    : [initialTimezone, ...timezones];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {showSaved && <FormMessage tone="success">Profile saved.</FormMessage>}

      <TextField
        label="Full name"
        name="fullName"
        defaultValue={initialName}
        required
        error={fieldErrors?.fullName}
      />
      <SelectField
        label="Timezone"
        name="timezone"
        defaultValue={initialTimezone}
        error={fieldErrors?.timezone}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </option>
        ))}
      </SelectField>

      <div>
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </form>
  );
}
