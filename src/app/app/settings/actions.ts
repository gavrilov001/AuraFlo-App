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
  updateProfileSchema,
  updateWorkspaceSchema,
} from "@/lib/validation/settings";

const WORKSPACE_EDIT_ROLES = new Set(["owner", "admin"]);

export async function updateProfileAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updateProfileSchema, {
    fullName: formData.get("fullName"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { user } = await requireWorkspaceContext();
    const supabase = await createClient();

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: parsed.data.fullName,
        timezone: parsed.data.timezone,
      })
      .eq("id", user.id);
    if (error) throw error;

    revalidatePath("/app/settings");
    revalidatePath("/app/capture");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't save your profile."));
  }
}

export async function updateWorkspaceAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseInput(updateWorkspaceSchema, {
    name: formData.get("name"),
  });
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    const { workspace, role } = await requireWorkspaceContext();
    if (!WORKSPACE_EDIT_ROLES.has(role)) {
      return actionError(
        "Only a workspace owner or admin can rename the workspace.",
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("workspaces")
      .update({ name: parsed.data.name })
      .eq("id", workspace.id);
    if (error) throw error;

    revalidatePath("/app/settings");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't rename the workspace."));
  }
}
