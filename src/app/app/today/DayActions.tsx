"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import type { ResetPreview } from "@/lib/data/today";
import { getResetPreviewAction } from "./actions";
import { ResetTodayDialog } from "./ResetTodayDialog";
import { RestartPlanningDialog } from "./RestartPlanningDialog";

/**
 * "Day actions" — Restart planning + Reset today. Available wherever today's
 * daily plan exists (Start My Day, active Today, completed Today), never
 * hidden by plan status.
 *
 * The reset/restart preview counts are fetched here on demand, the moment a
 * dialog actually opens — not passed down from the page. Most visits never
 * open either dialog, so this keeps that extra round trip off every ordinary
 * page load of Start My Day / Today.
 */
export function DayActions({
  planId,
  showRestartButton = false,
  menuLabel = "Day actions",
}: {
  planId: string;
  showRestartButton?: boolean;
  menuLabel?: string;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Reset the cached preview whenever the underlying plan changes — adjusted
  // during render (React's recommended pattern for this), not in an effect.
  const [previewPlanId, setPreviewPlanId] = useState(planId);
  if (planId !== previewPlanId) {
    setPreviewPlanId(planId);
    setPreview(null);
    setPreviewError(null);
  }

  useEffect(() => {
    if (!restartOpen && !resetOpen) return;
    if (preview || previewError) return;
    let cancelled = false;
    void getResetPreviewAction({ planId }).then((r) => {
      if (cancelled) return;
      if (r.ok) setPreview(r.data);
      else setPreviewError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [restartOpen, resetOpen, preview, previewError, planId]);

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
        preview={preview}
        previewError={previewError}
        onClose={() => setRestartOpen(false)}
      />
      <ResetTodayDialog
        open={resetOpen}
        preview={preview}
        previewError={previewError}
        onClose={() => setResetOpen(false)}
      />
    </div>
  );
}
