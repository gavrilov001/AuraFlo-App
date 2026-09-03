"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import { useToast } from "@/components/ui/Toast";
import type { ResetPreview } from "@/lib/data/today";
import { restartPlanningAction } from "../start/actions";

export function RestartPlanningDialog({
  open,
  planId,
  preview,
  onClose,
}: {
  open: boolean;
  planId: string;
  preview: Pick<ResetPreview, "topThree" | "completedInPlan">;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [clearTopThree, setClearTopThree] = useState(false);
  const [reopenCompleted, setReopenCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setClearTopThree(false);
    setReopenCompleted(false);
    setError(null);
    onClose();
  }

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await restartPlanningAction({
        planId,
        clearTopThree,
        reopenCompleted,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Planning restarted. Back to Step 1 — clear the inbox.");
      router.push(result.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <dialog
      ref={ref}
      aria-label="Restart planning"
      onCancel={(e) => {
        e.preventDefault();
        if (!isPending) close();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !isPending) close();
      }}
      className="m-auto w-[min(100vw-2rem,30rem)] rounded-[14px] border border-line bg-surface p-0 text-body shadow-pop backdrop:bg-navy-900/30"
    >
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">
          Restart planning for today?
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          This keeps every captured thought and every task. It just returns Start
          My Day to Step&nbsp;1 so you can work through your inbox again.
        </p>

        <label className="mt-1 flex items-start gap-2.5 text-[13px] text-body">
          <input
            type="checkbox"
            checked={clearTopThree}
            onChange={(e) => setClearTopThree(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-gold"
          />
          <span>
            Clear my current Top&nbsp;3
            <span className="mt-0.5 block text-faint">
              {preview.topThree > 0
                ? `${preview.topThree} priorit${
                    preview.topThree === 1 ? "y" : "ies"
                  } will be un-starred.`
                : "You have no priorities selected yet."}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-[13px] text-body">
          <input
            type="checkbox"
            checked={reopenCompleted}
            onChange={(e) => setReopenCompleted(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-gold"
          />
          <span>
            Reopen tasks completed in today&rsquo;s plan
            <span className="mt-0.5 block text-faint">
              {preview.completedInPlan > 0
                ? `${preview.completedInPlan} completed task${
                    preview.completedInPlan === 1 ? "" : "s"
                  } will be set back to open.`
                : "Nothing in this plan is completed."}
            </span>
          </span>
        </label>

        {error && <FormMessage tone="error">{error}</FormMessage>}

        <div className="mt-3 flex justify-end gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button size="sm" loading={isPending} onClick={submit}>
            Restart planning
          </Button>
        </div>
      </div>
    </dialog>
  );
}
