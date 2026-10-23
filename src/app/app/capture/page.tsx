import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { getCaptureCounts, listCaptures } from "@/lib/data/captures";
import { listCategories } from "@/lib/data/categories";
import { captureFilterSchema } from "@/lib/validation/captures";
import { CaptureComposer } from "./CaptureComposer";
import { CaptureList } from "./CaptureList";

export const metadata: Metadata = { title: "Dream Catcher" };

export default async function CapturePage({
  searchParams,
}: PageProps<"/app/capture">) {
  const params = await searchParams;
  const filter = captureFilterSchema.parse(
    typeof params.filter === "string" ? params.filter : undefined,
  );

  const { workspace, profile } = await requireWorkspaceContext();
  const [captures, counts, categories] = await Promise.all([
    listCaptures(workspace.id, filter),
    getCaptureCounts(workspace.id),
    listCategories(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Dream Catcher
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Drop a thought here now. Sort it out later.
        </p>
      </header>

      <CaptureComposer categories={categories} />

      <CaptureList
        filter={filter}
        captures={captures}
        counts={counts}
        categories={categories}
        timezone={profile.timezone}
      />
    </div>
  );
}
