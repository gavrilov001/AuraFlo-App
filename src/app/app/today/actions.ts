"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  actionError,
  actionOk,
  parseInput,
  toMessage,
  type ActionResult,
} from "@/lib/actions/result";
import { getDailyPlan } from "@/lib/data/start-day";
import { sessionTrackingAvailable } from "@/lib/data/session-tracking";
import { localDateFor } from "@/lib/utils/local-date";
import {
  completeDaySchema,
  quickCaptureSchema,
  resetTodaySchema,
  setTaskDoneSchema,
} from "@/lib/validation/today";

const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);
let taskDoneRpcAvailable: boolean | null = null;
let resetRpcAvailable: boolean | null = null;

/** Load the caller's own active/completed plan by id. */
async function loadPlan(planId: string) {
  const { user, workspace } = await requireWorkspaceContext();
  const supabase = await createClient();
  const { data: plan, error } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  if (!plan || plan.user_id !== user.id || plan.workspace_id !== workspace.id) {
    throw new Error("We couldn't find that plan for your account.");
  }
  return { supabase, userId: user.id, workspaceId: workspace.id, plan };
}

export async function quickCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(quickCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { error } = await supabase.from("captures").insert({
      workspace_id: workspace.id,
      created_by: user.id,
      content: parsed.data.content,
      status: "inbox",
      source: "manual",
    });
    if (error) throw error;
    revalidatePath("/app/today");
    revalidatePath("/app/capture");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save that thought."));
  }
}

export async function setTaskDoneAction(
  input: unknown,
): Promise<ActionResult<{ status: string }>> {
  const parsed = parseInput(setTaskDoneSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const ctx = await loadPlan(p.planId);

    if (taskDoneRpcAvailable !== false) {
      const rpc = await ctx.supabase.rpc("today_set_task_done", {
        p_daily_plan_id: p.planId,
        p_task_id: p.taskId,
        p_done: p.done,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          taskDoneRpcAvailable = false;
        } else {
          return actionError("We couldn't update that task.");
        }
      } else {
        taskDoneRpcAvailable = true;
        revalidatePath("/app/today");
        return actionOk({ status: (rpc.data as { status: string }).status });
      }
    }

    // Sequential fallback.
    const { data: task, error: taskErr } = await ctx.supabase
      .from("tasks")
      .select("id, workspace_id, bucket")
      .eq("id", p.taskId)
      .maybeSingle();
    if (taskErr) throw taskErr;
    if (!task || task.workspace_id !== ctx.workspaceId) {
      return actionError("That task no longer exists.");
    }
    // Confirm the task is part of this plan.
    const { data: item } = await ctx.supabase
      .from("daily_plan_items")
      .select("id")
      .eq("daily_plan_id", p.planId)
      .eq("task_id", p.taskId)
      .maybeSingle();

    const nextStatus = p.done
      ? "completed"
      : task.bucket === "delegated"
        ? "waiting"
        : "open";

    const upd = await ctx.supabase
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", p.taskId)
      .eq("workspace_id", ctx.workspaceId);
    if (upd.error) throw upd.error;

    if (item) {
      await ctx.supabase
        .from("daily_plan_items")
        .update({ completed_at: p.done ? new Date().toISOString() : null })
        .eq("id", item.id);
    }

    revalidatePath("/app/today");
    return actionOk({ status: nextStatus });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that task."));
  }
}

export interface ResetResult {
  status: "reset" | "no_plan";
  deletedPlanItems: number;
  deletedSessionTasks: number;
  restoredCaptures: number;
  reopenedTasks: number;
  legacyUntracked: boolean;
}

export async function resetTodayAction(
  input: unknown,
): Promise<ActionResult<ResetResult>> {
  const parsed = parseInput(resetTodaySchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const reopen = parsed.data.reopenCompleted;

  try {
    const { user, profile, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    if (resetRpcAvailable !== false) {
      const rpc = await supabase.rpc("reset_current_daily_plan", {
        p_reopen_completed: reopen,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          resetRpcAvailable = false;
        } else {
          return actionError("We couldn't reset today.");
        }
      } else {
        resetRpcAvailable = true;
        const d = rpc.data as {
          status: "reset" | "no_plan";
          deleted_plan_items: number;
          deleted_session_tasks: number;
          restored_captures: number;
          reopened_tasks: number;
          legacy_untracked: boolean;
        };
        revalidatePath("/app/today");
        revalidatePath("/app/start");
        revalidatePath("/app/capture");
        return actionOk({
          status: d.status,
          deletedPlanItems: d.deleted_plan_items,
          deletedSessionTasks: d.deleted_session_tasks,
          restoredCaptures: d.restored_captures,
          reopenedTasks: d.reopened_tasks,
          legacyUntracked: d.legacy_untracked,
        });
      }
    }

    // --- Sequential fallback (guarded; RPC is the atomic path) -------------
    const planDate = localDateFor(profile.timezone);
    const plan = await getDailyPlan(workspace.id, user.id, planDate);
    if (!plan) {
      return actionOk({
        status: "no_plan",
        deletedPlanItems: 0,
        deletedSessionTasks: 0,
        restoredCaptures: 0,
        reopenedTasks: 0,
        legacyUntracked: false,
      });
    }

    const tracking = await sessionTrackingAvailable();

    // Rows + (legacy) status/bucket for reopening.
    const legacySelect = tracking
      ? "id, task_id, task:tasks(status, bucket, origin_daily_plan_id)"
      : "id, task_id, task:tasks(status, bucket)";
    const { data: itemRows } = await supabase
      .from("daily_plan_items")
      .select(legacySelect)
      .eq("daily_plan_id", plan.id)
      .returns<
        {
          id: string;
          task_id: string;
          task: {
            status: string;
            bucket: string;
            origin_daily_plan_id?: string | null;
          } | null;
        }[]
      >();
    const rows = itemRows ?? [];
    const trackedTasks = tracking
      ? rows.filter((r) => r.task?.origin_daily_plan_id === plan.id).length
      : 0;

    let reopenedTasks = 0;
    if (reopen) {
      for (const r of rows) {
        // Without tracking, every plan task is treated as pre-existing.
        const preexisting = !tracking
          ? true
          : r.task?.origin_daily_plan_id !== plan.id;
        if (r.task?.status === "completed" && preexisting) {
          await supabase
            .from("tasks")
            .update({
              status: r.task.bucket === "delegated" ? "waiting" : "open",
            })
            .eq("id", r.task_id)
            .eq("workspace_id", workspace.id);
          reopenedTasks += 1;
        }
      }
    }

    const delItems = await supabase
      .from("daily_plan_items")
      .delete()
      .eq("daily_plan_id", plan.id)
      .select("id");

    let deletedSessionTasks = 0;
    let restoredCaptures = 0;
    if (tracking) {
      const delTasks = await supabase
        .from("tasks")
        .delete()
        .eq("origin_daily_plan_id", plan.id)
        .eq("workspace_id", workspace.id)
        .select("id");
      deletedSessionTasks = delTasks.data?.length ?? 0;

      const restored = await supabase
        .from("captures")
        .update({
          status: "inbox",
          processed_at: null,
          processed_in_daily_plan_id: null,
        })
        .eq("processed_in_daily_plan_id", plan.id)
        .eq("workspace_id", workspace.id)
        .select("id");
      restoredCaptures = restored.data?.length ?? 0;
    }

    await supabase.from("daily_plans").delete().eq("id", plan.id);

    revalidatePath("/app/today");
    revalidatePath("/app/start");
    revalidatePath("/app/capture");
    return actionOk({
      status: "reset",
      deletedPlanItems: delItems.data?.length ?? 0,
      deletedSessionTasks,
      restoredCaptures,
      reopenedTasks,
      legacyUntracked:
        !tracking ||
        (rows.length > 0 && trackedTasks === 0 && restoredCaptures === 0),
    });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't reset today."));
  }
}

export async function completeDayAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(completeDaySchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadPlan(parsed.data.planId);
    if (ctx.plan.status !== "active") {
      return actionError("This plan isn't active.");
    }
    const { error } = await ctx.supabase
      .from("daily_plans")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", parsed.data.planId);
    if (error) throw error;
    revalidatePath("/app/today");
    revalidatePath("/app/start");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't complete today."));
  }
}
