import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { localDateFor } from "@/lib/utils/local-date";
import type { Database, FocusHorizon, Task } from "@/lib/types/database.types";
import type { ListTasksInput, TaskView } from "@/lib/validation/tasks";

type Db = SupabaseClient<Database>;

type CategoryRef = { id: string; name: string; color: string | null } | null;
type FocusRef = { id: string; title: string; horizon: FocusHorizon } | null;

export interface TaskRow extends Task {
  category: CategoryRef;
  focus: FocusRef;
  is_top_three: boolean;
  in_today_plan: boolean;
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: TaskRow[];
}

export interface TaskListResult {
  view: TaskView;
  sort: ListTasksInput["sort"];
  page: number;
  hasMore: boolean;
  tasks: TaskRow[];
  groups: TaskGroup[];
  todayPlan: { id: string; status: string } | null;
  topThreeCount: number;
}

export const TASKS_PAGE_SIZE = 40;

const SELECT =
  "id, workspace_id, created_by, source_capture_id, focus_item_id, category_id, " +
  "title, notes, status, bucket, priority, scheduled_for, due_at, delegate_name, " +
  "delegate_email, delegated_at, completed_at, sort_order, created_at, updated_at, " +
  "category:categories(id, name, color), focus:focus_items(id, title, horizon)";

const ACTIVE_STATUSES: Task["status"][] = ["open", "in_progress", "waiting"];

const BUCKET_LABEL: Record<string, string> = {
  today: "Today",
  scheduled: "Scheduled",
  delegated: "Delegated",
  someday: "Later",
};

/** Escape a user search term for a PostgREST `or(...ilike...)` filter. */
function safeTerm(raw: string): string {
  return raw.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
}

async function getTodayPlanItems(
  supabase: Db,
  workspaceId: string,
  userId: string,
  timezone: string,
): Promise<{
  plan: { id: string; status: string } | null;
  byTask: Map<string, { is_top_three: boolean }>;
}> {
  const planDate = localDateFor(timezone);
  const { data: plan } = await supabase
    .from("daily_plans")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("plan_date", planDate)
    .maybeSingle();

  const byTask = new Map<string, { is_top_three: boolean }>();
  if (!plan) return { plan: null, byTask };

  const { data: items } = await supabase
    .from("daily_plan_items")
    .select("task_id, is_top_three")
    .eq("daily_plan_id", plan.id);
  for (const it of items ?? []) {
    byTask.set(it.task_id, { is_top_three: it.is_top_three });
  }
  return { plan, byTask };
}

export async function listTasks(
  workspaceId: string,
  userId: string,
  timezone: string,
  params: ListTasksInput,
): Promise<TaskListResult> {
  const supabase = await createClient();
  const { view, q, category, focus, sort, page, showCancelled } = params;

  const { plan, byTask } = await getTodayPlanItems(
    supabase,
    workspaceId,
    userId,
    timezone,
  );
  const topThreeCount = [...byTask.values()].filter((v) => v.is_top_three).length;

  // --- build the query -----------------------------------------------------
  let query = supabase
    .from("tasks")
    .select(SELECT)
    .eq("workspace_id", workspaceId);

  if (view === "completed") {
    query = query.in(
      "status",
      showCancelled ? ["completed", "cancelled"] : ["completed"],
    );
  } else if (view === "open") {
    query = query.in("status", ACTIVE_STATUSES);
  } else {
    query = query.in("status", ACTIVE_STATUSES);
    if (view === "scheduled") query = query.eq("bucket", "scheduled");
    else if (view === "delegated") query = query.eq("bucket", "delegated");
    else if (view === "later") query = query.eq("bucket", "someday");
    else if (view === "today") {
      const ids = [...byTask.keys()];
      if (ids.length === 0) {
        return emptyResult(view, sort, page, plan, topThreeCount);
      }
      query = query.in("id", ids).eq("bucket", "today");
    }
  }

  if (q) {
    const t = safeTerm(q);
    if (t) {
      query = query.or(
        `title.ilike.%${t}%,notes.ilike.%${t}%,delegate_name.ilike.%${t}%`,
      );
    }
  }
  if (category === "none") query = query.is("category_id", null);
  else if (category) query = query.eq("category_id", category);
  if (focus === "none") query = query.is("focus_item_id", null);
  else if (focus) query = query.eq("focus_item_id", focus);

  if (view === "completed") {
    query = query.order("completed_at", { ascending: false, nullsFirst: false });
  } else if (sort === "due") {
    query = query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
  } else if (sort === "newest") {
    query = query.order("created_at", { ascending: false });
  } else if (sort === "oldest") {
    query = query.order("created_at", { ascending: true });
  } else {
    query = query
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
  }

  // Cumulative paging: page N returns the first N * PAGE_SIZE rows (+1 probe).
  const limit = page * TASKS_PAGE_SIZE;
  query = query.range(0, limit);

  const { data, error } = await query.returns<
    (Task & { category: CategoryRef; focus: FocusRef })[]
  >();
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page_rows = rows.slice(0, limit).map<TaskRow>((r) => ({
    ...r,
    is_top_three: byTask.get(r.id)?.is_top_three ?? false,
    in_today_plan: byTask.has(r.id),
  }));

  return {
    view,
    sort,
    page,
    hasMore,
    tasks: page_rows,
    groups: buildGroups(view, page_rows, timezone),
    todayPlan: plan,
    topThreeCount,
  };
}

function emptyResult(
  view: TaskView,
  sort: ListTasksInput["sort"],
  page: number,
  plan: { id: string; status: string } | null,
  topThreeCount: number,
): TaskListResult {
  return {
    view,
    sort,
    page,
    hasMore: false,
    tasks: [],
    groups: [],
    todayPlan: plan,
    topThreeCount,
  };
}

function buildGroups(
  view: TaskView,
  rows: TaskRow[],
  timezone: string,
): TaskGroup[] {
  if (rows.length === 0) return [];

  if (view === "open") {
    const order = ["today", "scheduled", "delegated", "someday"] as const;
    return order
      .map((bucket) => ({
        key: bucket,
        label: BUCKET_LABEL[bucket],
        tasks: rows.filter((r) => r.bucket === bucket),
      }))
      .filter((g) => g.tasks.length > 0);
  }

  if (view === "today") {
    return [
      {
        key: "top",
        label: "Top priorities",
        tasks: rows.filter((r) => r.is_top_three),
      },
      {
        key: "other",
        label: "Other tasks",
        tasks: rows.filter((r) => !r.is_top_three),
      },
    ].filter((g) => g.tasks.length > 0);
  }

  if (view === "scheduled") {
    const today = localDateFor(timezone);
    const overdue: TaskRow[] = [];
    const dueToday: TaskRow[] = [];
    const upcoming: TaskRow[] = [];
    const noDate: TaskRow[] = [];
    for (const r of rows) {
      if (!r.scheduled_for) noDate.push(r);
      else if (r.scheduled_for < today) overdue.push(r);
      else if (r.scheduled_for === today) dueToday.push(r);
      else upcoming.push(r);
    }
    return [
      { key: "overdue", label: "Overdue", tasks: overdue },
      { key: "today", label: "Today", tasks: dueToday },
      { key: "upcoming", label: "Upcoming", tasks: upcoming },
      { key: "nodate", label: "No date", tasks: noDate },
    ].filter((g) => g.tasks.length > 0);
  }

  // delegated / later / completed — one flat group
  return [{ key: "all", label: "", tasks: rows }];
}

// --- single task (panel details) -----------------------------------------

export interface TaskDetail extends TaskRow {
  capture: { id: string; content: string; source: string } | null;
  creator: { full_name: string | null } | null;
  todayPlanStatus: string | null;
}

export async function getTaskDetail(
  workspaceId: string,
  userId: string,
  timezone: string,
  taskId: string,
): Promise<TaskDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      `${SELECT}, capture:captures!source_capture_id(id, content, source), creator:profiles!created_by(full_name)`,
    )
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { plan, byTask } = await getTodayPlanItems(
    supabase,
    workspaceId,
    userId,
    timezone,
  );

  const row = data as unknown as Task & {
    category: CategoryRef;
    focus: FocusRef;
    capture: { id: string; content: string; source: string } | null;
    creator: { full_name: string | null } | null;
  };

  return {
    ...row,
    is_top_three: byTask.get(row.id)?.is_top_three ?? false,
    in_today_plan: byTask.has(row.id),
    todayPlanStatus: byTask.has(row.id) ? plan?.status ?? null : null,
  };
}
