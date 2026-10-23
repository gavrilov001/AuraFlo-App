import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Capture } from "@/lib/types/database.types";
import type { CaptureFilter } from "@/lib/validation/captures";

export interface CaptureWithCategory extends Capture {
  category: { id: string; name: string; color: string | null } | null;
}

export interface CaptureCounts {
  inbox: number;
  processed: number;
  archived: number;
  discarded: number;
}

const FILTER_TO_STATUS: Record<CaptureFilter, Capture["status"]> = {
  inbox: "inbox",
  processed: "processed",
  archived: "archived",
  discarded: "discarded",
};

export async function listCaptures(
  workspaceId: string,
  filter: CaptureFilter,
): Promise<CaptureWithCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("captures")
    .select("*, category:categories(id, name, color)")
    .eq("workspace_id", workspaceId)
    .eq("status", FILTER_TO_STATUS[filter])
    .order("captured_at", { ascending: false })
    .returns<CaptureWithCategory[]>();

  if (error) throw error;
  return data ?? [];
}

export async function getCaptureCounts(
  workspaceId: string,
): Promise<CaptureCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("captures")
    .select("status")
    .eq("workspace_id", workspaceId);

  if (error) throw error;

  const counts: CaptureCounts = {
    inbox: 0,
    processed: 0,
    archived: 0,
    discarded: 0,
  };
  for (const row of data ?? []) {
    if (row.status in counts) {
      counts[row.status as keyof CaptureCounts] += 1;
    }
  }
  return counts;
}
