"use client";

import { Undo2 } from "lucide-react";

export function UndoDecision({
  label,
  onUndo,
  pending,
}: {
  label: string;
  onUndo: () => void;
  pending: boolean;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-soft px-3.5 py-2.5 text-sm motion-safe:animate-[app-fade-in_150ms_ease-out]"
    >
      <span className="text-muted">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={pending}
        className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-gold-dark disabled:opacity-50"
      >
        <Undo2 aria-hidden className="size-3.5" />
        Undo
      </button>
    </div>
  );
}
