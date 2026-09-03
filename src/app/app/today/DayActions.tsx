"use client";

import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import type { ResetPreview } from "@/lib/data/today";
import { ResetTodayDialog } from "./ResetTodayDialog";
import { RestartPlanningDialog } from "./RestartPlanningDialog";

/**
 * "Day actions" — Restart planning + Reset today. Available wherever today's
 * daily plan exists (Start My Day, active Today, completed Today), never
 * hidden by plan status.
 */
export function DayActions({
  planId,
  resetPreview,
  showRestartButton = false,
  menuLabel = "Day actions",
}: {
  planId: string;
  resetPreview: ResetPreview;
  showRestartButton?: boolean;
  menuLabel?: string;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const restartItem = {
    label: "Restart planning",
    icon: <RotateCcw aria-hidden className="size-3.5" />,
    onClick: () => setRestartOpen(true),
  };
  const resetItem = {
    label: "Reset today",
    icon: <Trash2 aria-hidden className="size-3.5" />,
    onClick: () => setResetOpen(true),
    danger: true,
  };

  return (
    <div className="flex items-center gap-1.5">
      {showRestartButton && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRestartOpen(true)}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Restart planning
        </Button>
      )}
      <DropdownMenu
        label={menuLabel}
        items={showRestartButton ? [resetItem] : [restartItem, resetItem]}
      />

      <RestartPlanningDialog
        open={restartOpen}
        planId={planId}
        preview={resetPreview}
        onClose={() => setRestartOpen(false)}
      />
      <ResetTodayDialog
        open={resetOpen}
        preview={resetPreview}
        onClose={() => setResetOpen(false)}
      />
    </div>
  );
}
