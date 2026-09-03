import "server-only";

import { createClient } from "@/lib/supabase/server";
import { captureLifecycleColumnsAvailable } from "@/lib/data/capture-lifecycle";
import type { Capture } from "@/lib/types/database.types";
import type { CaptureFilter, ListCapturesInput } from "@/lib/validation/captures";

export interface LinkedTaskRef {
  id: string;
  title: string;
  status: string;
  bucket: string;
}

export interface CaptureWithCategory extends Capture {
  category: { id: string; name: string; color: string | null } | null;
  /** The task created from this capture, when one exists (to-one). */
  task: LinkedTaskRef | null;
}

export interface CaptureCounts {
  inbox: number;
  processed: number;
  archived: number;
  discarded: number;
}

export interface CaptureListResult {
  filter: CaptureFilter;
  page: number;
  hasMore: boolean;
  captures: CaptureWithCategory[];
}

export const CAPTURES_PAGE_SIZE = 30;

const SELECT =
  "*, category:categories(id, name, color), " +
  "task:tasks!source_capture_id(id, title, status, bucket)";

const FILTER_TO_STATUS: Record<CaptureFilter, Capture["status"]> = {
  inbox: "inbox",
  processed: "processed",
  archived: "archived",
  discarded: "discarded",
};

function esc(raw: string): string {
  return raw.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
}

export async function listCaptures(
  workspaceId: string,
  params: ListCapturesInput,
): Promise<CaptureListResult> {
  const supabase = await createClient();
  const { filter, page, q, category, from, to } = params;
  const lifecycle = await captureLifecycleColumnsAvailable();

  let query = supabase
    .from("captures")
    .select(SELECT)
    .eq("workspace_id", workspaceId)
    .eq("status", FILTER_TO_STATUS[filter]);

  if (q) {
    const t = esc(q);
    if (t) query = query.or(`content.ilike.%${t}%,notes.ilike.%${t}%`);
  }
  if (category === "none") query = query.is("category_id", null);
  else if (category) query = query.eq("category_id", category);

  // Date filter applies to the timestamp that defines the tab (falls back to
  // processed_at when the archived_at / discarded_at columns aren't present).
  const dateCol =
    filter === "inbox"
      ? "captured_at"
      : filter === "processed" || !lifecycle
        ? "processed_at"
        : filter === "archived"
          ? "archived_at"
          : "discarded_at";
  if (from) query = query.gte(dateCol, `${from}T00:00:00Z`);
  if (to) query = query.lte(dateCol, `${to}T23:59:59Z`);

  if (filter === "inbox") {
    query = query.order("captured_at", { ascending: false });
  } else if (filter === "processed" || !lifecycle) {
    query = query
      .order("processed_at", { ascending: false, nullsFirst: false })
      .order("captured_at", { ascending: false });
  } else if (filter === "archived") {
    query = query
      .order("archived_at", { ascending: false, nullsFirst: false })
      .order("processed_at", { ascending: false, nullsFirst: false });
  } else {
    query = query
      .order("discarded_at", { ascending: false, nullsFirst: false })
      .order("processed_at", { ascending: false, nullsFirst: false });
  }

  const limit = page * CAPTURES_PAGE_SIZE;
  query = query.range(0, limit);

  const { data, error } = await query.returns<CaptureWithCategory[]>();
  if (error) throw error;

  const rows = data ?? [];
  return {
    filter,
    page,
    hasMore: rows.length > limit,
    captures: rows.slice(0, limit),
  };
}

export async function getCaptureCounts(
  workspaceId: string,
): Promise<CaptureCounts> {
  const supabase = await createClient();
  const statuses: (keyof CaptureCounts)[] = [
    "inbox",
    "processed",
    "archived",
    "discarded",
  ];
  const results = await Promise.all(
    statuses.map((s) =>
      supabase
        .from("captures")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", s),
    ),
  );
  const counts: CaptureCounts = {
    inbox: 0,
    processed: 0,
    archived: 0,
    discarded: 0,
  };
  results.forEach((r, i) => {
    counts[statuses[i]] = r.count ?? 0;
  });
  return counts;
}
