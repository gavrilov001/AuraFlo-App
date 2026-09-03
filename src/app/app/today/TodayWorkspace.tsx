"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Link2,
  Pencil,
  Plus,
  Undo2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField, SelectField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type MenuItem } from "@/components/ui/DropdownMenu";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatDateOnly, formatInTimeZone } from "@/lib/utils/datetime";
import type {
  FocusOption,
  PlanItemWithTask,
  PlanTask,
} from "@/lib/data/start-day";
import type { ResetPreview } from "@/lib/data/today";
import {
  linkFocusAction,
  moveTaskToLaterAction,
  removeFromPlanAction,
  rescheduleTaskAction,
  updatePlanTaskAction,
} from "../start/actions";
import {
  completeDayAction,
  quickCaptureAction,
  setTaskDoneAction,
} from "./actions";
import { DayActions } from "./DayActions";

type ActionPromise = Promise<{ ok: boolean; error?: string }>;

export function TodayWorkspace({
  plan,
  greeting,
  name,
  topPriorities,
  otherTasks,
  scheduledDue,
  waiting,
  focusItems,
  allFocusItems,
  resetPreview,
  timezone,
}: {
  plan: { id: string };
  greeting: string;
  name: string | null;
  topPriorities: PlanItemWithTask[];
  otherTasks: PlanItemWithTask[];
  scheduledDue: PlanTask[];
  waiting: PlanTask[];
  focusItems: FocusOption[];
  allFocusItems: FocusOption[];
  resetPreview: ResetPreview;
  timezone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // Optimistic completion overlay: taskId -> desired done state.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [savingTasks, setSavingTasks] = useState<Set<string>>(new Set());

  const isDone = (item: PlanItemWithTask) => {
    const base =
      Boolean(item.completed_at) || item.task?.status === "completed";
    return overrides[item.task.id] ?? base;
  };

  function run(promise: ActionPromise, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  function setDone(taskId: string, done: boolean, opts: { toast?: boolean } = {}) {
    if (savingTasks.has(taskId)) return;
    setOverrides((o) => ({ ...o, [taskId]: done }));
    setSavingTasks((s) => new Set(s).add(taskId));
    void setTaskDoneAction({ planId: plan.id, taskId, done }).then((result) => {
      setSavingTasks((s) => {
        const n = new Set(s);
        n.delete(taskId);
        return n;
      });
      if (!result.ok) {
        setOverrides((o) => {
          const n = { ...o };
          delete n[taskId];
          return n;
        });
        toast.error(result.error ?? "We couldn't update that task.");
        return;
      }
      if (opts.toast && done) {
        toast.success("Task completed.", {
          label: "Undo",
          onClick: () => setDone(taskId, false),
        });
      }
    });
  }

  const priorityDone = topPriorities.filter(isDone).length;
  const activeOther = useMemo(
    () => otherTasks.filter((i) => !isDone(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherTasks, overrides],
  );
  const completedOther = useMemo(
    () => otherTasks.filter(isDone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherTasks, overrides],
  );

  const completedCount = priorityDone + completedOther.length;
  const totalCount = topPriorities.length + otherTasks.length;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[clamp(1.75rem,1.5rem+1vw,2.25rem)] font-semibold tracking-[-0.015em] text-ink">
              {greeting}
              {name ? `, ${name}` : ""}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              Here&rsquo;s what you chose to move forward today.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/app/start?mode=adjust"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-surface-hover"
            >
              <Pencil aria-hidden className="size-3.5" />
              Adjust plan
            </Link>
            <DayActions planId={plan.id} resetPreview={resetPreview} />
          </div>
        </div>
        {totalCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] text-muted">
              {completedCount} of {totalCount} completed
            </p>
            <div className="h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-line-soft">
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {error && <FormMessage tone="error">{error}</FormMessage>}

      <QuickCapture
        pending={isPending}
        onCapture={(content) =>
          quickCaptureAction({ content }).then((r) => {
            if (r.ok) toast.success("Captured to your Dream Catcher.");
            else toast.error(r.error);
          })
        }
      />

      {topPriorities.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Top priorities</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topPriorities.map((item) => (
              <PriorityCard
                key={item.id}
                item={item}
                done={isDone(item)}
                saving={savingTasks.has(item.task.id)}
                onToggle={(v) => setDone(item.task.id, v, { toast: true })}
                timezone={timezone}
              />
            ))}
          </ul>
        </section>
      )}

      {(activeOther.length > 0 || totalCount === 0) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Other tasks</h2>
          {activeOther.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-faint">
              Nothing planned for today. You can still add a task from Start My
              Day.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activeOther.map((item) => (
                <TaskRow
                  key={item.id}
                  item={item}
                  done={false}
                  saving={savingTasks.has(item.task.id)}
                  onToggle={(v) => setDone(item.task.id, v, { toast: true })}
                  onRun={run}
                  focusItems={allFocusItems}
                  timezone={timezone}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {completedOther.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            aria-expanded={showCompleted}
            className="flex items-center gap-1.5 self-start text-[14px] font-semibold text-muted hover:text-ink"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                showCompleted && "rotate-180",
              )}
            />
            Completed today ({completedOther.length})
          </button>
          {showCompleted && (
            <ul className="flex flex-col gap-2">
              {completedOther.map((item) => (
                <TaskRow
                  key={item.id}
                  item={item}
                  done
                  saving={savingTasks.has(item.task.id)}
                  onToggle={(v) => setDone(item.task.id, v)}
                  onRun={run}
                  focusItems={allFocusItems}
                  timezone={timezone}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {scheduledDue.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-ink">
            Scheduled or due today
          </h2>
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {scheduledDue.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <p className="text-[14px] text-body">{task.title}</p>
                <Meta task={task} timezone={timezone} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-ink">
            Waiting on others
          </h2>
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {waiting.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[14px] text-body">{task.title}</p>
                  <p className="mt-0.5 text-[12px] text-faint">
                    {task.delegate_name
                      ? `With ${task.delegate_name}`
                      : "Delegated"}
                    {task.delegate_email ? ` · ${task.delegate_email}` : ""}
                    {task.due_at
                      ? ` · follow up ${new Date(
                          task.due_at,
                        ).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={savingTasks.has(task.id)}
                  onClick={() => setDone(task.id, true, { toast: true })}
                >
                  Mark complete
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {focusItems.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[15px] font-semibold text-ink">
            Focus supported today
          </h2>
          <ul className="flex flex-wrap gap-2">
            {focusItems.map((f) => (
              <li
                key={f.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-soft px-2.5 py-1 text-[13px] text-body"
              >
                <Link2 aria-hidden className="size-3.5 text-gold-dark" />
                {f.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-1 border-t border-line-soft pt-6">
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={isPending}
          onClick={() => setConfirmComplete(true)}
        >
          Finish today
        </Button>
        <p className="text-[12px] text-faint">
          Close today&rsquo;s plan when you&rsquo;re ready.
        </p>
      </div>

      <ConfirmDialog
        open={confirmComplete}
        title="Finish today?"
        description="This closes today's plan. Any tasks you haven't finished stay open — nothing is completed or rolled over automatically."
        confirmLabel="Yes, finish today"
        loading={isPending}
        onCancel={() => setConfirmComplete(false)}
        onConfirm={() =>
          run(completeDayAction({ planId: plan.id }), () =>
            setConfirmComplete(false),
          )
        }
      />
    </div>
  );
}

function QuickCapture({
  pending,
  onCapture,
}: {
  pending: boolean;
  onCapture: (content: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden className="size-4" />
        Quick capture
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 shadow-note sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const content = value.trim();
        if (!content || busy) return;
        // Optimistic: clear + close immediately, persist in the background.
        setValue("");
        setBusy(true);
        void onCapture(content).finally(() => setBusy(false));
        setOpen(false);
      }}
    >
      <div className="flex-1">
        <TextField
          label="Capture a thought"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="It goes to your inbox, not today's list"
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={pending || busy}
          disabled={!value.trim()}
        >
          Capture
        </Button>
      </div>
    </form>
  );
}

function CompleteControl({
  done,
  saving,
  onToggle,
  tone = "default",
}: {
  done: boolean;
  saving: boolean;
  onToggle: (value: boolean) => void;
  tone?: "default" | "compact";
}) {
  if (done) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => onToggle(false)}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-gold/15 px-2.5 py-1 text-[12px] font-medium text-gold-dark transition-colors hover:bg-gold/25 disabled:opacity-50",
        )}
      >
        <Check aria-hidden className="size-3.5" />
        Done
        <span className="sr-only"> — reopen</span>
        <Undo2 aria-hidden className="size-3 opacity-60" />
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => onToggle(true)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:border-gold/50 hover:bg-gold/10 hover:text-gold-dark disabled:opacity-50",
        tone === "compact" && "px-2",
      )}
    >
      <Check aria-hidden className="size-3.5" />
      Complete
    </button>
  );
}

function PriorityCard({
  item,
  done,
  saving,
  onToggle,
  timezone,
}: {
  item: PlanItemWithTask;
  done: boolean;
  saving: boolean;
  onToggle: (value: boolean) => void;
  timezone: string;
}) {
  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border border-l-2 p-3.5 shadow-note",
        done
          ? "border-line border-l-gold/50 bg-surface-soft/60"
          : "border-line border-l-gold bg-cream",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <p
          className={cn(
            "text-[14px] font-medium leading-snug",
            done ? "text-muted" : "text-ink",
          )}
        >
          {item.task.title}
        </p>
        <CompleteControl done={done} saving={saving} onToggle={onToggle} />
      </div>
      <Meta task={item.task} timezone={timezone} />
    </li>
  );
}

function TaskRow({
  item,
  done,
  saving,
  onToggle,
  onRun,
  focusItems,
  timezone,
}: {
  item: PlanItemWithTask;
  done: boolean;
  saving: boolean;
  onToggle: (value: boolean) => void;
  onRun: (p: ActionPromise, cb?: () => void) => void;
  focusItems: FocusOption[];
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [title, setTitle] = useState(item.task.title);
  const [notes, setNotes] = useState(item.task.notes ?? "");
  const [focusId, setFocusId] = useState(item.task.focus_item_id ?? "");
  const [when, setWhen] = useState("");

  const menu: MenuItem[] = [
    {
      label: "Edit task",
      icon: <Pencil aria-hidden className="size-3.5" />,
      onClick: () => setEditing(true),
    },
    {
      label: item.task.focus ? "Change focus link" : "Link to a focus",
      icon: <Link2 aria-hidden className="size-3.5" />,
      onClick: () => setLinking(true),
    },
    {
      label: "Reschedule",
      icon: <CalendarClock aria-hidden className="size-3.5" />,
      onClick: () => setRescheduling(true),
    },
    {
      label: "Move to Later",
      icon: <Clock3 aria-hidden className="size-3.5" />,
      onClick: () => onRun(moveTaskToLaterAction({ taskId: item.task.id })),
    },
    {
      label: "Remove from today",
      icon: <X aria-hidden className="size-3.5" />,
      onClick: () => onRun(removeFromPlanAction({ planItemId: item.id })),
      danger: true,
    },
  ];

  return (
    <li
      className={cn(
        "rounded-lg border border-line p-3.5",
        done ? "bg-surface-soft/60" : "bg-surface",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-3">
              <TextField
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <TextAreaField
                label="Notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setTitle(item.task.title);
                    setNotes(item.task.notes ?? "");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!title.trim()}
                  onClick={() =>
                    onRun(
                      updatePlanTaskAction({
                        taskId: item.task.id,
                        title: title.trim(),
                        notes: notes.trim() || null,
                      }),
                      () => setEditing(false),
                    )
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p
                className={cn(
                  "text-[14px] leading-snug",
                  done ? "text-muted" : "text-body",
                )}
              >
                {item.task.title}
              </p>
              <Meta task={item.task} timezone={timezone} />
            </>
          )}

          {linking && (
            <FocusEditor
              value={focusId}
              options={focusItems}
              onChange={setFocusId}
              onCancel={() => setLinking(false)}
              onSave={() =>
                onRun(
                  linkFocusAction({
                    taskId: item.task.id,
                    focusItemId: focusId || null,
                  }),
                  () => setLinking(false),
                )
              }
            />
          )}

          {rescheduling && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface-soft/60 p-3">
              <TextField
                label="New date"
                type="date"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRescheduling(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!when}
                  onClick={() =>
                    onRun(
                      rescheduleTaskAction({
                        taskId: item.task.id,
                        scheduledFor: when,
                      }),
                      () => setRescheduling(false),
                    )
                  }
                >
                  Reschedule
                </Button>
              </div>
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1.5">
            <CompleteControl done={done} saving={saving} onToggle={onToggle} />
            <DropdownMenu label="Task actions" items={menu} />
          </div>
        )}
      </div>
    </li>
  );
}

function FocusEditor({
  value,
  options,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  options: FocusOption[];
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface-soft/60 p-3">
      <SelectField
        label="Focus link"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No focus link</option>
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {f.title}
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave}>
          Save link
        </Button>
      </div>
    </div>
  );
}

function Meta({ task, timezone }: { task: PlanTask; timezone: string }) {
  const has = task.category || task.scheduled_for || task.due_at || task.focus;
  if (!has) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
      {task.category && (
        <CategoryChip name={task.category.name} color={task.category.color} />
      )}
      {task.scheduled_for && <span>{formatDateOnly(task.scheduled_for)}</span>}
      {task.due_at && <span>due {formatInTimeZone(task.due_at, timezone)}</span>}
      {task.focus && (
        <span className="inline-flex items-center gap-1">
          <Link2 aria-hidden className="size-3" />
          {task.focus.title}
        </span>
      )}
    </div>
  );
}
