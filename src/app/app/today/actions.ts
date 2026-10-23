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
import { getResetPreview, type ResetPreview } from "@/lib/data/today";
import {
  completeDaySchema,
  quickCaptureSchema,
  resetTodaySchema,
  setTaskDoneSchema,
} from "@/lib/validation/today";

const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);
let taskDoneRpcAvailable: boolean | null = null;

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

/**
 * Reset/Restart preview counts, fetched on demand when the caller opens
 * either dialog — not on page load. `getResetPreview` runs several extra
 * queries that only ever mattered for a dialog most visits never open, so
 * keeping it off the initial render of /app/start and /app/today measurably
 * speeds up every ordinary page switch.
 */
export async function getResetPreviewAction(
  input: unknown,
): Promise<ActionResult<ResetPreview>> {
  const parsed = parseInput(completeDaySchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspaceId, plan } = await loadPlan(parsed.data.planId);
    const preview = await getResetPreview(workspaceId, plan);
    return actionOk(preview);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't load those counts."));
  }
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

    const { data: task, error: taskErr } = await ctx.supabase
      .from("tasks")
      .select("id, workspace_id, bucket")
      .eq("id", p.taskId)
      .maybeSingle();
    if (taskErr) throw taskErr;
    if (!task || task.workspace_id !== ctx.workspaceId) {
      return actionError("That task no longer exists.");
    }
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

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const rpc = await supabase.rpc("reset_workspace_daily_plan", {
      p_workspace_id: workspace.id,
      p_reopen_completed: parsed.data.reopenCompleted,
    });
    if (rpc.error) {
      if (rpc.error.message === "workspace_required") {
        return actionError(
          "Choose a workspace before resetting a day with multiple workspaces.",
        );
      }
      if (RPC_MISSING.has(rpc.error.code ?? "")) {
        return actionError(
          "Reset Today is unavailable until the integrity migration is applied.",
        );
      }
      return actionError("We couldn't reset today.");
    }

    const result = rpc.data as {
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
      status: result.status,
      deletedPlanItems: result.deleted_plan_items,
      deletedSessionTasks: result.deleted_session_tasks,
      restoredCaptures: result.restored_captures,
      reopenedTasks: result.reopened_tasks,
      legacyUntracked: result.legacy_untracked,
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
