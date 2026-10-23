"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Inbox, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Surface";
import { FormMessage } from "@/components/ui/FormMessage";
import { cn } from "@/lib/utils/cn";
import { formatInTimeZone, formatRelative } from "@/lib/utils/datetime";
import type { CategoryOption } from "@/lib/data/categories";
import type { CaptureCounts, CaptureWithCategory } from "@/lib/data/captures";
import type { CaptureFilter } from "@/lib/validation/captures";
import { setCaptureStatusAction, updateCaptureAction } from "./actions";

const FILTERS: { key: CaptureFilter; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "processed", label: "Processed" },
  { key: "archived", label: "Archived" },
  { key: "discarded", label: "Discarded" },
];

interface CaptureListProps {
  filter: CaptureFilter;
  captures: CaptureWithCategory[];
  counts: CaptureCounts;
  categories: CategoryOption[];
  timezone: string;
}

export function CaptureList({
  filter,
  captures,
  counts,
  categories,
  timezone,
}: CaptureListProps) {
  const router = useRouter();
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function runStatusChange(
    id: string,
    status: "inbox" | "processed" | "archived" | "discarded",
    undoLabel?: string,
  ) {
    setListError(null);
    startTransition(async () => {
      const result = await setCaptureStatusAction({ id, status });
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      if (undoLabel) setUndo({ id, label: undoLabel });
      else setUndo(null);
      router.refresh();
    });
  }

  return (
    <section aria-label="Captures" className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Filter captures"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {FILTERS.map(({ key, label }) => {
          const active = key === filter;
          return (
            <Link
              key={key}
              href={key === "inbox" ? "/app/capture" : `/app/capture?filter=${key}`}
              role="tab"
              aria-selected={active}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-evergreen text-evergreen"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {label}
              <span className="ml-1.5 text-xs text-ink-subtle">
                {counts[key]}
              </span>
            </Link>
          );
        })}
      </div>

      {listError && <FormMessage tone="error">{listError}</FormMessage>}

      {undo && (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
          <span className="text-ink-muted">{undo.label}</span>
          <button
            type="button"
            onClick={() => runStatusChange(undo.id, "inbox")}
            className="inline-flex items-center gap-1 font-medium text-evergreen hover:underline"
          >
            <Undo2 aria-hidden className="size-3.5" />
            Undo
          </button>
        </div>
      )}

      {captures.length === 0 ? (
        <EmptyState
          icon={<Inbox aria-hidden className="size-6" />}
          title={
            filter === "inbox"
              ? "Your inbox is clear"
              : `Nothing ${filter} yet`
          }
          description={
            filter === "inbox"
              ? "Captured thoughts land here until you sort them."
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {captures.map((capture) => (
            <CaptureRow
              key={capture.id}
              capture={capture}
              categories={categories}
              timezone={timezone}
              filter={filter}
              onArchive={() =>
                runStatusChange(capture.id, "archived", "Capture archived.")
              }
              onDiscard={() =>
                runStatusChange(capture.id, "discarded", "Capture discarded.")
              }
              onRestore={() => runStatusChange(capture.id, "inbox")}
              onSaved={() => {
                setUndo(null);
                router.refresh();
              }}
              onError={setListError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface CaptureRowProps {
  capture: CaptureWithCategory;
  categories: CategoryOption[];
  timezone: string;
  filter: CaptureFilter;
  onArchive: () => void;
  onDiscard: () => void;
  onRestore: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

function CaptureRow({
  capture,
  categories,
  timezone,
  filter,
  onArchive,
  onDiscard,
  onRestore,
  onSaved,
  onError,
}: CaptureRowProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(capture.content);
  const [categoryId, setCategoryId] = useState(capture.category_id ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!content.trim()) return;
    startTransition(async () => {
      const result = await updateCaptureAction({
        id: capture.id,
        content: content.trim(),
        notes: capture.notes,
        categoryId: categoryId || null,
      });
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setEditing(false);
      onSaved();
    });
  }

  if (editing) {
    return (
      <li className="rounded-md border border-border-strong bg-surface p-3 shadow-soft">
        <label className="sr-only" htmlFor={`edit-${capture.id}`}>
          Edit capture
        </label>
        <textarea
          id={`edit-${capture.id}`}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="w-full resize-y rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              aria-label="Category"
              className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-ink"
            >
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setContent(capture.content);
                setCategoryId(capture.category_id ?? "");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              loading={isPending}
              disabled={!content.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="group rounded-md border border-border bg-surface p-3 shadow-soft">
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {capture.content}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <time
          dateTime={capture.captured_at}
          title={formatInTimeZone(capture.captured_at, timezone)}
        >
          {formatRelative(capture.captured_at, timezone)}
        </time>
        {capture.category && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: capture.category.color ?? "#8f8676" }}
            />
            {capture.category.name}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          {filter === "inbox" && (
            <>
              <RowAction
                icon={<Pencil className="size-3.5" />}
                label="Edit"
                onClick={() => setEditing(true)}
              />
              <RowAction
                icon={<Archive className="size-3.5" />}
                label="Archive"
                onClick={onArchive}
                disabled={isPending}
              />
              <RowAction
                icon={<Trash2 className="size-3.5" />}
                label="Discard"
                onClick={onDiscard}
                disabled={isPending}
              />
            </>
          )}
          {(filter === "archived" || filter === "discarded") && (
            <RowAction
              icon={<RotateCcw className="size-3.5" />}
              label="Move to inbox"
              onClick={onRestore}
              disabled={isPending}
            />
          )}
          {filter === "processed" && (
            <RowAction
              icon={<Archive className="size-3.5" />}
              label="Archive"
              onClick={onArchive}
              disabled={isPending}
            />
          )}
        </span>
      </div>
    </li>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
