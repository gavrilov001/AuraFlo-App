import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { listCategories } from "@/lib/data/categories";
import {
  ensureDailyPlan,
  getStage1Data,
  getStage2Data,
  getStage3Data,
  listActiveFocusItems,
} from "@/lib/data/start-day";
import { getResetPreview } from "@/lib/data/today";
import {
  greetingFor,
  localDateFor,
  longLocalDate,
} from "@/lib/utils/local-date";
import { DayActions } from "../today/DayActions";
import { StartDayHeader } from "./StartDayHeader";
import { StartDayStepper } from "./StartDayStepper";
import { CaptureReview } from "./CaptureReview";
import { InboxClearState } from "./InboxClearState";
import { ShapeDay } from "./ShapeDay";
import { DailyPlanSummary } from "./DailyPlanSummary";
import { AlreadyPlanned } from "./AlreadyPlanned";

export const metadata: Metadata = { title: "Start my day" };

function firstName(fullName: string | null): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0]!;
}

const STEP_INDEX = {
  capture_review: 0,
  prioritize: 1,
  ready: 2,
} as const;

export default async function StartMyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const adjustMode = mode === "adjust";
  const { user, profile, workspace } = await requireWorkspaceContext();
  const timezone = profile.timezone;
  const planDate = localDateFor(timezone);
  const plan = await ensureDailyPlan(workspace.id, user.id, planDate);
  // A daily_plans row always exists here (ensureDailyPlan). Day actions are
  // available at every step / status.
  const resetPreview = await getResetPreview(workspace.id, plan);

  const headerProps = {
    greeting: greetingFor(timezone),
    name: firstName(profile.full_name),
    dateLabel: longLocalDate(timezone),
  };

  const stepIndex = STEP_INDEX[plan.workflow_step];

  let body: React.ReactNode;
  let progress: { reviewed: number; total: number } | undefined;

  if (
    plan.status === "active" &&
    adjustMode &&
    plan.workflow_step === "prioritize"
  ) {
    const [stage2, focusItems, categories] = await Promise.all([
      getStage2Data(workspace.id, plan, timezone),
      listActiveFocusItems(workspace.id),
      listCategories(workspace.id),
    ]);
    body = (
      <ShapeDay
        plan={{ id: plan.id, plan_date: plan.plan_date }}
        planItems={stage2.planItems}
        availableTasks={stage2.availableTasks}
        focusItems={focusItems}
        categories={categories}
        adjustMode
      />
    );
  } else if (plan.status === "active" && adjustMode) {
    // Active plan, adjust requested but not yet re-opened to the prioritize
    // step — flip it there first.
    body = <AlreadyPlanned planId={plan.id} autoAdjust />;
  } else if (plan.status === "active" || plan.status === "completed") {
    body = (
      <AlreadyPlanned
        planId={plan.id}
        canAdjust={plan.status === "active"}
      />
    );
  } else if (plan.workflow_step === "capture_review") {
    const stage1 = await getStage1Data(workspace.id, user.id, plan);
    progress = { reviewed: stage1.progress.reviewed, total: stage1.progress.total };
    if (stage1.progress.total === 0) {
      // Never had anything to review — still let the user continue.
      body = <InboxClearState planId={plan.id} hadNone />;
    } else {
      // CaptureReview stays mounted through the last decision so its Undo
      // affordance survives; it renders its own "inbox clear" state.
      const focusItems = await listActiveFocusItems(workspace.id);
      body = (
        <CaptureReview
          plan={{ id: plan.id, plan_date: plan.plan_date }}
          captures={stage1.captures}
          focusItems={focusItems}
          planCounts={stage1.planCounts}
          progress={stage1.progress}
          timezone={timezone}
        />
      );
    }
  } else if (plan.workflow_step === "prioritize") {
    const [stage2, focusItems, categories] = await Promise.all([
      getStage2Data(workspace.id, plan, timezone),
      listActiveFocusItems(workspace.id),
      listCategories(workspace.id),
    ]);
    body = (
      <ShapeDay
        plan={{ id: plan.id, plan_date: plan.plan_date }}
        planItems={stage2.planItems}
        availableTasks={stage2.availableTasks}
        focusItems={focusItems}
        categories={categories}
      />
    );
  } else {
    const stage3 = await getStage3Data(workspace.id, plan, timezone);
    body = (
      <DailyPlanSummary
        plan={{ id: plan.id }}
        topPriorities={stage3.topPriorities}
        otherTasks={stage3.otherTasks}
        scheduledDue={stage3.scheduledDue}
        waiting={stage3.waiting}
        focusItems={stage3.focusItems}
      />
    );
  }

  const showStepper = plan.status === "draft";

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <StartDayHeader {...headerProps} />
        <DayActions
          planId={plan.id}
          resetPreview={resetPreview}
          menuLabel="Day actions"
        />
      </div>
      {showStepper && (
        <StartDayStepper
          current={stepIndex}
          progress={progress}
        />
      )}
      {body}
    </div>
  );
}
