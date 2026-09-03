"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { NotebookPen, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField, SelectField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CategoryOption } from "@/lib/data/categories";
import type { FocusOption } from "@/lib/data/start-day";
import type { TaskDetail, TaskRow } from "@/lib/data/tasks";
import type { Destination } from "@/lib/validation/tasks";
import {
  createTaskAction,
  taskDetailAction,
  updateTaskAction,
} from "./actions";

export type Mode =
  | { kind: "add" }
  | { kind: "edit"; task: TaskRow; forceDestination?: Destination };

const DESTINATION_LABEL: Record<Destination, string> = {
  today: "Today",
  scheduled: "Schedule",
  delegated: "Delegate",
  later: "Later",
};

function bucketToDestination(bucket: string): Destination {
  return bucket === "someday" ? "later" : (bucket as Destination);
}

export function TaskPanel({
  mode,
  categories,
  focusItems,
  onClose,
  onDone,
}: {
  mode: Mode | null;
  categories: CategoryOption[];
  focusItems: FocusOption[];
  onClose: () => void;
  onDone: (opts: { structural: boolean }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = mode !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const formKey =
    mode?.kind === "edit"
      ? `edit-${mode.task.id}-${mode.forceDestination ?? ""}`
      : "add";

  return (
    <dialog
      ref={ref}
      aria-label={mode?.kind === "edit" ? "Edit task" : "Add task"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-[min(100vw,460px)] rounded-none border-l border-line bg-surface p-0 text-body shadow-pop backdrop:bg-navy-900/25"
    >
      {mode && (
        <TaskForm
          key={formKey}
          mode={mode}
          categories={categories}
          focusItems={focusItems}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </dialog>
  );
}

function TaskForm({
  mode,
  categories,
  focusItems,
  onClose,
  onDone,
}: {
  mode: Mode;
  categories: CategoryOption[];
  focusItems: FocusOption[];
  onClose: () => void;
  onDone: (opts: { structural: boolean }) => void;
}) {
  const editing = mode.kind === "edit" ? mode.task : null;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmReopen, setConfirmReopen] = useState(false);

  const [title, setTitle] = useState(editing?.title ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? "");
  const [focusItemId, setFocusItemId] = useState(editing?.focus_item_id ?? "");
  const [priority, setPriority] = useState(String(editing?.priority ?? 2));
  const [destination, setDestination] = useState<Destination>(
    mode.kind === "edit"
      ? mode.forceDestination ?? bucketToDestination(mode.task.bucket)
      : "today",
  );
  const [scheduledFor, setScheduledFor] = useState(
    editing?.scheduled_for ?? "",
  );
  const [dueAt, setDueAt] = useState("");
  const [delegateName, setDelegateName] = useState(editing?.delegate_name ?? "");
  const [delegateEmail, setDelegateEmail] = useState(
    editing?.delegate_email ?? "",
  );
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    taskDetailAction(editing.id).then((r) => {
      if (alive && r.ok) setDetail(r.data.detail);
    });
    return () => {
      alive = false;
    };
  }, [editing]);

  function submit(reopenPlan = false) {
    if (!title.trim() || isPending) return;
    setError(null);
    setFieldErrors({});
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      categoryId: categoryId || null,
      focusItemId: focusItemId || null,
      priority: Number(priority),
      destination,
      scheduledFor: scheduledFor || null,
      dueAt: dueAt || null,
      delegateName: delegateName.trim() || null,
      delegateEmail: delegateEmail.trim() || null,
      reopenPlan,
    };
    startTransition(async () => {
      const result = editing
        ? await updateTaskAction({ taskId: editing.id, ...payload })
        : await createTaskAction(payload);
      if (!result.ok) {
        if (result.error.includes("Reopen it to add")) {
          setConfirmReopen(true);
          return;
        }
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        setError(result.error);
        return;
      }
      onDone({ structural: true });
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
        <h2 className="text-[16px] font-semibold text-ink">
          {editing ? "Edit task" : "Add task"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 rounded p-1 text-faint hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <form
        className="flex-1 overflow-y-auto px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-3.5">
          <TextField
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={fieldErrors.title}
            autoFocus
          />
          <TextAreaField
            label="Notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            error={fieldErrors.notes}
          />

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-body">
              Destination
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(DESTINATION_LABEL) as Destination[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={destination === d}
                  onClick={() => setDestination(d)}
                  className={
                    "rounded-md border px-3 py-2 text-[13px] font-medium transition-colors " +
                    (destination === d
                      ? "border-navy-900 bg-navy-900 text-cream"
                      : "border-line bg-surface text-ink hover:bg-surface-hover")
                  }
                >
                  {DESTINATION_LABEL[d]}
                </button>
              ))}
            </div>
          </div>

          {destination === "scheduled" && (
            <TextField
              label="Scheduled for"
              type="date"
              required
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              error={fieldErrors.scheduledFor}
            />
          )}
          {destination === "delegated" && (
            <>
              <TextField
                label="Delegate to"
                required
                value={delegateName}
                onChange={(e) => setDelegateName(e.target.value)}
                error={fieldErrors.delegateName}
              />
              <TextField
                label="Their email (optional)"
                type="email"
                value={delegateEmail}
                onChange={(e) => setDelegateEmail(e.target.value)}
                hint="No email is sent — this is just for your record."
                error={fieldErrors.delegateEmail}
              />
            </>
          )}

          <TextField
            label="Due date & time (optional)"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            error={fieldErrors.dueAt}
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="1">Highest</option>
              <option value="2">Normal</option>
              <option value="3">Low</option>
              <option value="4">Lowest</option>
            </SelectField>
          </div>

          <SelectField
            label="Focus item (optional)"
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

          {error && !confirmReopen && (
            <FormMessage tone="error">{error}</FormMessage>
          )}

          {confirmReopen && (
            <div className="rounded-md border border-line bg-surface-soft/60 p-3 text-[13px]">
              <p className="text-body">
                Reopen today&rsquo;s plan to add this task?
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => submit(true)}
                  loading={isPending}
                >
                  Reopen &amp; add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmReopen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {editing && detail && (
            <div className="mt-1 flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12px] text-faint">
              {detail.source_capture_id && (
                <span className="inline-flex items-center gap-1.5 text-gold-dark">
                  <NotebookPen aria-hidden className="size-3.5" />
                  Created from Dream Catcher
                </span>
              )}
              {detail.capture && (
                <p className="italic leading-relaxed">
                  &ldquo;{detail.capture.content}&rdquo;
                </p>
              )}
              <DetailRow label="Created">
                {formatInTimeZone(detail.created_at, "UTC", {
                  dateStyle: "medium",
                })}
              </DetailRow>
              {detail.completed_at && (
                <DetailRow label="Completed">
                  {formatInTimeZone(detail.completed_at, "UTC", {
                    dateStyle: "medium",
                  })}
                </DetailRow>
              )}
              {detail.creator?.full_name && (
                <DetailRow label="Created by">
                  {detail.creator.full_name}
                </DetailRow>
              )}
              {detail.in_today_plan && (
                <DetailRow label="On today's plan">
                  {detail.todayPlanStatus ?? "yes"}
                </DetailRow>
              )}
            </div>
          )}
        </div>
      </form>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          loading={isPending}
          disabled={!title.trim()}
          onClick={() => submit()}
        >
          {editing ? "Save" : "Add task"}
        </Button>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-body">{children}</span>
    </div>
  );
}
