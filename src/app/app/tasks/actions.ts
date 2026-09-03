"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  actionError,
  actionOk,
  parseInput,
  toMessage,
  type ActionResult,
} from "@/lib/actions/result";
import { ensureDailyPlan } from "@/lib/data/start-day";
import { getTaskDetail, type TaskDetail } from "@/lib/data/tasks";
import { localDateFor } from "@/lib/utils/local-date";
import type { Database, Task } from "@/lib/types/database.types";
import {
  createTaskSchema,
  destinationToBucket,
  moveTaskSchema,
  reorderTasksSchema,
  setTaskStatusSchema,
  setTaskTopThreeSchema,
  updateTaskSchema,
} from "@/lib/validation/tasks";

type Db = SupabaseClient<Database>;

const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);
let createRpc: boolean | null = null;
let moveRpc: boolean | null = null;
let statusRpc: boolean | null = null;
let topThreeRpc: boolean | null = null;
let reorderRpc: boolean | null = null;

function friendly(code?: string, message?: string): string {
  switch (code) {
    case "P0001":
      return message === "plan_completed"
        ? "Today's plan is complete. Reopen it to add this task."
        : message ?? "That change can't be applied.";
    case "22023":
    case "23514":
      return message ?? "Some details are missing or invalid.";
    case "42501":
      return "You don't have access to do that.";
    default:
      return "Something went wrong. Please try again.";
  }
}

interface Ctx {
  supabase: Db;
  userId: string;
  workspaceId: string;
  timezone: string;
}

async function ctx(): Promise<Ctx> {
  const { user, workspace, profile } = await requireWorkspaceContext();
  const supabase = await createClient();
  return {
    supabase,
    userId: user.id,
    workspaceId: workspace.id,
    timezone: profile.timezone,
  };
}

async function loadOwnedTask(
  c: Ctx,
  taskId: string,
): Promise<Task> {
  const { data, error } = await c.supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("workspace_id", c.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("We couldn't find that task.");
  return data;
}

async function verifyRefs(
  c: Ctx,
  categoryId: string | null,
  focusItemId: string | null,
): Promise<void> {
  if (categoryId) {
    const { data } = await c.supabase
      .from("categories")
      .select("id")
      .eq("id", categoryId)
      .eq("workspace_id", c.workspaceId)
      .maybeSingle();
    if (!data) throw new Error("That category isn't in your workspace.");
  }
  if (focusItemId) {
    const { data } = await c.supabase
      .from("focus_items")
      .select("id")
      .eq("id", focusItemId)
      .eq("workspace_id", c.workspaceId)
      .maybeSingle();
    if (!data) throw new Error("That focus item isn't in your workspace.");
  }
}

/** Get-or-reopen today's plan id for the caller. */
async function todayPlanId(
  c: Ctx,
  allowReopen: boolean,
): Promise<string> {
  const plan = await ensureDailyPlan(
    c.workspaceId,
    c.userId,
    localDateFor(c.timezone),
  );
  if (plan.status === "completed") {
    if (!allowReopen) {
      const e = new Error("plan_completed") as Error & { code?: string };
      e.code = "P0001";
      throw e;
    }
    await c.supabase
      .from("daily_plans")
      .update({ status: "active", completed_at: null })
      .eq("id", plan.id);
  }
  return plan.id;
}

async function detachFromPlans(c: Ctx, taskId: string): Promise<void> {
  const { data: plans } = await c.supabase
    .from("daily_plans")
    .select("id")
    .eq("user_id", c.userId)
    .eq("workspace_id", c.workspaceId);
  for (const p of plans ?? []) {
    await c.supabase
      .from("daily_plan_items")
      .delete()
      .eq("daily_plan_id", p.id)
      .eq("task_id", taskId);
  }
}

function done(): void {
  revalidatePath("/app/tasks");
  revalidatePath("/app/today");
  revalidatePath("/app/start");
}

// --- read: one task's detail (for the panel) --------------------------

export async function taskDetailAction(
  taskId: string,
): Promise<ActionResult<{ detail: TaskDetail }>> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return actionError("Invalid identifier.");
  try {
    const c = await ctx();
    const detail = await getTaskDetail(
      c.workspaceId,
      c.userId,
      c.timezone,
      taskId,
    );
    if (!detail) return actionError("We couldn't find that task.");
    return actionOk({ detail });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't load that task."));
  }
}

// --- create -------------------------------------------------------------

export async function createTaskAction(
  input: unknown,
): Promise<ActionResult<{ task: Task }>> {
  const parsed = parseInput(createTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;
  const bucket = destinationToBucket(p.destination);

  try {
    const c = await ctx();

    if (createRpc !== false) {
      const rpc = await c.supabase.rpc("tasks_create", {
        p_workspace_id: c.workspaceId,
        p_title: p.title,
        p_bucket: bucket,
        p_notes: p.notes ?? null,
        p_category_id: p.categoryId ?? null,
        p_focus_item_id: p.focusItemId ?? null,
        p_scheduled_for: p.scheduledFor ?? null,
        p_due_at: p.dueAt ?? null,
        p_delegate_name: p.delegateName ?? null,
        p_delegate_email: p.delegateEmail ?? null,
        p_priority: p.priority ?? 2,
        p_reopen_plan: p.reopenPlan ?? false,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) createRpc = false;
        else return actionError(friendly(rpc.error.code, rpc.error.message));
      } else {
        createRpc = true;
        done();
        return actionOk({ task: (rpc.data as { task: Task }).task });
      }
    }

    // fallback
    await verifyRefs(c, p.categoryId ?? null, p.focusItemId ?? null);
    let scheduledFor: string | null = null;
    let status: Task["status"] = "open";
    let planId: string | null = null;
    if (bucket === "today") {
      planId = await todayPlanId(c, p.reopenPlan ?? false);
      scheduledFor = localDateFor(c.timezone);
    } else if (bucket === "scheduled") {
      if (!p.scheduledFor) return actionError("Choose a date.");
      scheduledFor = p.scheduledFor;
    } else if (bucket === "delegated") {
      if (!p.delegateName?.trim())
        return actionError("Who are you handing this to?");
      status = "waiting";
    }
    const ins = await c.supabase
      .from("tasks")
      .insert({
        workspace_id: c.workspaceId,
        created_by: c.userId,
        category_id: p.categoryId ?? null,
        focus_item_id: p.focusItemId ?? null,
        title: p.title,
        notes: p.notes ?? null,
        status,
        bucket: bucket as Task["bucket"],
        priority: p.priority ?? 2,
        scheduled_for: scheduledFor,
        due_at: p.dueAt ?? null,
        delegate_name:
          bucket === "delegated" ? p.delegateName?.trim() ?? null : null,
        delegate_email:
          bucket === "delegated" ? p.delegateEmail ?? null : null,
        delegated_at: bucket === "delegated" ? new Date().toISOString() : null,
      })
      .select("*")
      .single();
    if (ins.error) throw ins.error;
    if (planId) {
      const { data: last } = await c.supabase
        .from("daily_plan_items")
        .select("sort_order")
        .eq("daily_plan_id", planId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      await c.supabase.from("daily_plan_items").upsert(
        {
          daily_plan_id: planId,
          task_id: ins.data.id,
          sort_order: (last?.sort_order ?? 0) + 10,
          is_top_three: false,
        },
        { onConflict: "daily_plan_id,task_id", ignoreDuplicates: true },
      );
    }
    done();
    return actionOk({ task: ins.data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendly(code, toMessage(error)));
    return actionError(toMessage(error, "We couldn't add that task."));
  }
}

// --- move --------------------------------------------------------------

async function moveCore(
  c: Ctx,
  taskId: string,
  p: {
    destination: "today" | "scheduled" | "delegated" | "later";
    scheduledFor?: string | null;
    dueAt?: string | null;
    delegateName?: string | null;
    delegateEmail?: string | null;
    reopenPlan?: boolean;
  },
): Promise<Task> {
  const bucket = destinationToBucket(p.destination);
  const task = await loadOwnedTask(c, taskId);
  if (task.status === "completed" || task.status === "cancelled") {
    throw new Error("That task is not active.");
  }
  await detachFromPlans(c, taskId);

  if (bucket === "today") {
    const planId = await todayPlanId(c, p.reopenPlan ?? false);
    const upd = await c.supabase
      .from("tasks")
      .update({
        bucket: "today",
        status: "open",
        scheduled_for: localDateFor(c.timezone),
      })
      .eq("id", taskId)
      .eq("workspace_id", c.workspaceId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;
    const { data: last } = await c.supabase
      .from("daily_plan_items")
      .select("sort_order")
      .eq("daily_plan_id", planId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    await c.supabase.from("daily_plan_items").upsert(
      {
        daily_plan_id: planId,
        task_id: taskId,
        sort_order: (last?.sort_order ?? 0) + 10,
        is_top_three: false,
      },
      { onConflict: "daily_plan_id,task_id", ignoreDuplicates: true },
    );
    return upd.data;
  }

  const patch: Partial<Task> = {};
  if (bucket === "scheduled") {
    if (!p.scheduledFor) throw new Error("Choose a date.");
    Object.assign(patch, {
      bucket: "scheduled",
      status: "open",
      scheduled_for: p.scheduledFor,
      due_at: p.dueAt ?? task.due_at,
      delegate_name: null,
      delegate_email: null,
      delegated_at: null,
    });
  } else if (bucket === "delegated") {
    if (!p.delegateName?.trim()) throw new Error("Who are you handing this to?");
    Object.assign(patch, {
      bucket: "delegated",
      status: "waiting",
      scheduled_for: null,
      due_at: p.dueAt ?? task.due_at,
      delegate_name: p.delegateName.trim(),
      delegate_email: p.delegateEmail ?? null,
      delegated_at: new Date().toISOString(),
    });
  } else {
    Object.assign(patch, {
      bucket: "someday",
      status: "open",
      scheduled_for: null,
      delegate_name: null,
      delegate_email: null,
      delegated_at: null,
    });
  }
  const upd = await c.supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("workspace_id", c.workspaceId)
    .select("*")
    .single();
  if (upd.error) throw upd.error;
  return upd.data;
}

export async function moveTaskAction(
  input: unknown,
): Promise<ActionResult<{ task: Task }>> {
  const parsed = parseInput(moveTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const c = await ctx();
    if (moveRpc !== false) {
      const rpc = await c.supabase.rpc("tasks_move_to_destination", {
        p_task_id: p.taskId,
        p_bucket: destinationToBucket(p.destination),
        p_scheduled_for: p.scheduledFor ?? null,
        p_due_at: p.dueAt ?? null,
        p_delegate_name: p.delegateName ?? null,
        p_delegate_email: p.delegateEmail ?? null,
        p_reopen_plan: p.reopenPlan ?? false,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) moveRpc = false;
        else return actionError(friendly(rpc.error.code, rpc.error.message));
      } else {
        moveRpc = true;
        done();
        return actionOk({ task: rpc.data as unknown as Task });
      }
    }
    const task = await moveCore(c, p.taskId, p);
    done();
    return actionOk({ task });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendly(code, toMessage(error)));
    return actionError(toMessage(error, "We couldn't move that task."));
  }
}

// --- update (fields + optional destination change) --------------------

export async function updateTaskAction(
  input: unknown,
): Promise<ActionResult<{ task: Task }>> {
  const parsed = parseInput(updateTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const c = await ctx();
    await verifyRefs(c, p.categoryId ?? null, p.focusItemId ?? null);
    const task = await loadOwnedTask(c, p.taskId);
    const targetBucket = destinationToBucket(p.destination);

    // Editable fields (never workspace_id / created_by / status via this path).
    const fields: Partial<Task> = {
      title: p.title,
      notes: p.notes ?? null,
      category_id: p.categoryId ?? null,
      focus_item_id: p.focusItemId ?? null,
      priority: p.priority ?? task.priority,
      due_at: p.dueAt ?? null,
    };
    if (targetBucket === task.bucket) {
      // Same destination — apply the destination-specific fields inline.
      if (targetBucket === "scheduled") {
        if (!p.scheduledFor) return actionError("Choose a date.");
        fields.scheduled_for = p.scheduledFor;
      } else if (targetBucket === "delegated") {
        if (!p.delegateName?.trim())
          return actionError("Who are you handing this to?");
        fields.delegate_name = p.delegateName.trim();
        fields.delegate_email = p.delegateEmail ?? null;
      }
    }
    const upd = await c.supabase
      .from("tasks")
      .update(fields)
      .eq("id", p.taskId)
      .eq("workspace_id", c.workspaceId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;

    let result = upd.data;
    if (targetBucket !== task.bucket) {
      if (moveRpc !== false) {
        const rpc = await c.supabase.rpc("tasks_move_to_destination", {
          p_task_id: p.taskId,
          p_bucket: targetBucket,
          p_scheduled_for: p.scheduledFor ?? null,
          p_due_at: p.dueAt ?? null,
          p_delegate_name: p.delegateName ?? null,
          p_delegate_email: p.delegateEmail ?? null,
          p_reopen_plan: p.reopenPlan ?? false,
        });
        if (rpc.error) {
          if (RPC_MISSING.has(rpc.error.code ?? "")) moveRpc = false;
          else return actionError(friendly(rpc.error.code, rpc.error.message));
        } else {
          moveRpc = true;
          result = rpc.data as unknown as Task;
        }
      }
      if (moveRpc === false) {
        result = await moveCore(c, p.taskId, p);
      }
    }
    done();
    return actionOk({ task: result });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendly(code, toMessage(error)));
    return actionError(toMessage(error, "We couldn't save that task."));
  }
}

// --- status: complete / reopen / cancel -------------------------------

export async function setTaskStatusAction(
  input: unknown,
): Promise<ActionResult<{ task: Task }>> {
  const parsed = parseInput(setTaskStatusSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const c = await ctx();
    if (statusRpc !== false) {
      const rpc = await c.supabase.rpc("tasks_set_status", {
        p_task_id: p.taskId,
        p_op: p.op,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) statusRpc = false;
        else return actionError(friendly(rpc.error.code, rpc.error.message));
      } else {
        statusRpc = true;
        done();
        return actionOk({ task: rpc.data as unknown as Task });
      }
    }

    const task = await loadOwnedTask(c, p.taskId);
    const next =
      p.op === "complete"
        ? "completed"
        : p.op === "cancel"
          ? "cancelled"
          : task.bucket === "delegated"
            ? "waiting"
            : "open";
    const upd = await c.supabase
      .from("tasks")
      .update({ status: next as Task["status"] })
      .eq("id", p.taskId)
      .eq("workspace_id", c.workspaceId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;

    const { data: plans } = await c.supabase
      .from("daily_plans")
      .select("id")
      .eq("user_id", c.userId)
      .eq("workspace_id", c.workspaceId);
    for (const plan of plans ?? []) {
      if (p.op === "cancel") {
        await c.supabase
          .from("daily_plan_items")
          .delete()
          .eq("daily_plan_id", plan.id)
          .eq("task_id", p.taskId);
      } else {
        await c.supabase
          .from("daily_plan_items")
          .update({
            completed_at: p.op === "complete" ? new Date().toISOString() : null,
          })
          .eq("daily_plan_id", plan.id)
          .eq("task_id", p.taskId);
      }
    }
    done();
    return actionOk({ task: upd.data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendly(code, toMessage(error)));
    return actionError(toMessage(error, "We couldn't update that task."));
  }
}

// --- top three -------------------------------------------------------

export async function setTaskTopThreeAction(
  input: unknown,
): Promise<ActionResult<{ taskId: string; value: boolean }>> {
  const parsed = parseInput(setTaskTopThreeSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const p = parsed.data;

  try {
    const c = await ctx();
    if (topThreeRpc !== false) {
      const rpc = await c.supabase.rpc("tasks_set_top_three", {
        p_task_id: p.taskId,
        p_value: p.value,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) topThreeRpc = false;
        else return actionError(friendly(rpc.error.code, rpc.error.message));
      } else {
        topThreeRpc = true;
        done();
        return actionOk({ taskId: p.taskId, value: p.value });
      }
    }

    await loadOwnedTask(c, p.taskId);
    const plan = await ensureDailyPlan(
      c.workspaceId,
      c.userId,
      localDateFor(c.timezone),
    );
    const { data: item } = await c.supabase
      .from("daily_plan_items")
      .select("id, daily_plan_id")
      .eq("task_id", p.taskId)
      .eq("daily_plan_id", plan.id)
      .maybeSingle();
    if (!item) return actionError("That task isn't on today's plan.");
    if (p.value) {
      const { count } = await c.supabase
        .from("daily_plan_items")
        .select("id", { count: "exact", head: true })
        .eq("daily_plan_id", item.daily_plan_id)
        .eq("is_top_three", true)
        .neq("id", item.id);
      if ((count ?? 0) >= 3) {
        return actionError("You can choose up to three top priorities.");
      }
    }
    const upd = await c.supabase
      .from("daily_plan_items")
      .update({ is_top_three: p.value })
      .eq("id", item.id);
    if (upd.error) {
      if (upd.error.code === "P0001") {
        return actionError("You can choose up to three top priorities.");
      }
      throw upd.error;
    }
    done();
    return actionOk({ taskId: p.taskId, value: p.value });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update priorities."));
  }
}

// --- reorder --------------------------------------------------------

export async function reorderTasksAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(reorderTasksSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const ids = [...new Set(parsed.data.taskIds)];
  if (ids.length !== parsed.data.taskIds.length) {
    return actionError("That reorder had a repeated task.");
  }

  try {
    const c = await ctx();
    if (reorderRpc !== false) {
      const rpc = await c.supabase.rpc("tasks_reorder", { p_task_ids: ids });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) reorderRpc = false;
        else return actionError(friendly(rpc.error.code, rpc.error.message));
      } else {
        reorderRpc = true;
        return actionOk(null);
      }
    }

    const { data: rows, error } = await c.supabase
      .from("tasks")
      .select("id, bucket, workspace_id")
      .in("id", ids);
    if (error) throw error;
    if (
      (rows ?? []).length !== ids.length ||
      new Set((rows ?? []).map((r) => r.workspace_id)).size !== 1 ||
      (rows ?? [])[0]?.workspace_id !== c.workspaceId ||
      new Set((rows ?? []).map((r) => r.bucket)).size !== 1
    ) {
      return actionError("Those tasks changed. Reload and try again.");
    }
    const results = await Promise.all(
      ids.map((id, i) =>
        c.supabase
          .from("tasks")
          .update({ sort_order: (i + 1) * 10 })
          .eq("id", id)
          .eq("workspace_id", c.workspaceId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save the new order."));
  }
}
