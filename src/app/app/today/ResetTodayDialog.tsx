"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { useToast } from "@/components/ui/Toast";
import type { ResetPreview } from "@/lib/data/today";
import { resetTodayAction } from "./actions";

export function ResetTodayDialog({
  open,
  preview,
  onClose,
}: {
  open: boolean;
  preview: ResetPreview;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [reopen, setReopen] = useState(true);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setConfirm("");
    setReopen(true);
    setError(null);
    onClose();
  }

  function submit() {
    if (confirm !== "RESET" || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await resetTodayAction({
        reopenCompleted: reopen,
        confirm,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        "Today has been reset. Your restored thoughts are ready to review.",
      );
      router.push("/app/start");
      router.refresh();
    });
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!isPending) close();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !isPending) close();
      }}
      className="m-auto w-[min(100vw-2rem,32rem)] rounded-[14px] border border-line bg-surface p-0 text-body shadow-pop backdrop:bg-navy-900/30"
    >
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">
          Reset today and start over?
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          This will remove today&rsquo;s plan, clear your selected priorities, and
          return thoughts processed during this Start My Day session to your Dream
          Catcher. Tasks that existed before today&rsquo;s planning session will
          not be deleted.
        </p>

        <dl className="mt-1 flex flex-col gap-1.5 rounded-lg border border-line-soft bg-surface-soft/50 p-3.5 text-[13px]">
          <Row label="Plan items removed" value={preview.planItems} />
          <Row
            label="Tasks created this session, deleted"
            value={preview.sessionTasks}
          />
          <Row
            label="Thoughts returned to the Dream Catcher"
            value={preview.restoredCaptures}
          />
        </dl>

        {preview.legacyUntracked && (
          <FormMessage tone="error">
            Some items from this earlier planning session cannot be automatically
            returned because session tracking was not available. The plan and its
            priorities will be cleared, but no tasks or thoughts will be deleted.
          </FormMessage>
        )}

        <label className="mt-1 flex items-start gap-2.5 text-[13px] text-body">
          <input
            type="checkbox"
            checked={reopen}
            onChange={(e) => setReopen(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-gold"
          />
          <span>
            Reopen existing tasks completed in today&rsquo;s plan
            <span className="mt-0.5 block text-faint">
              Tasks that existed before this planning session will be preserved,
              but their completed status will be reopened
              {preview.completedPreexisting > 0
                ? ` (${preview.completedPreexisting}).`
                : "."}
            </span>
          </span>
        </label>

        <div className="mt-1">
          <TextField
            label="Type RESET to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

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
          <Button
            variant="danger"
            size="sm"
            loading={isPending}
            disabled={confirm !== "RESET"}
            onClick={submit}
          >
            Reset today
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
