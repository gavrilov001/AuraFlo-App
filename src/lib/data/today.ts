import "server-only";

import { createClient } from "@/lib/supabase/server";
import { localDayBoundsUtc } from "@/lib/utils/local-date";
import type { DailyPlan } from "@/lib/types/database.types";
import type {
  FocusOption,
  PlanItemWithTask,
  PlanTask,
} from "@/lib/data/start-day";
import { sessionTrackingAvailable } from "@/lib/data/session-tracking";

const TASK_SELECT =
  "*, category:categories(id, name, color), focus:focus_items(id, title, horizon)";

export interface TodayData {
  topPriorities: PlanItemWithTask[];
  otherTasks: PlanItemWithTask[];
  scheduledDue: PlanTask[];
  waiting: PlanTask[];
  focusItems: FocusOption[];
  progress: { completed: number; total: number };
}

export interface ResetPreview {
  planItems: number;
  sessionTasks: number;
  restoredCaptures: number;
  completedPreexisting: number;
  /** Tasks completed anywhere inside this plan (for the Restart dialog). */
  completedInPlan: number;
  /** Current Top-3 count (for the Restart dialog). */
  topThree: number;
  legacyUntracked: boolean;
}

/**
 * Counts shown in the "Reset today" confirmation dialog. Read-only; the
 * authoritative numbers come back from the RPC after the reset runs.
 */
export async function getResetPreview(
  workspaceId: string,
  plan: DailyPlan,
): Promise<ResetPreview> {
  const supabase = await createClient();
  const tracking = await sessionTrackingAvailable();

  if (!tracking) {
    // Session tracking columns not present yet — nothing can be safely tied to
    // this session, so reset only clears the plan and its items.
    const { data, error } = await supabase
      .from("daily_plan_items")
      .select("id, is_top_three, task:tasks(status)")
      .eq("daily_plan_id", plan.id)
      .returns<
        { id: string; is_top_three: boolean; task: { status: string } | null }[]
      >();
    if (error) throw error;
    const rows = data ?? [];
    const completed = rows.filter((r) => r.task?.status === "completed").length;
    return {
      planItems: rows.length,
      sessionTasks: 0,
      restoredCaptures: 0,
      completedPreexisting: completed,
      completedInPlan: completed,
      topThree: rows.filter((r) => r.is_top_three).length,
      legacyUntracked: rows.length > 0,
    };
  }

  const [items, sessionTasks, sessionCaptures] = await Promise.all([
    supabase
      .from("daily_plan_items")
      .select("id, is_top_three, task:tasks(status, origin_daily_plan_id)")
      .eq("daily_plan_id", plan.id)
      .returns<
        {
          id: string;
          is_top_three: boolean;
          task: { status: string; origin_daily_plan_id: string | null } | null;
        }[]
      >(),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("origin_daily_plan_id", plan.id),
    supabase
      .from("captures")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("processed_in_daily_plan_id", plan.id),
  ]);

  if (items.error) throw items.error;
  if (sessionTasks.error) throw sessionTasks.error;
  if (sessionCaptures.error) throw sessionCaptures.error;

  const rows = items.data ?? [];
  const planItems = rows.length;
  const completedPreexisting = rows.filter(
    (r) =>
      r.task?.status === "completed" &&
      r.task?.origin_daily_plan_id !== plan.id,
  ).length;
  const completedInPlan = rows.filter(
    (r) => r.task?.status === "completed",
  ).length;
  const topThree = rows.filter((r) => r.is_top_three).length;

  const sTasks = sessionTasks.count ?? 0;
  const sCaptures = sessionCaptures.count ?? 0;

  return {
    planItems,
    sessionTasks: sTasks,
    restoredCaptures: sCaptures,
    completedPreexisting,
    completedInPlan,
    topThree,
    legacyUntracked: planItems > 0 && sTasks === 0 && sCaptures === 0,
  };
}

/** Full read model for an active (or completed) daily plan. */
export async function getTodayData(
  workspaceId: string,
  plan: DailyPlan,
  timezone: string,
): Promise<TodayData> {
  const supabase = await createClient();
  const { startUtc, endUtc } = localDayBoundsUtc(timezone, plan.plan_date);

  const [items, scheduled, waiting] = await Promise.all([
    supabase
      .from("daily_plan_items")
      .select(`*, task:tasks(${TASK_SELECT})`)
      .eq("daily_plan_id", plan.id)
      .order("is_top_three", { ascending: false })
      .order("sort_order", { ascending: true })
      .returns<PlanItemWithTask[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "in_progress"])
      .or(
        `scheduled_for.eq.${plan.plan_date},and(due_at.gte.${startUtc},due_at.lt.${endUtc})`,
      )
      .order("scheduled_for", { ascending: true })
      .returns<PlanTask[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("bucket", "delegated")
      .eq("status", "waiting")
      .order("delegated_at", { ascending: true })
      .returns<PlanTask[]>(),
  ]);

  if (items.error) throw items.error;
  if (scheduled.error) throw scheduled.error;
  if (waiting.error) throw waiting.error;

  const planItems = items.data ?? [];
  const planTaskIds = new Set(planItems.map((i) => i.task_id));

  const topPriorities = planItems.filter((i) => i.is_top_three);
  const otherTasks = planItems.filter((i) => !i.is_top_three);

  const scheduledDue = (scheduled.data ?? []).filter(
    (t) => !planTaskIds.has(t.id),
  );

  const focusMap = new Map<string, FocusOption>();
  for (const item of planItems) {
    const f = item.task?.focus;
    const task = item.task;
    if (f && task && task.status !== "completed" && task.status !== "cancelled") {
      focusMap.set(f.id, f);
    }
  }

  const completed = planItems.filter(
    (i) => i.completed_at || i.task?.status === "completed",
  ).length;

  return {
    topPriorities,
    otherTasks,
    scheduledDue,
    waiting: waiting.data ?? [],
    focusItems: [...focusMap.values()],
    progress: { completed, total: planItems.length },
  };
}
