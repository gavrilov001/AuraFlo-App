"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Clock3,
  Trash2,
  UserPlus,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { FocusOption, ReviewCapture } from "@/lib/data/start-day";
import { ScheduleForm, type SchedulePayload } from "./ScheduleForm";
import { DelegateForm, type DelegatePayload } from "./DelegateForm";
import { processCapturesAction, undoCapturesAction } from "./actions";

type Decision = "do_now" | "schedule" | "delegate" | "later" | "discard";

const UNDO_VERB: Record<Decision, string> = {
  do_now: "moved to Today",
  schedule: "scheduled",
  delegate: "delegated",
  later: "moved to Later",
  discard: "discarded",
};

type UndoState = {
  decision: Decision;
  captureIds: string[];
  label: string;
} | null;

export function BatchOrganize({
  planId,
  captures,
  timezone,
  planDate,
  focusItems,
  onHandled,
  onUnhandled,
  onCount,
}: {
  planId: string;
  captures: ReviewCapture[];
  timezone: string;
  planDate: string;
  focusItems: FocusOption[];
  onHandled: (ids: string[]) => void;
  onUnhandled: (ids: string[]) => void;
  onCount: (decision: string, delta: number) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "schedule" | "delegate">(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [undo, setUndo] = useState<UndoState>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  const visibleIds = useMemo(() => new Set(captures.map((c) => c.id)), [
    captures,
  ]);
  // Only count selections that are still in the visible list — processed
  // captures leave the list and their selection is ignored.
  const activeSelected = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );
  const count = activeSelected.length;
  const allSelected = count > 0 && count === captures.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  }
  function clear() {
    setSelected(new Set());
  }

  function scheduleUndoClear() {
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 9000);
  }

  function run(decision: Decision, extra: Record<string, unknown> = {}) {
    const list = [...activeSelected];
    if (!list.length || busy) return;

    setError(null);
    setBusy(true);
    setDialog(null);
    setConfirmDiscard(false);

    // Optimistic: remove from the list, bump Plan so far, show one Undo.
    onHandled(list);
    onCount(decision, list.length);
    clear();
    setUndo({
      decision,
      captureIds: list,
      label: `${list.length} ${
        list.length === 1 ? "thought" : "thoughts"
      } ${UNDO_VERB[decision]}.`,
    });
    scheduleUndoClear();

    void processCapturesAction({
      planId,
      captureIds: list,
      decision,
      ...extra,
    }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onUnhandled(list);
        onCount(decision, -list.length);
        setUndo(null);
        setError(result.error);
        toast.error(result.error ?? "That batch action didn't save.");
        return;
      }
      const { processed, skipped } = result.data;
      if (processed !== list.length) {
        // Reconcile the optimistic count for anything that was skipped.
        onCount(decision, processed - list.length);
      }
      setUndo({
        decision,
        captureIds: list,
        label:
          `${processed} ${processed === 1 ? "thought" : "thoughts"} ` +
          `${UNDO_VERB[decision]}` +
          (skipped ? ` · ${skipped} skipped.` : "."),
      });
      scheduleUndoClear();
      router.refresh();
    });
  }

  function runUndo() {
    if (!undo || busy) return;
    const target = undo;
    setBusy(true);
    setError(null);
    void undoCapturesAction({
      planId,
      captureIds: target.captureIds,
      decision: target.decision,
    }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      const restored = result.data.restored;
      onUnhandled(target.captureIds);
      onCount(target.decision, -restored);
      setUndo(null);
      if (result.data.kept > 0) {
        toast.info(
          `${result.data.kept} kept — you changed ${
            result.data.kept === 1 ? "that task" : "those tasks"
          } after processing.`,
        );
      }
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {undo && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-soft px-3.5 py-2.5 text-sm"
        >
          <span className="text-muted">{undo.label}</span>
          <button
            type="button"
            onClick={runUndo}
            disabled={busy}
            className="font-medium text-ink hover:text-gold-dark disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}

      {captures.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line py-8 text-center text-[14px] text-faint">
          Nothing left to organize.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            <button
              type="button"
              onClick={selectAll}
              className="font-medium text-muted hover:text-ink"
            >
              {allSelected ? "Clear selection" : "Select all visible"}
            </button>
            <span className="text-faint">{count} selected</span>
          </div>

          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {captures.map((c) => {
              const checked = selected.has(c.id);
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      className="mt-1 size-4 shrink-0 accent-gold"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-[14px] text-body">
                        {c.content}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                        <time dateTime={c.captured_at}>
                          {formatInTimeZone(c.captured_at, timezone)}
                        </time>
                        {c.category && (
                          <CategoryChip
                            name={c.category.name}
                            color={c.category.color}
                          />
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          {count > 0 && (
            <div
              role="group"
              aria-label="Batch actions"
              className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface p-3 shadow-pop"
            >
              <span className="text-[13px] font-medium text-ink">
                {count} {count === 1 ? "thought" : "thoughts"} selected
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() => run("do_now")}
                >
                  <Zap aria-hidden className="size-4" />
                  Move to Today
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDialog("schedule")}
                >
                  <CalendarClock aria-hidden className="size-4" />
                  Schedule
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDialog("delegate")}
                >
                  <UserPlus aria-hidden className="size-4" />
                  Delegate
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run("later")}
                >
                  <Clock3 aria-hidden className="size-4" />
                  Later
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDiscard(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                >
                  <Trash2 aria-hidden className="size-4" />
                  Discard
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="px-2 text-sm font-medium text-faint hover:text-ink"
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <BatchModal
        open={dialog === "schedule"}
        title={`Schedule ${count} ${count === 1 ? "thought" : "thoughts"}`}
        note="Each selected thought will remain a separate task."
        onClose={() => setDialog(null)}
      >
        <ScheduleForm
          planDate={planDate}
          focusItems={focusItems}
          pending={busy}
          fieldErrors={{}}
          onCancel={() => setDialog(null)}
          onSubmit={(payload: SchedulePayload) =>
            run("schedule", {
              scheduledFor: payload.scheduledFor,
              dueAt: payload.dueAt,
              notes: payload.notes,
              focusItemId: payload.focusItemId,
              addToToday: payload.addToToday,
            })
          }
        />
      </BatchModal>

      <BatchModal
        open={dialog === "delegate"}
        title={`Delegate ${count} ${count === 1 ? "thought" : "thoughts"}`}
        note="The same delegate will be assigned to all selected thoughts, but each becomes a separate task."
        onClose={() => setDialog(null)}
      >
        <DelegateForm
          focusItems={focusItems}
          pending={busy}
          fieldErrors={{}}
          onCancel={() => setDialog(null)}
          onSubmit={(payload: DelegatePayload) =>
            run("delegate", {
              delegateName: payload.delegateName,
              delegateEmail: payload.delegateEmail,
              dueAt: payload.dueAt,
              notes: payload.notes,
              focusItemId: payload.focusItemId,
            })
          }
        />
      </BatchModal>

      <ConfirmDialog
        open={confirmDiscard}
        title={`Discard ${count} selected ${
          count === 1 ? "thought" : "thoughts"
        }?`}
        description="They won't become tasks. You can still find them in the Discarded section of your Dream Catcher — nothing is permanently deleted."
        confirmLabel="Discard"
        destructive
        loading={busy}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => run("discard")}
      />
    </div>
  );
}

function BatchModal({
  open,
  title,
  note,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  note: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(100vw-2rem,32rem)] rounded-[14px] border border-line",
        "bg-surface p-0 text-body shadow-pop backdrop:bg-navy-900/30",
      )}
    >
      <div className="flex flex-col gap-2 p-6">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{note}</p>
        {children}
      </div>
    </dialog>
  );
}
