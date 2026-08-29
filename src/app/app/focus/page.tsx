import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { getFocusBoard } from "@/lib/data/focus";
import { FocusBoard } from "./FocusBoard";

export const metadata: Metadata = { title: "Focus" };

export default async function FocusPage() {
  const { workspace } = await requireWorkspaceContext();
  const board = await getFocusBoard(workspace.id);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Focus
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Keep sight of what matters now, what you&apos;re building toward, and
          the direction you want to move.
        </p>
      </header>

      <FocusBoard live={board.live} archived={board.archived} />
    </div>
  );
}
