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
  createFocusItemSchema,
  reorderFocusItemSchema,
  setFocusStatusSchema,
  updateFocusItemSchema,
} from "@/lib/validation/focus";

export async function createFocusItemAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(createFocusItemSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { user, workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { data: last, error: lastError } = await supabase
      .from("focus_items")
      .select("sort_order")
      .eq("workspace_id", workspace.id)
      .eq("horizon", parsed.data.horizon)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;

    const { data, error } = await supabase
      .from("focus_items")
      .insert({
        workspace_id: workspace.id,
        created_by: user.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        horizon: parsed.data.horizon,
        target_date: parsed.data.targetDate ?? null,
        sort_order: (last?.sort_order ?? 0) + 10,
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath("/app/focus");
    return actionOk({ id: data.id });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't create that focus."));
  }
}

export async function updateFocusItemAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updateFocusItemSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { error } = await supabase
      .from("focus_items")
      .update({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        target_date: parsed.data.targetDate ?? null,
      })
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id);
    if (error) throw error;

    revalidatePath("/app/focus");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that focus."));
  }
}

export async function setFocusStatusAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(setFocusStatusSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { error } = await supabase
      .from("focus_items")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.id)
      .eq("workspace_id", workspace.id);
    if (error) throw error;

    revalidatePath("/app/focus");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't update that focus."));
  }
}

export async function reorderFocusItemAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(reorderFocusItemSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { data: items, error } = await supabase
      .from("focus_items")
      .select("id, sort_order")
      .eq("workspace_id", workspace.id)
      .eq("horizon", parsed.data.horizon)
      .neq("status", "archived")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    const list = items ?? [];
    const index = list.findIndex((item) => item.id === parsed.data.id);
    if (index === -1) return actionError("That focus item no longer exists.");

    const swapWith =
      parsed.data.direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= list.length) {
      return actionOk(null); // already at the edge — nothing to do
    }

    const current = list[index];
    const neighbor = list[swapWith];

    const [a, b] = await Promise.all([
      supabase
        .from("focus_items")
        .update({ sort_order: neighbor.sort_order })
        .eq("id", current.id)
        .eq("workspace_id", workspace.id),
      supabase
        .from("focus_items")
        .update({ sort_order: current.sort_order })
        .eq("id", neighbor.id)
        .eq("workspace_id", workspace.id),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;

    revalidatePath("/app/focus");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't reorder that focus."));
  }
}
