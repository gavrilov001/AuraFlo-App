"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock3, Pencil, UserPlus, Zap } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type {
  FocusOption,
  InboxProgress,
  PlanCounts,
  ReviewCapture,
} from "@/lib/data/start-day";
import { BatchOrganize } from "./BatchOrganize";
import { SupportPanel } from "./SupportPanel";
import { UndoDecision } from "./UndoDecision";
import { ScheduleForm, type SchedulePayload } from "./ScheduleForm";
import { DelegateForm, type DelegatePayload } from "./DelegateForm";
import {
  editReviewCaptureAction,
  goToShapeDayAction,
  processCapturesAction,
  undoDecisionAction,
  undoDiscardAction,
} from "./actions";

type Decision = "do_now" | "schedule" | "delegate" | "later";
type Mode = "decide" | "schedule" | "delegate" | "edit";
type UndoState = {
  captureId: string;
  kind: "decision" | "discard";
  decision?: Decision;
  label: string;
} | null;

const UNDO_LABEL: Record<string, string> = {
  do_now: "Moved to today.",
  schedule: "Scheduled.",
  delegate: "Delegated.",
  later: "Saved for later.",
};

const COUNT_KEY: Record<string, keyof PlanCounts | null> = {
  do_now: "today",
  schedule: "scheduled",
  delegate: "delegated",
  later: "later",
  discard: null,
};

export function CaptureReview({
  plan,
  captures,
  focusItems,
  planCounts,
  progress,
  timezone,
}: {
  plan: { id: string; plan_date: string };
  captures: ReviewCapture[];
  focusItems: FocusOption[];
  planCounts: PlanCounts;
  progress: InboxProgress;
  timezone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<PlanCounts>(planCounts);
  const [mode, setMode] = useState<Mode>("decide");
  const [viewMode, setViewMode] = useState<"one" | "batch">("one");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<UndoState>(null);
  const [confirmUndo, setConfirmUndo] = useState<UndoState>(null);
  const [editContent, setEditContent] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const undoTimer = useRef<number | undefined>(undefined);

  const queue = useMemo(
    () => captures.filter((c) => !handled.has(c.id)),
    [captures, handled],
  );
  const active = queue.find((c) => !skipped.has(c.id)) ?? null;
  const allSkipped = !active && queue.length > 0;
  const upcoming = useMemo(
    () => queue.filter((c) => c.id !== active?.id).slice(0, 3),
    [queue, active],
  );

  const position = Math.min(
    progress.total - queue.length + 1,
    progress.total,
  );

  const clearUndoSoon = useCallback(() => {
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }, []);

  const adjustCount = useCallback((decision: string, delta: number) => {
    const key = COUNT_KEY[decision];
    if (!key) return;
    setCounts((c) => ({ ...c, [key]: Math.max(0, c[key] + delta) }));
  }, []);

  function bumpCount(decision: Decision, delta: 1 | -1) {
    adjustCount(decision, delta);
  }

  const addHandled = useCallback((ids: string[]) => {
    setHandled((h) => {
      const n = new Set(h);
      ids.forEach((id) => n.add(id));
      return n;
    });
  }, []);

  const removeHandled = useCallback((ids: string[]) => {
    setHandled((h) => {
      const n = new Set(h);
      ids.forEach((id) => n.delete(id));
      return n;
    });
  }, []);

  /** Optimistically advance past `active`, persist in the background. */
  function decide(decision: Decision, extra: Record<string, unknown> = {}) {
    const target = active;
    if (!target || inFlight.has(target.id)) return;

    setError(null);
    setFieldErrors({});
    setMode("decide");
    setHandled((h) => new Set(h).add(target.id));
    setInFlight((s) => new Set(s).add(target.id));
    bumpCount(decision, 1);
    setUndo({
      captureId: target.id,
      kind: "decision",
      decision,
      label: UNDO_LABEL[decision] ?? "Done.",
    });
    clearUndoSoon();

    void processCapturesAction({
      planId: plan.id,
      captureIds: [target.id],
      decision,
      ...extra,
    }).then((result) => {
      setInFlight((s) => {
        const n = new Set(s);
        n.delete(target.id);
        return n;
      });
      if (!result.ok) {
        // Roll back only this thought.
        setHandled((h) => {
          const n = new Set(h);
          n.delete(target.id);
          return n;
        });
        bumpCount(decision, -1);
        setUndo(null);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else setError(result.error);
        toast.error(result.error ?? "That decision didn't save.");
      }
    });
  }

  function discard() {
    const target = active;
    if (!target || inFlight.has(target.id)) return;
    setError(null);
    setMode("decide");
    setHandled((h) => new Set(h).add(target.id));
    setInFlight((s) => new Set(s).add(target.id));
    setUndo({ captureId: target.id, kind: "discard", label: "Discarded." });
    clearUndoSoon();

    void processCapturesAction({
      planId: plan.id,
      captureIds: [target.id],
      decision: "discard",
    }).then((result) => {
      setInFlight((s) => {
        const n = new Set(s);
        n.delete(target.id);
        return n;
      });
      if (!result.ok) {
        setHandled((h) => {
          const n = new Set(h);
          n.delete(target.id);
          return n;
        });
        setUndo(null);
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  function skip() {
    if (!active) return;
    setSkipped((s) => new Set(s).add(active.id));
    setMode("decide");
    setError(null);
  }

  function runUndo(target: UndoState, force = false) {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      if (target.kind === "discard") {
        const result = await undoDiscardAction({
          captureId: target.captureId,
          planId: plan.id,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } else {
        const result = await undoDecisionAction({
          captureId: target.captureId,
          planId: plan.id,
          force,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.data.status === "needs_confirmation") {
          setConfirmUndo(target);
          return;
        }
        if (target.decision) bumpCount(target.decision, -1);
      }
      setHandled((h) => {
        const n = new Set(h);
        n.delete(target.captureId);
        return n;
      });
      setUndo(null);
      setConfirmUndo(null);
      router.refresh();
    });
  }

  function saveEdit() {
    if (!active || !editContent.trim()) return;
    setFieldErrors({});
    startTransition(async () => {
      const result = await editReviewCaptureAction({
        captureId: active.id,
        content: editContent.trim(),
        notes: editNotes.trim() || null,
      });
      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else setError(result.error);
        return;
      }
      setMode("decide");
      router.refresh();
    });
  }

  function shapeDay() {
    startTransition(async () => {
      await goToShapeDayAction({ planId: plan.id });
      router.refresh();
    });
  }

  // --- render ----------------------------------------------------------

  const sidePanel = (
    <SupportPanel
      counts={counts}
      upcoming={upcoming}
      remaining={queue.length}
    />
  );

  const viewSwitch = (
    <div
      role="group"
      aria-label="Review mode"
      className="inline-flex self-start rounded-md border border-line bg-surface p-0.5 text-[13px]"
    >
      {(["one", "batch"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setViewMode(v)}
          aria-pressed={viewMode === v}
          className={cn(
            "rounded px-3 py-1 font-medium transition-colors",
            viewMode === v ? "bg-beige text-ink" : "text-muted hover:text-ink",
          )}
        >
          {v === "one" ? "One at a time" : "Batch organize"}
        </button>
      ))}
    </div>
  );

  if (viewMode === "batch") {
    return (
      <Layout side={sidePanel}>
        <div className="flex flex-col gap-4">
          {viewSwitch}
          <BatchOrganize
            planId={plan.id}
            captures={queue}
            timezone={timezone}
            planDate={plan.plan_date}
            focusItems={focusItems}
            onHandled={addHandled}
            onUnhandled={removeHandled}
            onCount={adjustCount}
          />
          <button
            type="button"
            onClick={shapeDay}
            className="self-start text-[13px] font-medium text-faint hover:text-ink"
          >
            I&rsquo;m done here — shape my day
          </button>
          <div className="lg:hidden">{sidePanel}</div>
        </div>
      </Layout>
    );
  }

  if (allSkipped) {
    return (
      <Layout side={sidePanel}>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-note">
          <h2 className="text-[18px] font-semibold text-ink">
            You&rsquo;ve skipped the rest for now.
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {queue.length} {queue.length === 1 ? "thought is" : "thoughts are"}{" "}
            still waiting. Review them now, or move on and come back later.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <Button onClick={() => setSkipped(new Set())}>Review them now</Button>
            <Link
              href="/app/capture"
              className="text-[13px] font-medium text-faint hover:text-ink"
            >
              Go to Dream Catcher instead
            </Link>
          </div>
        </div>
        <div className="mt-4 lg:hidden">{sidePanel}</div>
      </Layout>
    );
  }

  if (!active) {
    return (
      <Layout side={sidePanel}>
        <div className="flex flex-col gap-4">
          {undo && (
            <UndoDecision
              label={undo.label}
              pending={isPending}
              onUndo={() => runUndo(undo)}
            />
          )}
          <div className="rounded-xl border border-line bg-surface p-6 shadow-note sm:p-8">
            <h2 className="text-[19px] font-semibold text-ink">
              Your inbox is clear.
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Now let&rsquo;s decide what deserves your attention today.
            </p>
            <div className="mt-5">
              <Button loading={isPending} onClick={shapeDay}>
                Shape my day
              </Button>
            </div>
          </div>
          <div className="lg:hidden">{sidePanel}</div>
        </div>
        <ConfirmDialog
          open={Boolean(confirmUndo)}
          title="Undo this decision?"
          description="The task created from this thought has changed since you made it. Undoing will delete that task and return the thought to your inbox."
          confirmLabel="Undo anyway"
          destructive
          loading={isPending}
          onCancel={() => setConfirmUndo(null)}
          onConfirm={() => runUndo(confirmUndo, true)}
        />
      </Layout>
    );
  }

  const busy = inFlight.has(active.id);

  return (
    <Layout side={sidePanel}>
      <div className="flex flex-col gap-4">
        {viewSwitch}
        {undo && (
          <UndoDecision
            label={undo.label}
            pending={isPending}
            onUndo={() => runUndo(undo)}
          />
        )}

        <div className="w-full rounded-xl border border-line bg-surface p-6 shadow-note sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-faint">
              Thought {position} of {progress.total}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditContent(active.content);
                setEditNotes(active.notes ?? "");
                setMode(mode === "edit" ? "decide" : "edit");
              }}
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] font-medium text-muted hover:text-ink"
            >
              <Pencil aria-hidden className="size-3.5" />
              Edit
            </button>
          </div>

          {mode === "edit" ? (
            <div className="mt-3 flex flex-col gap-3">
              <TextAreaField
                label="Thought"
                rows={3}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                error={fieldErrors.content}
              />
              <TextAreaField
                label="Notes (optional)"
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                error={fieldErrors.notes}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setMode("decide")}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveEdit}
                  loading={isPending}
                  disabled={!editContent.trim()}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 whitespace-pre-wrap break-words text-[17px] leading-relaxed text-ink">
                {active.content}
              </p>
              {active.notes && (
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-muted">
                  {active.notes}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-faint">
                <time dateTime={active.captured_at}>
                  Captured {formatInTimeZone(active.captured_at, timezone)}
                </time>
                {active.category && (
                  <CategoryChip
                    name={active.category.name}
                    color={active.category.color}
                  />
                )}
              </div>
            </>
          )}

          {error && (
            <div className="mt-4">
              <FormMessage tone="error">{error}</FormMessage>
            </div>
          )}

          {mode === "decide" && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DecisionButton
                  primary
                  icon={<Zap aria-hidden className="size-4" />}
                  label="Do now"
                  hint="Add to today"
                  disabled={busy}
                  onClick={() => decide("do_now")}
                />
                <DecisionButton
                  icon={<CalendarClock aria-hidden className="size-4" />}
                  label="Schedule"
                  hint="Choose a date"
                  disabled={busy}
                  onClick={() => setMode("schedule")}
                />
                <DecisionButton
                  icon={<UserPlus aria-hidden className="size-4" />}
                  label="Delegate"
                  hint="Assign to someone"
                  disabled={busy}
                  onClick={() => setMode("delegate")}
                />
                <DecisionButton
                  icon={<Clock3 aria-hidden className="size-4" />}
                  label="Later"
                  hint="Keep for another time"
                  disabled={busy}
                  onClick={() => decide("later")}
                />
              </div>
              <div className="mt-1 border-t border-line-soft pt-3">
                <button
                  type="button"
                  onClick={discard}
                  disabled={busy}
                  className="text-[13px] font-medium text-faint underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                >
                  Discard this thought
                </button>
              </div>
            </div>
          )}

          {mode === "schedule" && (
            <ScheduleForm
              planDate={plan.plan_date}
              focusItems={focusItems}
              pending={busy}
              fieldErrors={fieldErrors}
              onCancel={() => setMode("decide")}
              onSubmit={(payload: SchedulePayload) =>
                decide("schedule", {
                  scheduledFor: payload.scheduledFor,
                  dueAt: payload.dueAt,
                  notes: payload.notes,
                  focusItemId: payload.focusItemId,
                  addToToday: payload.addToToday,
                })
              }
            />
          )}

          {mode === "delegate" && (
            <DelegateForm
              focusItems={focusItems}
              pending={busy}
              fieldErrors={fieldErrors}
              onCancel={() => setMode("decide")}
              onSubmit={(payload: DelegatePayload) =>
                decide("delegate", {
                  delegateName: payload.delegateName,
                  delegateEmail: payload.delegateEmail,
                  dueAt: payload.dueAt,
                  notes: payload.notes,
                  focusItemId: payload.focusItemId,
                })
              }
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <button
            type="button"
            onClick={skip}
            className="font-medium text-muted hover:text-ink"
          >
            Skip for now
          </button>
          <Link href="/app/capture" className="text-faint hover:text-ink">
            Exit and continue later
          </Link>
        </div>

        <div className="lg:hidden">{sidePanel}</div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmUndo)}
        title="Undo this decision?"
        description="The task created from this thought has changed since you made it. Undoing will delete that task and return the thought to your inbox."
        confirmLabel="Undo anyway"
        destructive
        loading={isPending}
        onCancel={() => setConfirmUndo(null)}
        onConfirm={() => runUndo(confirmUndo, true)}
      />
    </Layout>
  );
}

function DecisionButton({
  icon,
  label,
  hint,
  primary = false,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "border-navy-900 bg-navy-900 text-cream hover:bg-navy-800"
          : "border-line bg-surface text-ink hover:border-line-soft hover:bg-surface-hover",
      )}
    >
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "text-[12px] font-normal",
          primary ? "text-cream/70" : "text-faint",
        )}
      >
        {hint}
      </span>
    </button>
  );
}

function Layout({
  children,
  side,
}: {
  children: React.ReactNode;
  side: React.ReactNode;
}) {
  return (
    <div className="w-full lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <div className="w-full min-w-0">{children}</div>
      <aside className="hidden lg:block">
        <div className="sticky top-4">{side}</div>
      </aside>
    </div>
  );
}
