import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/lib/types/database.types";

export type CategoryOption = Pick<Category, "id" | "name" | "color">;

export async function listCategories(
  workspaceId: string,
): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, color")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
