"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { TextField, SelectField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FormMessage } from "@/components/ui/FormMessage";
import { useToast } from "@/components/ui/Toast";
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
  const toast = useToast();
  const [state, formAction] = useActionState(updateProfileAction, null);
  const lastHandled = useRef(state);
  const nameRef = useRef<HTMLInputElement>(null);
  const timezoneRef = useRef<HTMLSelectElement>(null);

  // Controlled rather than defaultValue-based — but that alone isn't
  // sufficient here. Confirmed directly (temporary render/DOM logging
  // during debugging): after this form's action completes, something below
  // React's own render cycle resets the <select>'s actual DOM value to
  // whichever <option> is first in the CURRENT list — independent of
  // React's `value` prop, which stays correct throughout (React's internal
  // state was never wrong; only the native DOM element was). A successful
  // timezone save therefore visibly looked reverted until the page was
  // reloaded, even though the write had already landed. Re-asserting the
  // DOM value imperatively via refs, after the action settles, is what
  // actually survives that reset regardless of its exact cause.
  const [fullName, setFullName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;
    if (state?.ok) {
      toast.success("Profile saved.");
      if (nameRef.current) nameRef.current.value = fullName;
      if (timezoneRef.current) timezoneRef.current.value = timezone;
    }
  }, [state, toast, fullName, timezone]);

  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  const options = timezones.includes(timezone) ? timezones : [timezone, ...timezones];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <TextField
        ref={nameRef}
        label="Full name"
        name="fullName"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        required
        error={fieldErrors?.fullName}
      />
      <SelectField
        ref={timezoneRef}
        label="Timezone"
        name="timezone"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
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
