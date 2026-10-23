"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField, SelectField } from "@/components/ui/Field";
import type { FocusOption } from "@/lib/data/start-day";

export interface SchedulePayload {
  scheduledFor: string;
  dueAt: string | null;
  notes: string | null;
  focusItemId: string | null;
  addToToday: boolean;
}

export function ScheduleForm({
  planDate,
  focusItems,
  pending,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  planDate: string;
  focusItems: FocusOption[];
  pending: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (payload: SchedulePayload) => void;
  onCancel: () => void;
}) {
  const [scheduledFor, setScheduledFor] = useState(planDate);
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [focusItemId, setFocusItemId] = useState("");
  const [addToToday, setAddToToday] = useState(false);

  const isToday = scheduledFor === planDate;

  return (
    <form
      className="mt-4 flex flex-col gap-3.5 rounded-lg border border-line bg-surface-soft/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          scheduledFor,
          dueAt: dueAt || null,
          notes: notes.trim() || null,
          focusItemId: focusItemId || null,
          addToToday: isToday && addToToday,
        });
      }}
    >
      <TextField
        label="Schedule for"
        type="date"
        required
        value={scheduledFor}
        min={planDate}
        onChange={(e) => setScheduledFor(e.target.value)}
        error={fieldErrors.scheduledFor}
      />
      <TextField
        label="Due (optional)"
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
      {isToday && (
        <label className="flex items-start gap-2.5 text-[14px] text-body">
          <input
            type="checkbox"
            checked={addToToday}
            onChange={(e) => setAddToToday(e.target.checked)}
            className="mt-0.5 size-4 rounded border-line accent-navy-900"
          />
          Also add it to today&rsquo;s plan
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Schedule it
        </Button>
      </div>
    </form>
  );
}
