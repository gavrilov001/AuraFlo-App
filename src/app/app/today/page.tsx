import type { Metadata } from "next";
import Link from "next/link";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { getDailyPlan, listActiveFocusItems } from "@/lib/data/start-day";
import { getResetPreview, getTodayData } from "@/lib/data/today";
import {
  greetingFor,
  localDateFor,
  longLocalDate,
} from "@/lib/utils/local-date";
import { TodayWorkspace } from "./TodayWorkspace";
import { DayActions } from "./DayActions";

export const metadata: Metadata = { title: "Today" };

function firstName(fullName: string | null): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0]!;
}

export default async function TodayPage() {
  const { user, profile, workspace } = await requireWorkspaceContext();
  const timezone = profile.timezone;
  const planDate = localDateFor(timezone);
  const plan = await getDailyPlan(workspace.id, user.id, planDate);

  const name = firstName(profile.full_name);
  const dateLabel = longLocalDate(timezone);
  const greeting = greetingFor(timezone);

  // --- No plan for today ---------------------------------------------------
  if (!plan) {
    return (
      <Shell dateLabel={dateLabel}>
        <EmptyCard
          title="Today starts with a clear plan"
          text="Take a few minutes to clear your inbox and choose what matters."
          actionHref="/app/start"
          actionLabel="Start My Day"
        />
      </Shell>
    );
  }

  // --- Draft plan --------------------------------------------------------
  if (plan.status === "draft") {
    const draftPreview = await getResetPreview(workspace.id, plan);
    return (
      <Shell dateLabel={dateLabel}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div />
            <DayActions planId={plan.id} resetPreview={draftPreview} />
          </div>
          <EmptyCard
            title="Your plan is still taking shape"
            text="Continue where you left off and finish planning your day."
            actionHref="/app/start"
            actionLabel="Continue Start My Day"
          />
        </div>
      </Shell>
    );
  }

  const [data, allFocusItems, resetPreview] = await Promise.all([
    getTodayData(workspace.id, plan, timezone),
    listActiveFocusItems(workspace.id),
    getResetPreview(workspace.id, plan),
  ]);

  // --- Completed plan --------------------------------------------------
  if (plan.status === "completed") {
    const all = [...data.topPriorities, ...data.otherTasks];
    return (
      <Shell dateLabel={dateLabel}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[clamp(1.75rem,1.5rem+1vw,2.25rem)] font-semibold tracking-[-0.015em] text-ink">
                Today is complete
              </h1>
              <p className="mt-1.5 text-[15px] text-muted">
                {data.progress.completed} of {data.progress.total} planned tasks
                finished. Anything unfinished is still open in All Tasks.
              </p>
            </div>
            <DayActions
              planId={plan.id}
              resetPreview={resetPreview}
              showRestartButton
            />
          </div>
          {all.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
              {all.map((item) => {
                const done =
                  Boolean(item.completed_at) ||
                  item.task?.status === "completed";
                return (
                  <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
                    <span
                      className={
                        "text-[14px] " +
                        (done
                          ? "text-faint line-through"
                          : "text-body")
                      }
                    >
                      {item.task.title}
                    </span>
                    {item.task.notes && (
                      <span className="text-[12px] leading-relaxed text-faint">
                        {item.task.notes}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Shell>
    );
  }

  // --- Active plan ------------------------------------------------------
  return (
    <Shell dateLabel={dateLabel}>
      <TodayWorkspace
        plan={{ id: plan.id }}
        greeting={greeting}
        name={name}
        topPriorities={data.topPriorities}
        otherTasks={data.otherTasks}
        scheduledDue={data.scheduledDue}
        waiting={data.waiting}
        focusItems={data.focusItems}
        allFocusItems={allFocusItems}
        resetPreview={resetPreview}
        timezone={timezone}
      />
    </Shell>
  );
}

function Shell({
  dateLabel,
  children,
}: {
  dateLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <p className="mb-6 text-[13px] text-faint">{dateLabel}</p>
      {children}
    </div>
  );
}

function EmptyCard({
  title,
  text,
  actionHref,
  actionLabel,
}: {
  title: string;
  text: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="max-w-xl rounded-xl border border-line bg-surface p-6 shadow-note sm:p-8">
      <h1 className="text-[20px] font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
      <Link
        href={actionHref}
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-navy-900 px-5 text-[15px] font-medium text-cream transition-colors hover:bg-navy-800"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
