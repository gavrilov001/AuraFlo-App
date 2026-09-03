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
import type { Capture } from "@/lib/types/database.types";
import {
  archiveCaptureSchema,
  copyToInboxSchema,
  createCaptureSchema,
  deleteCaptureSchema,
  deleteCapturesBulkSchema,
  discardCaptureSchema,
  restoreCaptureSchema,
  updateCaptureSchema,
} from "@/lib/validation/captures";

const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);
let restoreRpcAvailable: boolean | null = null;

async function verifyCategoryInWorkspace(
  categoryId: string,
  workspaceId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function revalidate() {
  revalidatePath("/app/capture");
  revalidatePath("/app/start");
  revalidatePath("/app/today");
}

// --- create / edit -----------------------------------------------------

export async function createCaptureAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(createCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const categoryId = parsed.data.categoryId ?? null;
    if (
      categoryId &&
      !(await verifyCategoryInWorkspace(categoryId, workspace.id))
    ) {
      return actionError("That category isn't in your workspace.");
    }

    const { data, error } = await supabase
      .from("captures")
      .insert({
        workspace_id: workspace.id,
        created_by: user.id,
        content: parsed.data.content,
        category_id: categoryId,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidate();
    return actionOk({ id: data.id });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save that capture."));
  }
}

export async function updateCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updateCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const categoryId = parsed.data.categoryId ?? null;
    if (
      categoryId &&
      !(await verifyCategoryInWorkspace(categoryId, workspace.id))
    ) {
      return actionError("That category isn't in your workspace.");
    }

    // Content edits are only allowed while the thought is still inbox/processed
    // history — never rewrite an archived or discarded record's content.
    const { data, error } = await supabase
      .from("captures")
      .update({
        content: parsed.data.content,
        notes: parsed.data.notes ?? null,
        category_id: categoryId,
      })
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id)
      .in("status", ["inbox", "processed"])
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return actionError("That thought can no longer be edited.");
    }

    revalidate();
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that capture."));
  }
}

// --- lifecycle: archive / discard ------------------------------------

async function setStatusGuarded(
  id: string,
  next: "archived" | "discarded",
  allowedFrom: Capture["status"][],
  notThere: string,
): Promise<ActionResult<null>> {
  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("captures")
      .update({ status: next })
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .in("status", allowedFrom)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return actionError(notThere);
    revalidate();
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't move that thought."));
  }
}

export async function archiveCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(archiveCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  return setStatusGuarded(
    parsed.data.id,
    "archived",
    ["inbox", "processed", "discarded"],
    "That thought can't be archived right now.",
  );
}

export async function discardCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(discardCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  return setStatusGuarded(
    parsed.data.id,
    "discarded",
    ["inbox"],
    "Only inbox thoughts can be discarded.",
  );
}

// --- lifecycle: restore (server decides target) --------------------

export async function restoreCaptureAction(
  input: unknown,
): Promise<ActionResult<{ status: string; hasTask: boolean }>> {
  const parsed = parseInput(restoreCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error);
  const id = parsed.data.id;

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    if (restoreRpcAvailable !== false) {
      const rpc = await supabase.rpc("capture_restore", { p_capture_id: id });
      if (rpc.error) {
        if (RPC_MISSING.has(rpc.error.code ?? "")) {
          restoreRpcAvailable = false;
        } else if (rpc.error.message === "discarded_has_task") {
          return actionError(
            "This discarded thought is linked to a task and can't be restored automatically. Its data is safe.",
          );
        } else if (rpc.error.code === "P0001") {
          return actionError(
            "Only archived or discarded thoughts can be restored.",
          );
        } else {
          return actionError("We couldn't restore that thought.");
        }
      } else {
        restoreRpcAvailable = true;
        const d = rpc.data as { status: string; has_task: boolean };
        revalidate();
        return actionOk({ status: d.status, hasTask: d.has_task });
      }
    }

    // Fallback: read the capture + its linked task, then a status-guarded write.
    const { data: cap } = await supabase
      .from("captures")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!cap) return actionError("We couldn't find that thought.");
    if (cap.status !== "archived" && cap.status !== "discarded") {
      return actionError("Only archived or discarded thoughts can be restored.");
    }
    const { data: task } = await supabase
      .from("tasks")
      .select("id")
      .eq("source_capture_id", id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (cap.status === "discarded" && task) {
      return actionError(
        "This discarded thought is linked to a task and can't be restored automatically. Its data is safe.",
      );
    }
    const next = task ? "processed" : "inbox";
    const { data: upd, error } = await supabase
      .from("captures")
      .update({ status: next })
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .in("status", ["archived", "discarded"])
      .select("id");
    if (error) throw error;
    if (!upd || upd.length === 0) {
      return actionError("That thought's state changed. Reload and try again.");
    }
    revalidate();
    return actionOk({ status: next, hasTask: Boolean(task) });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't restore that thought."));
  }
}

// --- copy processed content into a fresh inbox thought ------------

export async function copyCaptureToInboxAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(copyToInboxSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { data: source } = await supabase
      .from("captures")
      .select("content, category_id")
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!source) return actionError("We couldn't find that thought.");

    // Keep the category only if it still exists in the workspace.
    let categoryId: string | null = null;
    if (source.category_id) {
      const { data: cat } = await supabase
        .from("categories")
        .select("id")
        .eq("id", source.category_id)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      categoryId = cat ? source.category_id : null;
    }

    const { data, error } = await supabase
      .from("captures")
      .insert({
        workspace_id: workspace.id,
        created_by: user.id,
        content: source.content,
        category_id: categoryId,
        source: "manual",
        // id, captured_at, status default fresh on the database.
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidate();
    return actionOk({ id: data.id });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't copy that thought."));
  }
}

// --- permanent deletion (archived / discarded only) --------------

export async function deleteCaptureAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(deleteCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("captures")
      .delete()
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id)
      .in("status", ["archived", "discarded"])
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return actionError(
        "Only archived or discarded thoughts can be permanently deleted.",
      );
    }
    revalidate();
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't delete that thought."));
  }
}

export async function deleteCapturesBulkAction(
  input: unknown,
): Promise<ActionResult<{ deleted: number }>> {
  const parsed = parseInput(deleteCapturesBulkSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);
  const ids = [...new Set(parsed.data.ids)];

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("captures")
      .delete()
      .in("id", ids)
      .eq("workspace_id", workspace.id)
      .in("status", ["archived", "discarded"])
      .select("id");
    if (error) throw error;
    revalidate();
    return actionOk({ deleted: data?.length ?? 0 });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't delete those thoughts."));
  }
}
