import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { getFocusBoard } from "@/lib/data/focus";
import { PageHeader } from "@/components/ui/PageHeader";
import { FocusBoard } from "./FocusBoard";

export const metadata: Metadata = { title: "Focus" };

export default async function FocusPage() {
  const { workspace } = await requireWorkspaceContext();
  const board = await getFocusBoard(workspace.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Focus"
        subtitle="What matters now, what you're building toward, and where you're headed — in one view."
      />

      <FocusBoard live={board.live} archived={board.archived} />
    </div>
  );
}
