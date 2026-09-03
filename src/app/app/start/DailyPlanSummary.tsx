"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2, Star } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { formatDateOnly } from "@/lib/utils/datetime";
import type {
  FocusOption,
  PlanItemWithTask,
  PlanTask,
} from "@/lib/data/start-day";
import {
  backToStepAction,
  startDayAction,
  toggleTopThreeAction,
} from "./actions";

export function DailyPlanSummary({
  plan,
  topPriorities,
  otherTasks,
  scheduledDue,
  waiting,
  focusItems,
}: {
  plan: { id: string };
  topPriorities: PlanItemWithTask[];
  otherTasks: PlanItemWithTask[];
  scheduledDue: PlanTask[];
  waiting: PlanTask[];
  focusItems: FocusOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(promise: Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  function startDay() {
    setError(null);
    startTransition(async () => {
      const result = await startDayAction({ planId: plan.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(result.data.redirectTo);
    });
  }

  const nothingPlanned =
    topPriorities.length === 0 && otherTasks.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-[22px] font-semibold text-ink">Your plan for today</h2>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-muted">
          Take one last look. You can adjust anything before you begin.
        </p>
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}

      {nothingPlanned && (
        <FormMessage tone="success">
          You haven&rsquo;t added anything to today. That&rsquo;s allowed — you
          can still start with a clear, open day.
        </FormMessage>
      )}

      {topPriorities.length > 0 && (
        <Section title="Top priorities" hint="What would make today feel meaningful">
          <ul className="flex flex-col gap-2">
            {topPriorities.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-gold/50 bg-surface p-3.5"
              >
                <Star aria-hidden className="mt-0.5 size-4 shrink-0 fill-gold text-gold" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink">
                    {item.task.title}
                  </p>
                  <TaskMeta task={item.task} />
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      toggleTopThreeAction({
                        planItemId: item.id,
                        value: false,
                      }),
                    )
                  }
                  className="shrink-0 text-[12px] font-medium text-faint hover:text-ink disabled:opacity-50"
                >
                  Unpick
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {otherTasks.length > 0 && (
        <Section title="Other tasks for today">
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {otherTasks.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <p className="text-[14px] text-body">{item.task.title}</p>
                <TaskMeta task={item.task} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {scheduledDue.length > 0 && (
        <Section
          title="Scheduled or due today"
          hint="Not in your plan, but landing today"
        >
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {scheduledDue.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <p className="text-[14px] text-body">{task.title}</p>
                <TaskMeta task={task} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {waiting.length > 0 && (
        <Section title="Waiting on others">
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {waiting.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <p className="text-[14px] text-body">{task.title}</p>
                <p className="mt-1 text-[12px] text-faint">
                  {task.delegate_name
                    ? `With ${task.delegate_name}`
                    : "Delegated"}
                  {task.due_at
                    ? ` · follow up ${new Date(task.due_at).toLocaleDateString()}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {focusItems.length > 0 && (
        <Section title="Supporting your focus">
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
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line-soft pt-6">
        <Button onClick={startDay} loading={isPending}>
          Start my day
          <ArrowRight aria-hidden className="size-4" />
        </Button>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            run(backToStepAction({ planId: plan.id, step: "prioritize" }))
          }
          className="text-[13px] font-medium text-faint hover:text-ink disabled:opacity-50"
        >
          Back to planning
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {hint && <p className="text-[13px] text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TaskMeta({ task }: { task: PlanTask }) {
  const hasMeta =
    task.category || task.scheduled_for || task.due_at || task.focus;
  if (!hasMeta) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
      {task.category && (
        <CategoryChip name={task.category.name} color={task.category.color} />
      )}
      {task.scheduled_for && <span>{formatDateOnly(task.scheduled_for)}</span>}
      {task.due_at && (
        <span>due {new Date(task.due_at).toLocaleDateString()}</span>
      )}
      {task.focus && (
        <span className="inline-flex items-center gap-1">
          <Link2 aria-hidden className="size-3" />
          {task.focus.title}
        </span>
      )}
    </div>
  );
}
