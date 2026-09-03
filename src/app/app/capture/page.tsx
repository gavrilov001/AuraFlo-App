import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { getCaptureCounts, listCaptures } from "@/lib/data/captures";
import { listCategories } from "@/lib/data/categories";
import { listActiveFocusItems } from "@/lib/data/start-day";
import { listCapturesSchema } from "@/lib/validation/captures";
import { PageHeader } from "@/components/ui/PageHeader";
import { CaptureBoard } from "./CaptureBoard";

export const metadata: Metadata = { title: "Dream Catcher" };

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = listCapturesSchema.parse({
    filter: pick(raw.filter),
    page: pick(raw.page),
    q: pick(raw.q),
    category: pick(raw.category),
    from: pick(raw.from),
    to: pick(raw.to),
  });

  const { workspace, profile } = await requireWorkspaceContext();
  const [result, counts, categories, focusItems] = await Promise.all([
    listCaptures(workspace.id, params),
    getCaptureCounts(workspace.id),
    listCategories(workspace.id),
    listActiveFocusItems(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dream Catcher"
        subtitle="Capture it now. Decide what happens next when you're ready."
      />
      <CaptureBoard
        result={result}
        counts={counts}
        categories={categories}
        focusItems={focusItems}
        timezone={profile.timezone}
        params={params}
      />
    </div>
  );
}

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
