import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { FocusHorizon, FocusItem } from "@/lib/types/database.types";

export type FocusItemsByHorizon = Record<FocusHorizon, FocusItem[]>;

export interface FocusBoard {
  live: FocusItemsByHorizon;
  archived: FocusItem[];
}

function emptyByHorizon(): FocusItemsByHorizon {
  return { short: [], medium: [], long: [] };
}

export async function getFocusBoard(workspaceId: string): Promise<FocusBoard> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("focus_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const live = emptyByHorizon();
  const archived: FocusItem[] = [];

  for (const item of data ?? []) {
    if (item.status === "archived") {
      archived.push(item);
    } else {
      live[item.horizon].push(item);
    }
  }

  return { live, archived };
}
