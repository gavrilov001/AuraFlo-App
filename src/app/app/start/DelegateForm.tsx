"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField, SelectField } from "@/components/ui/Field";
import type { FocusOption } from "@/lib/data/start-day";

export interface DelegatePayload {
  delegateName: string;
  delegateEmail: string | null;
  dueAt: string | null;
  notes: string | null;
  focusItemId: string | null;
}

export function DelegateForm({
  focusItems,
  pending,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  focusItems: FocusOption[];
  pending: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (payload: DelegatePayload) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [focusItemId, setFocusItemId] = useState("");

  return (
    <form
      className="mt-4 flex flex-col gap-3.5 rounded-lg border border-line bg-surface-soft/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          delegateName: name.trim(),
          delegateEmail: email.trim() || null,
          dueAt: dueAt || null,
          notes: notes.trim() || null,
          focusItemId: focusItemId || null,
        });
      }}
    >
      <TextField
        label="Hand it to"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        error={fieldErrors.delegateName}
      />
      <TextField
        label="Their email (optional)"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="No email is sent — this is just for your record."
        error={fieldErrors.delegateEmail}
      />
      <TextField
        label="Follow up by (optional)"
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        error={fieldErrors.dueAt}
      />
      {focusItems.length > 0 && (
        <SelectField
          label="Link to a focus (optional)"
          value={focusItemId}
          onChange={(e) => setFocusItemId(e.target.value)}
        >
          <option value="">No focus link</option>
          {focusItems.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </SelectField>
      )}
      <TextAreaField
        label="Notes (optional)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        error={fieldErrors.notes}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Delegate it
        </Button>
      </div>
    </form>
  );
}
