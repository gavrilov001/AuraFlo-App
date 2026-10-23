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
import {
  createCaptureSchema,
  setCaptureStatusSchema,
  updateCaptureSchema,
} from "@/lib/validation/captures";

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

export async function createCaptureAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(createCaptureSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const categoryId = parsed.data.categoryId ?? null;
    if (categoryId && !(await verifyCategoryInWorkspace(categoryId, workspace.id))) {
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
        // status defaults to 'inbox' via the database.
      })
      .select("id")
      .single();

    if (error) throw error;

    revalidatePath("/app/capture");
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
    if (categoryId && !(await verifyCategoryInWorkspace(categoryId, workspace.id))) {
      return actionError("That category isn't in your workspace.");
    }

    const { error } = await supabase
      .from("captures")
      .update({
        content: parsed.data.content,
        notes: parsed.data.notes ?? null,
        category_id: categoryId,
      })
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id);

    if (error) throw error;

    revalidatePath("/app/capture");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that capture."));
  }
}

export async function setCaptureStatusAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(setCaptureStatusSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { error } = await supabase
      .from("captures")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id);

    if (error) throw error;

    revalidatePath("/app/capture");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that capture."));
  }
}
