import "server-only";

import { createClient } from "@/lib/supabase/server";
import { localDayBoundsUtc } from "@/lib/utils/local-date";
import type {
  Capture,
  DailyPlan,
  DailyPlanItem,
  FocusHorizon,
  Task,
} from "@/lib/types/database.types";

type CategoryRef = { id: string; name: string; color: string | null } | null;
type FocusRef = { id: string; title: string; horizon: FocusHorizon } | null;

export interface ReviewCapture extends Capture {
  category: CategoryRef;
}

export interface PlanTask extends Task {
  category: CategoryRef;
  focus: FocusRef;
}

export interface PlanItemWithTask extends DailyPlanItem {
  task: PlanTask;
}

export interface FocusOption {
  id: string;
  title: string;
  horizon: FocusHorizon;
}

export interface PlanCounts {
  today: number;
  scheduled: number;
  delegated: number;
  later: number;
}

export interface InboxProgress {
  reviewed: number;
  remaining: number;
  total: number;
}

const TASK_SELECT =
  "*, category:categories(id, name, color), focus:focus_items(id, title, horizon)";

/**
 * Get-or-create the user's draft daily plan for `planDate`. Race-safe: a unique
 * violation from a concurrent tab / refresh falls back to re-selecting the row.
 */
export async function ensureDailyPlan(
  workspaceId: string,
  userId: string,
  planDate: string,
): Promise<DailyPlan> {
  const supabase = await createClient();

  const existing = await supabase
    .from("daily_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("plan_date", planDate)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const created = await supabase
    .from("daily_plans")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      plan_date: planDate,
      status: "draft",
      workflow_step: "capture_review",
    })
    .select("*")
    .single();
  if (created.data) return created.data;

  if (created.error?.code === "23505") {
    const again = await supabase
      .from("daily_plans")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("plan_date", planDate)
      .single();
    if (again.error) throw again.error;
    return again.data;
  }
  throw created.error;
}

/**
 * SELECT-only lookup of the user's daily plan for `planDate`. Never creates a
 * plan — the Today page uses this so that merely visiting Today does not start
 * a new day.
 */
export async function getDailyPlan(
  workspaceId: string,
  userId: string,
  planDate: string,
): Promise<DailyPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("plan_date", planDate)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listActiveFocusItems(
  workspaceId: string,
): Promise<FocusOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("focus_items")
    .select("id, title, horizon")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("horizon", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// --- Stage 1: clear the inbox ---------------------------------------------

export async function getStage1Data(
  workspaceId: string,
  userId: string,
  plan: DailyPlan,
): Promise<{
  captures: ReviewCapture[];
  planCounts: PlanCounts;
  progress: InboxProgress;
}> {
  const supabase = await createClient();

  const [inbox, sessionTasks, reviewedSince] = await Promise.all([
    supabase
      .from("captures")
      .select("*, category:categories(id, name, color)")
      .eq("workspace_id", workspaceId)
      .eq("status", "inbox")
      .order("captured_at", { ascending: true })
      .returns<ReviewCapture[]>(),
    // Tasks created from a capture during this planning session.
    supabase
      .from("tasks")
      .select("bucket")
      .eq("workspace_id", workspaceId)
      .eq("created_by", userId)
      .not("source_capture_id", "is", null)
      .gte("created_at", plan.created_at),
    // Captures moved out of the inbox since this plan was created.
    supabase
      .from("captures")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["processed", "discarded"])
      .gte("processed_at", plan.created_at),
  ]);

  if (inbox.error) throw inbox.error;
  if (sessionTasks.error) throw sessionTasks.error;
  if (reviewedSince.error) throw reviewedSince.error;

  const planCounts: PlanCounts = {
    today: 0,
    scheduled: 0,
    delegated: 0,
    later: 0,
  };
  for (const row of sessionTasks.data ?? []) {
    if (row.bucket === "today") planCounts.today += 1;
    else if (row.bucket === "scheduled") planCounts.scheduled += 1;
    else if (row.bucket === "delegated") planCounts.delegated += 1;
    else if (row.bucket === "someday") planCounts.later += 1;
  }

  const remaining = inbox.data?.length ?? 0;
  const reviewed = reviewedSince.count ?? 0;

  return {
    captures: inbox.data ?? [],
    planCounts,
    progress: { reviewed, remaining, total: reviewed + remaining },
  };
}

// --- Stage 2: shape the day ---------------------------------------------

export async function getStage2Data(
  workspaceId: string,
  plan: DailyPlan,
  timezone: string,
): Promise<{
  planItems: PlanItemWithTask[];
  availableTasks: PlanTask[];
}> {
  const supabase = await createClient();
  const { startUtc, endUtc } = localDayBoundsUtc(timezone, plan.plan_date);

  const [items, candidates] = await Promise.all([
    supabase
      .from("daily_plan_items")
      .select(`*, task:tasks(${TASK_SELECT})`)
      .eq("daily_plan_id", plan.id)
      .order("sort_order", { ascending: true })
      .returns<PlanItemWithTask[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "in_progress", "waiting"])
      .or(
        `bucket.eq.today,bucket.eq.delegated,scheduled_for.eq.${plan.plan_date},and(due_at.gte.${startUtc},due_at.lt.${endUtc})`,
      )
      .order("created_at", { ascending: true })
      .returns<PlanTask[]>(),
  ]);

  if (items.error) throw items.error;
  if (candidates.error) throw candidates.error;

  const inPlan = new Set((items.data ?? []).map((i) => i.task_id));
  const availableTasks = (candidates.data ?? []).filter(
    (t) => !inPlan.has(t.id),
  );

  return { planItems: items.data ?? [], availableTasks };
}

// --- Stage 3: ready -----------------------------------------------------

export async function getStage3Data(
  workspaceId: string,
  plan: DailyPlan,
  timezone: string,
): Promise<{
  topPriorities: PlanItemWithTask[];
  otherTasks: PlanItemWithTask[];
  scheduledDue: PlanTask[];
  waiting: PlanTask[];
  focusItems: FocusOption[];
}> {
  const supabase = await createClient();
  const { startUtc, endUtc } = localDayBoundsUtc(timezone, plan.plan_date);

  const [items, scheduled, waiting] = await Promise.all([
    supabase
      .from("daily_plan_items")
      .select(`*, task:tasks(${TASK_SELECT})`)
      .eq("daily_plan_id", plan.id)
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
    if (f) focusMap.set(f.id, f);
  }

  return {
    topPriorities,
    otherTasks,
    scheduledDue,
    waiting: waiting.data ?? [],
    focusItems: [...focusMap.values()],
  };
}
