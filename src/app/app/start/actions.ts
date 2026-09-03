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
import type { Database, DailyPlan, Task } from "@/lib/types/database.types";
import {
  captureSessionFields,
  taskOriginFields,
} from "@/lib/data/session-tracking";
import {
  addTaskToPlanSchema,
  batchDecisionSchema,
  batchUndoDecisionSchema,
  captureIdPlanSchema,
  createPlanTaskSchema,
  editCaptureSchema,
  linkFocusSchema,
  planIdSchema,
  planItemSchema,
  rescheduleTaskSchema,
  reorderPlanItemSchema,
  reorderPlanItemsSchema,
  restartPlanningSchema,
  taskIdSchema,
  toggleTopThreeSchema,
  updatePlanTaskSchema,
} from "@/lib/validation/start-day";

type Db = SupabaseClient<Database>;

// --- shared authorization -------------------------------------------------

interface PlanContext {
  supabase: Db;
  userId: string;
  workspaceId: string;
  plan: DailyPlan;
}

async function loadOwnedPlan(planId: string): Promise<PlanContext> {
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

function friendlyDbError(error: {
  code?: string;
  message?: string;
}): string {
  switch (error.code) {
    case "P0001":
      return error.message ?? "That thought has already been handled.";
    case "23505":
      return "That thought was already turned into a task.";
    case "42501":
      return "You don't have access to do that.";
    case "22023":
      return error.message ?? "Some details are missing or invalid.";
    case "23514":
      return "Some details are missing or invalid.";
    default:
      return "Something went wrong. Please try again.";
  }
}

const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);
let undoRpcAvailable: boolean | null = null;
let reorderRpcAvailable: boolean | null = null;
let processCapturesRpcAvailable: boolean | null = null;
let undoCapturesRpcAvailable: boolean | null = null;

// --- Stage 1: capture review (undo of a single decision) --------------

export async function undoDiscardAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(captureIdPlanSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    const { error } = await ctx.supabase
      .from("captures")
      .update({ status: "inbox", ...(await captureSessionFields(null)) })
      .eq("id", parsed.data.captureId)
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "discarded");
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't undo that."));
  }
}

export async function undoDecisionAction(
  input: unknown,
): Promise<ActionResult<{ status: "ok" | "needs_confirmation" }>> {
  const parsed = parseInput(captureIdPlanSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const ctx = await loadOwnedPlan(p.planId);

    if (undoRpcAvailable !== false) {
      const rpc = await ctx.supabase.rpc("start_my_day_undo_capture", {
        p_capture_id: p.captureId,
        p_daily_plan_id: p.planId,
        p_force: p.force ?? false,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          undoRpcAvailable = false;
        } else {
          return actionError(friendlyDbError(rpc.error));
        }
      } else {
        undoRpcAvailable = true;
        const status = (rpc.data as { status: "ok" | "needs_confirmation" })
          .status;
        revalidatePath("/app/start");
        return actionOk({ status });
      }
    }

    const status = await undoDecisionSequential(ctx, p);
    revalidatePath("/app/start");
    return actionOk({ status });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendlyDbError({ code }));
    return actionError(toMessage(error, "We couldn't undo that decision."));
  }
}

async function undoDecisionSequential(
  ctx: PlanContext,
  p: { captureId: string; force?: boolean },
): Promise<"ok" | "needs_confirmation"> {
  const { supabase, plan } = ctx;

  const { data: capture } = await supabase
    .from("captures")
    .select("id, workspace_id, status, content")
    .eq("id", p.captureId)
    .maybeSingle();
  if (!capture || capture.workspace_id !== plan.workspace_id) {
    throw new Error("We couldn't find that thought.");
  }
  if (capture.status !== "processed") {
    throw new Error("That thought can no longer be undone.");
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, title, created_at, updated_at")
    .eq("source_capture_id", capture.id)
    .eq("workspace_id", plan.workspace_id)
    .maybeSingle();

  if (task && !p.force) {
    const edited =
      task.status === "completed" ||
      task.status === "cancelled" ||
      task.title !== capture.content ||
      new Date(task.updated_at).getTime() >
        new Date(task.created_at).getTime() + 3000;
    if (edited) return "needs_confirmation";
  }

  if (task) {
    await supabase.from("daily_plan_items").delete().eq("task_id", task.id);
    await supabase.from("tasks").delete().eq("id", task.id);
  }
  await supabase
    .from("captures")
    .update({ status: "inbox", ...(await captureSessionFields(null)) })
    .eq("id", capture.id);
  return "ok";
}

export async function editReviewCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(editCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("captures")
      .update({
        content: parsed.data.content,
        notes: parsed.data.notes ?? null,
      })
      .eq("id", parsed.data.captureId)
      .eq("workspace_id", workspace.id)
      .eq("status", "inbox");
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save that edit."));
  }
}

// --- Shared decision layer (One at a time AND Batch organize) --------
//
// Both modes submit an array of capture ids + one decision. The array has
// length 1 for "One at a time" and length N for "Batch organize". Identical
// validation, database rules, tracking fields and result shape.

export interface ProcessCapturesResult {
  decision: string;
  processed: number;
  skipped: number;
  inPlan: number;
  taskIds: string[];
  captureIds: string[];
}

export async function processCapturesAction(
  input: unknown,
): Promise<ActionResult<ProcessCapturesResult>> {
  const parsed = parseInput(batchDecisionSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;
  const ids = [...new Set(p.captureIds)];
  if (ids.length !== p.captureIds.length) {
    return actionError("That selection had a repeated thought.");
  }

  let ctx: PlanContext;
  try {
    ctx = await loadOwnedPlan(p.planId);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't verify your plan."));
  }
  if (ctx.plan.status !== "draft") {
    return actionError("Your day is already planned. Reopen it to make changes.");
  }

  try {
    if (processCapturesRpcAvailable !== false) {
      const rpc = await ctx.supabase.rpc("start_my_day_process_captures", {
        p_daily_plan_id: p.planId,
        p_capture_ids: ids,
        p_decision: p.decision,
        p_scheduled_for: p.scheduledFor ?? null,
        p_due_at: p.dueAt ?? null,
        p_notes: p.notes ?? null,
        p_focus_item_id: p.focusItemId ?? null,
        p_delegate_name: p.delegateName ?? null,
        p_delegate_email: p.delegateEmail ?? null,
        p_add_to_today: p.addToToday ?? false,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          processCapturesRpcAvailable = false;
        } else {
          return actionError(friendlyDbError(rpc.error));
        }
      } else {
        processCapturesRpcAvailable = true;
        const d = rpc.data as {
          decision: string;
          processed: number;
          skipped: number;
          in_plan: number;
          task_ids: string[];
        };
        revalidatePath("/app/start");
        revalidatePath("/app/today");
        return actionOk({
          decision: d.decision,
          processed: d.processed,
          skipped: d.skipped,
          inPlan: d.in_plan,
          taskIds: d.task_ids ?? [],
          captureIds: ids,
        });
      }
    }

    const result = await processCapturesSequential(ctx, p, ids);
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(result);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return actionError(friendlyDbError({ code }));
    return actionError(toMessage(error, "We couldn't save that decision."));
  }
}

async function processCapturesSequential(
  ctx: PlanContext,
  p: import("@/lib/validation/start-day").BatchDecisionInput,
  ids: string[],
): Promise<ProcessCapturesResult> {
  const { supabase, userId, workspaceId, plan } = ctx;

  if (p.decision === "schedule" && !p.scheduledFor) {
    throw new Error("Choose a date to schedule these for.");
  }
  if (p.decision === "delegate" && !p.delegateName?.trim()) {
    throw new Error("Who are you handing these to?");
  }
  if (p.focusItemId) {
    const { data: focus } = await supabase
      .from("focus_items")
      .select("id")
      .eq("id", p.focusItemId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!focus) throw new Error("That focus item no longer exists.");
  }

  const { data: rows, error } = await supabase
    .from("captures")
    .select("id, workspace_id, status, content, notes, category_id")
    .in("id", ids);
  if (error) throw error;
  for (const cap of rows ?? []) {
    if (cap.workspace_id !== workspaceId) {
      throw new Error("A selected thought belongs to another workspace.");
    }
  }

  let bucket: Task["bucket"] = "someday";
  let status: Task["status"] = "open";
  let scheduledFor: string | null = null;
  let includeInPlan = false;
  if (p.decision === "do_now") {
    bucket = "today";
    status = "open";
    scheduledFor = plan.plan_date;
    includeInPlan = true;
  } else if (p.decision === "schedule") {
    bucket = "scheduled";
    status = "open";
    scheduledFor = p.scheduledFor ?? null;
    includeInPlan =
      p.scheduledFor === plan.plan_date && Boolean(p.addToToday);
  } else if (p.decision === "delegate") {
    bucket = "delegated";
    status = "waiting";
  }

  let processed = 0;
  let skipped = 0;
  let inPlan = 0;
  const taskIds: string[] = [];
  const affected: string[] = [];

  for (const cap of rows ?? []) {
    if (cap.status !== "inbox") {
      skipped += 1;
      continue;
    }

    if (p.decision === "discard") {
      const { data: marked } = await supabase
        .from("captures")
        .update({
          status: "discarded",
          ...(await captureSessionFields(plan.id)),
        })
        .eq("id", cap.id)
        .eq("status", "inbox")
        .select("id");
      if (marked && marked.length > 0) {
        processed += 1;
        affected.push(cap.id);
      } else {
        skipped += 1;
      }
      continue;
    }

    const insert = await supabase
      .from("tasks")
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        source_capture_id: cap.id,
        ...(await taskOriginFields(plan.id)),
        focus_item_id: p.focusItemId ?? null,
        category_id: cap.category_id,
        title: cap.content,
        notes: p.notes ?? cap.notes,
        status,
        bucket,
        priority: 2,
        scheduled_for: scheduledFor,
        due_at: p.dueAt ?? null,
        delegate_name:
          p.decision === "delegate" ? p.delegateName?.trim() ?? null : null,
        delegate_email:
          p.decision === "delegate" ? p.delegateEmail ?? null : null,
        delegated_at:
          p.decision === "delegate" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (insert.error) {
      if (insert.error.code === "23505") {
        await supabase
          .from("captures")
          .update({
            status: "processed",
            ...(await captureSessionFields(plan.id)),
          })
          .eq("id", cap.id)
          .eq("status", "inbox");
        skipped += 1;
        continue;
      }
      throw insert.error;
    }

    const taskId = insert.data.id;

    if (includeInPlan) {
      const { data: last } = await supabase
        .from("daily_plan_items")
        .select("sort_order")
        .eq("daily_plan_id", plan.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const link = await supabase.from("daily_plan_items").upsert(
        {
          daily_plan_id: plan.id,
          task_id: taskId,
          sort_order: (last?.sort_order ?? 0) + 10,
          is_top_three: false,
        },
        { onConflict: "daily_plan_id,task_id", ignoreDuplicates: true },
      );
      if (!link.error) inPlan += 1;
    }

    const marked = await supabase
      .from("captures")
      .update({
        status: "processed",
        ...(await captureSessionFields(plan.id)),
      })
      .eq("id", cap.id)
      .eq("status", "inbox")
      .select("id");
    if (!marked.data || marked.data.length === 0) {
      await supabase.from("daily_plan_items").delete().eq("task_id", taskId);
      await supabase.from("tasks").delete().eq("id", taskId);
      skipped += 1;
      continue;
    }

    processed += 1;
    taskIds.push(taskId);
    affected.push(cap.id);
  }

  return {
    decision: p.decision,
    processed,
    skipped,
    inPlan,
    taskIds,
    captureIds: affected,
  };
}

export async function undoCapturesAction(
  input: unknown,
): Promise<ActionResult<{ restored: number; kept: number }>> {
  const parsed = parseInput(batchUndoDecisionSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;
  const ids = [...new Set(p.captureIds)];

  try {
    const ctx = await loadOwnedPlan(p.planId);

    if (undoCapturesRpcAvailable !== false) {
      const rpc = await ctx.supabase.rpc("start_my_day_undo_captures", {
        p_daily_plan_id: p.planId,
        p_capture_ids: ids,
        p_decision: p.decision,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          undoCapturesRpcAvailable = false;
        } else {
          return actionError(friendlyDbError(rpc.error));
        }
      } else {
        undoCapturesRpcAvailable = true;
        revalidatePath("/app/start");
        revalidatePath("/app/today");
        return actionOk(rpc.data as { restored: number; kept: number });
      }
    }

    let restored = 0;
    let kept = 0;
    if (p.decision === "discard") {
      const { data } = await ctx.supabase
        .from("captures")
        .update({ status: "inbox", ...(await captureSessionFields(null)) })
        .in("id", ids)
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "discarded")
        .select("id");
      restored = data?.length ?? 0;
    } else {
      const { data: tasks } = await ctx.supabase
        .from("tasks")
        .select(
          "id, status, bucket, title, created_at, updated_at, source_capture_id",
        )
        .in("source_capture_id", ids)
        .eq("workspace_id", ctx.workspaceId);
      const { data: caps } = await ctx.supabase
        .from("captures")
        .select("id, content, status")
        .in("id", ids)
        .eq("workspace_id", ctx.workspaceId);
      const capById = new Map((caps ?? []).map((c) => [c.id, c]));
      for (const task of tasks ?? []) {
        const cap = capById.get(task.source_capture_id ?? "");
        const edited =
          task.status === "completed" ||
          task.status === "cancelled" ||
          (cap ? task.title !== cap.content : true) ||
          new Date(task.updated_at).getTime() >
            new Date(task.created_at).getTime() + 3000;
        if (edited) {
          kept += 1;
          continue;
        }
        await ctx.supabase
          .from("daily_plan_items")
          .delete()
          .eq("task_id", task.id);
        await ctx.supabase.from("tasks").delete().eq("id", task.id);
        if (cap && cap.status === "processed") {
          await ctx.supabase
            .from("captures")
            .update({ status: "inbox", ...(await captureSessionFields(null)) })
            .eq("id", cap.id);
          restored += 1;
        }
      }
    }
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk({ restored, kept });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't undo that."));
  }
}


// --- Workflow step transitions ----------------------------------------

async function setWorkflowStep(
  planId: string,
  step: Database["public"]["Enums"]["daily_workflow_step"],
): Promise<ActionResult<null>> {
  try {
    const ctx = await loadOwnedPlan(planId);
    if (ctx.plan.status === "active") {
      return actionError("Your day is already started.");
    }
    const { error } = await ctx.supabase
      .from("daily_plans")
      .update({ workflow_step: step })
      .eq("id", planId);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't move to the next step."));
  }
}

export async function goToShapeDayAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  return setWorkflowStep(parsed.data.planId, "prioritize");
}

export async function goToReadyAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    if (ctx.plan.status === "active") {
      return actionError("Your day is already started.");
    }
    const { data: items, error } = await ctx.supabase
      .from("daily_plan_items")
      .select("id, task_id, is_top_three, task:tasks(workspace_id)")
      .eq("daily_plan_id", parsed.data.planId)
      .returns<
        {
          id: string;
          task_id: string;
          is_top_three: boolean;
          task: { workspace_id: string } | null;
        }[]
      >();
    if (error) throw error;

    const topThree = (items ?? []).filter((i) => i.is_top_three).length;
    if (topThree > 3) {
      return actionError("You can choose at most three top priorities.");
    }
    const taskIds = new Set<string>();
    for (const item of items ?? []) {
      if (item.task && item.task.workspace_id !== ctx.workspaceId) {
        return actionError("This plan has a task from another workspace.");
      }
      if (taskIds.has(item.task_id)) {
        return actionError("This plan has a task listed twice.");
      }
      taskIds.add(item.task_id);
    }

    const upd = await ctx.supabase
      .from("daily_plans")
      .update({ workflow_step: "ready" })
      .eq("id", parsed.data.planId);
    if (upd.error) throw upd.error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't open your review."));
  }
}

export async function backToStepAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const raw = input as { step?: string };
  const step =
    raw.step === "capture_review" ? "capture_review" : "prioritize";
  return setWorkflowStep(parsed.data.planId, step);
}

export async function startDayAction(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    if (ctx.plan.status === "active") {
      return actionOk({ redirectTo: "/app/today" });
    }
    if (ctx.plan.workflow_step !== "ready") {
      return actionError("Finish reviewing your plan first.");
    }
    const { error } = await ctx.supabase
      .from("daily_plans")
      .update({
        status: "active",
        workflow_step: "ready",
        started_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.planId);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk({ redirectTo: "/app/today" });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't start your day."));
  }
}

/**
 * "Restart planning" — non-destructive. Keeps every capture, task and plan
 * item, but returns the workflow to Step 1 (capture_review) and the plan to
 * `draft` so the user can re-run the flow. Optionally clears the current Top 3
 * and/or reopens tasks completed inside this plan.
 */
export async function restartPlanningAction(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parseInput(restartPlanningSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const { planId, clearTopThree, reopenCompleted } = parsed.data;

  try {
    const ctx = await loadOwnedPlan(planId);

    if (clearTopThree) {
      const { error } = await ctx.supabase
        .from("daily_plan_items")
        .update({ is_top_three: false })
        .eq("daily_plan_id", planId)
        .eq("is_top_three", true);
      if (error) throw error;
    }

    if (reopenCompleted) {
      const { data: items } = await ctx.supabase
        .from("daily_plan_items")
        .select("id, task:tasks(id, status, bucket)")
        .eq("daily_plan_id", planId)
        .returns<
          {
            id: string;
            task: { id: string; status: string; bucket: string } | null;
          }[]
        >();
      for (const item of items ?? []) {
        if (item.task?.status === "completed") {
          await ctx.supabase
            .from("tasks")
            .update({
              status: item.task.bucket === "delegated" ? "waiting" : "open",
            })
            .eq("id", item.task.id)
            .eq("workspace_id", ctx.workspaceId);
          await ctx.supabase
            .from("daily_plan_items")
            .update({ completed_at: null })
            .eq("id", item.id);
        }
      }
    }

    const { error } = await ctx.supabase
      .from("daily_plans")
      .update({ status: "draft", workflow_step: "capture_review" })
      .eq("id", planId);
    if (error) throw error;

    revalidatePath("/app/start");
    revalidatePath("/app/today");
    revalidatePath("/app/capture");
    return actionOk({ redirectTo: "/app/start" });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't restart planning."));
  }
}

export async function adjustPlanAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    // An active plan stays active — adjustment mode never restarts the day or
    // resets started_at. A draft plan just re-opens at the prioritize step.
    const update =
      ctx.plan.status === "active"
        ? { workflow_step: "prioritize" as const }
        : { status: "draft" as const, workflow_step: "prioritize" as const };
    const { error } = await ctx.supabase
      .from("daily_plans")
      .update(update)
      .eq("id", parsed.data.planId);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't reopen your plan."));
  }
}

/**
 * Finish adjustment mode for an already-active plan: return the workflow to
 * "ready" and send the user back to Today. Never touches status or started_at.
 */
export async function finishAdjustAction(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parseInput(planIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    if (ctx.plan.status !== "active") {
      return actionError("This plan isn't active.");
    }
    const items = await ctx.supabase
      .from("daily_plan_items")
      .select("id, task_id, is_top_three, task:tasks(workspace_id)")
      .eq("daily_plan_id", parsed.data.planId)
      .returns<
        {
          id: string;
          task_id: string;
          is_top_three: boolean;
          task: { workspace_id: string } | null;
        }[]
      >();
    if (items.error) throw items.error;
    const rows = items.data ?? [];
    if (rows.filter((i) => i.is_top_three).length > 3) {
      return actionError("You can choose at most three top priorities.");
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.task && row.task.workspace_id !== ctx.workspaceId) {
        return actionError("This plan has a task from another workspace.");
      }
      if (seen.has(row.task_id)) {
        return actionError("This plan has a task listed twice.");
      }
      seen.add(row.task_id);
    }
    const { error } = await ctx.supabase
      .from("daily_plans")
      .update({ workflow_step: "ready" })
      .eq("id", parsed.data.planId);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk({ redirectTo: "/app/today" });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save your changes."));
  }
}

// --- Stage 2: shape the day -------------------------------------------

async function assertTaskInWorkspace(
  supabase: Db,
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const { data } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new Error("That task no longer exists.");
}

export async function addTaskToPlanAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(addTaskToPlanSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const ctx = await loadOwnedPlan(parsed.data.planId);
    await assertTaskInWorkspace(ctx.supabase, parsed.data.taskId, ctx.workspaceId);
    const { data: last } = await ctx.supabase
      .from("daily_plan_items")
      .select("sort_order")
      .eq("daily_plan_id", parsed.data.planId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await ctx.supabase.from("daily_plan_items").upsert(
      {
        daily_plan_id: parsed.data.planId,
        task_id: parsed.data.taskId,
        sort_order: (last?.sort_order ?? 0) + 10,
        is_top_three: false,
      },
      { onConflict: "daily_plan_id,task_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't add that to today."));
  }
}

export async function createPlanTaskAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(createPlanTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const p = parsed.data;

  try {
    const ctx = await loadOwnedPlan(p.planId);
    if (p.focusItemId) {
      const { data: focus } = await ctx.supabase
        .from("focus_items")
        .select("id")
        .eq("id", p.focusItemId)
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();
      if (!focus) return actionError("That focus item no longer exists.");
    }
    const { data: task, error } = await ctx.supabase
      .from("tasks")
      .insert({
        workspace_id: ctx.workspaceId,
        created_by: ctx.userId,
        ...(await taskOriginFields(p.planId)),
        title: p.title,
        notes: p.notes ?? null,
        focus_item_id: p.focusItemId ?? null,
        category_id: p.categoryId ?? null,
        status: "open",
        bucket: "today",
        priority: 2,
        scheduled_for: ctx.plan.plan_date,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: last } = await ctx.supabase
      .from("daily_plan_items")
      .select("sort_order")
      .eq("daily_plan_id", p.planId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const link = await ctx.supabase.from("daily_plan_items").insert({
      daily_plan_id: p.planId,
      task_id: task.id,
      sort_order: (last?.sort_order ?? 0) + 10,
      is_top_three: false,
    });
    if (link.error) throw link.error;

    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't add that task."));
  }
}

async function loadPlanItem(
  planItemId: string,
): Promise<PlanContext & { itemId: string; taskId: string }> {
  const { user, workspace } = await requireWorkspaceContext();
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("daily_plan_items")
    .select("id, task_id, daily_plan_id")
    .eq("id", planItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item) {
    throw new Error("We couldn't find that plan item for your account.");
  }
  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("id", item.daily_plan_id)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan || plan.user_id !== user.id || plan.workspace_id !== workspace.id) {
    throw new Error("We couldn't find that plan item for your account.");
  }
  return {
    supabase,
    userId: user.id,
    workspaceId: workspace.id,
    plan,
    itemId: item.id,
    taskId: item.task_id,
  };
}

export async function removeFromPlanAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(planItemSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const ctx = await loadPlanItem(parsed.data.planItemId);
    const { error } = await ctx.supabase
      .from("daily_plan_items")
      .delete()
      .eq("id", ctx.itemId);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't remove that."));
  }
}

export async function toggleTopThreeAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(toggleTopThreeSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const ctx = await loadPlanItem(parsed.data.planItemId);
    if (parsed.data.value) {
      const { count } = await ctx.supabase
        .from("daily_plan_items")
        .select("id", { count: "exact", head: true })
        .eq("daily_plan_id", ctx.plan.id)
        .eq("is_top_three", true)
        .neq("id", ctx.itemId);
      if ((count ?? 0) >= 3) {
        return actionError(
          "You can choose up to three top priorities. Unpick one first.",
        );
      }
    }
    const { error } = await ctx.supabase
      .from("daily_plan_items")
      .update({ is_top_three: parsed.data.value })
      .eq("id", ctx.itemId);
    if (error) {
      if (error.code === "P0001") {
        return actionError("You can choose up to three top priorities.");
      }
      throw error;
    }
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update priorities."));
  }
}

export async function reorderPlanItemAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(reorderPlanItemSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const ctx = await loadPlanItem(parsed.data.planItemId);
    const { data: siblings, error } = await ctx.supabase
      .from("daily_plan_items")
      .select("id, sort_order")
      .eq("daily_plan_id", ctx.plan.id)
      .order("sort_order", { ascending: true });
    if (error) throw error;

    const list = siblings ?? [];
    const index = list.findIndex((s) => s.id === ctx.itemId);
    const swapWith =
      parsed.data.direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) {
      return actionOk(null);
    }
    const a = list[index];
    const b = list[swapWith];
    const [r1, r2] = await Promise.all([
      ctx.supabase
        .from("daily_plan_items")
        .update({ sort_order: b.sort_order })
        .eq("id", a.id),
      ctx.supabase
        .from("daily_plan_items")
        .update({ sort_order: a.sort_order })
        .eq("id", b.id),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't reorder that."));
  }
}

/**
 * Batch reorder: the client sends the full ordered list of plan-item ids once,
 * on drop. Prefers the transactional RPC; falls back to per-row sort_order
 * writes guarded by an ownership check on the plan.
 */
export async function reorderPlanItemsAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(reorderPlanItemsSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const { planId, itemIds } = parsed.data;
  const ids = [...new Set(itemIds)];
  if (ids.length !== itemIds.length) {
    return actionError("That reorder had a repeated item.");
  }

  try {
    const ctx = await loadOwnedPlan(planId);

    if (reorderRpcAvailable !== false) {
      const rpc = await ctx.supabase.rpc("reorder_daily_plan_items", {
        p_daily_plan_id: planId,
        p_item_ids: ids,
      });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          reorderRpcAvailable = false;
        } else {
          return actionError(friendlyDbError(rpc.error));
        }
      } else {
        reorderRpcAvailable = true;
        return actionOk(null);
      }
    }

    // Fallback: verify the id set matches the plan, then write sort_order.
    const { data: rows, error } = await ctx.supabase
      .from("daily_plan_items")
      .select("id")
      .eq("daily_plan_id", planId);
    if (error) throw error;
    const owned = new Set((rows ?? []).map((r) => r.id));
    if (owned.size !== ids.length || ids.some((id) => !owned.has(id))) {
      return actionError("That plan changed. Reload and try again.");
    }
    const results = await Promise.all(
      ids.map((id, index) =>
        ctx.supabase
          .from("daily_plan_items")
          .update({ sort_order: (index + 1) * 10 })
          .eq("id", id)
          .eq("daily_plan_id", planId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save the new order."));
  }
}

export async function updatePlanTaskAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updatePlanTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
      })
      .eq("id", parsed.data.taskId)
      .eq("workspace_id", workspace.id);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save that task."));
  }
}

export async function linkFocusAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(linkFocusSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    if (parsed.data.focusItemId) {
      const { data: focus } = await supabase
        .from("focus_items")
        .select("id")
        .eq("id", parsed.data.focusItemId)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (!focus) return actionError("That focus item no longer exists.");
    }
    const { error } = await supabase
      .from("tasks")
      .update({ focus_item_id: parsed.data.focusItemId ?? null })
      .eq("id", parsed.data.taskId)
      .eq("workspace_id", workspace.id);
    if (error) throw error;
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update the focus link."));
  }
}

export async function rescheduleTaskAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(rescheduleTaskSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        bucket: "scheduled",
        scheduled_for: parsed.data.scheduledFor,
      })
      .eq("id", parsed.data.taskId)
      .eq("workspace_id", workspace.id);
    if (error) throw error;
    // Drop it from any of this user's plans whose date it no longer matches.
    const { data: plans } = await supabase
      .from("daily_plans")
      .select("id, plan_date")
      .eq("user_id", user.id)
      .eq("workspace_id", workspace.id)
      .neq("plan_date", parsed.data.scheduledFor);
    for (const plan of plans ?? []) {
      await supabase
        .from("daily_plan_items")
        .delete()
        .eq("daily_plan_id", plan.id)
        .eq("task_id", parsed.data.taskId);
    }
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't reschedule that."));
  }
}

export async function moveTaskToLaterAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(taskIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ bucket: "someday", scheduled_for: null, status: "open" })
      .eq("id", parsed.data.taskId)
      .eq("workspace_id", workspace.id);
    if (error) throw error;
    const { data: plans } = await supabase
      .from("daily_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("workspace_id", workspace.id);
    for (const plan of plans ?? []) {
      await supabase
        .from("daily_plan_items")
        .delete()
        .eq("daily_plan_id", plan.id)
        .eq("task_id", parsed.data.taskId);
    }
    revalidatePath("/app/start");
    revalidatePath("/app/today");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't move that to later."));
  }
}
