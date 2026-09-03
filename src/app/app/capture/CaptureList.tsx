"use client";

import { useState, useTransition } from "react";
import {
  Archive,
  ArrowUpRight,
  Copy,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { DropdownMenu, type MenuItem } from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/utils/cn";
import { formatInTimeZone, formatRelative } from "@/lib/utils/datetime";
import type { CategoryOption } from "@/lib/data/categories";
import type { CaptureWithCategory } from "@/lib/data/captures";
import type { CaptureFilter } from "@/lib/validation/captures";
import { updateCaptureAction } from "./actions";

const DECISION_LABEL: Record<string, string> = {
  today: "Added to today",
  scheduled: "Scheduled",
  delegated: "Delegated",
  someday: "Kept for later",
};

export function CaptureList({
  filter,
  captures,
  categories,
  timezone,
  busy,
  bulkEnabled,
  selected,
  onToggleSelect,
  onArchive,
  onDiscard,
  onRestore,
  onCopyToInbox,
  onDelete,
  onOpenTask,
  taskLoading,
  onSaved,
}: {
  filter: CaptureFilter;
  captures: CaptureWithCategory[];
  categories: CategoryOption[];
  timezone: string;
  busy: Set<string>;
  bulkEnabled: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onRestore: (id: string) => void;
  onCopyToInbox: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenTask: (taskId: string) => void;
  taskLoading: boolean;
  onSaved: () => void;
}) {
  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
      {captures.map((c) =>
        c.id.startsWith("temp-") ? (
          <li key={c.id} className="px-4 py-3 opacity-60">
            <p className="whitespace-pre-wrap break-words text-[14px] text-body">
              {c.content}
            </p>
            <p className="mt-1 text-[12px] text-faint">Saving…</p>
          </li>
        ) : (
          <CaptureItem
            key={c.id}
            capture={c}
            filter={filter}
            categories={categories}
            timezone={timezone}
            pending={busy.has(c.id)}
            bulkEnabled={bulkEnabled}
            checked={selected.has(c.id)}
            onToggleSelect={() => onToggleSelect(c.id)}
            onArchive={() => onArchive(c.id)}
            onDiscard={() => onDiscard(c.id)}
            onRestore={() => onRestore(c.id)}
            onCopyToInbox={() => onCopyToInbox(c.id)}
            onDelete={() => onDelete(c.id)}
            onOpenTask={onOpenTask}
            taskLoading={taskLoading}
            onSaved={onSaved}
          />
        ),
      )}
    </ul>
  );
}

function CaptureItem({
  capture,
  filter,
  categories,
  timezone,
  pending,
  bulkEnabled,
  checked,
  onToggleSelect,
  onArchive,
  onDiscard,
  onRestore,
  onCopyToInbox,
  onDelete,
  onOpenTask,
  taskLoading,
  onSaved,
}: {
  capture: CaptureWithCategory;
  filter: CaptureFilter;
  categories: CategoryOption[];
  timezone: string;
  pending: boolean;
  bulkEnabled: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onRestore: () => void;
  onCopyToInbox: () => void;
  onDelete: () => void;
  onOpenTask: (taskId: string) => void;
  taskLoading: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(capture.content);
  const [categoryId, setCategoryId] = useState(capture.category_id ?? "");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const canEdit = filter === "inbox" || filter === "processed";
  const stamp =
    filter === "inbox"
      ? capture.captured_at
      : filter === "archived"
        ? capture.archived_at ?? capture.processed_at
        : filter === "discarded"
          ? capture.discarded_at ?? capture.processed_at
          : capture.processed_at ?? capture.captured_at;

  function save() {
    if (!content.trim()) return;
    setErr(null);
    startTransition(async () => {
      const r = await updateCaptureAction({
        id: capture.id,
        content: content.trim(),
        notes: capture.notes,
        categoryId: categoryId || null,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setEditing(false);
      onSaved();
    });
  }

  const menu: MenuItem[] = [];
  if (canEdit) {
    menu.push({
      label: "Edit",
      icon: <Pencil aria-hidden className="size-3.5" />,
      onClick: () => setEditing(true),
    });
  }
  if (filter === "inbox") {
    menu.push(
      {
        label: "Archive",
        icon: <Archive aria-hidden className="size-3.5" />,
        onClick: onArchive,
      },
      {
        label: "Discard",
        icon: <Trash2 aria-hidden className="size-3.5" />,
        onClick: onDiscard,
        danger: true,
      },
    );
  }
  if (filter === "processed") {
    menu.push(
      {
        label: "Copy to Inbox",
        icon: <Copy aria-hidden className="size-3.5" />,
        onClick: onCopyToInbox,
      },
      {
        label: "Archive source",
        icon: <Archive aria-hidden className="size-3.5" />,
        onClick: onArchive,
      },
    );
  }
  if (filter === "archived") {
    menu.push(
      {
        label: "Restore",
        icon: <RotateCcw aria-hidden className="size-3.5" />,
        onClick: onRestore,
      },
      {
        label: "Copy to Inbox",
        icon: <Copy aria-hidden className="size-3.5" />,
        onClick: onCopyToInbox,
      },
      {
        label: "Delete permanently",
        icon: <Trash2 aria-hidden className="size-3.5" />,
        onClick: onDelete,
        danger: true,
      },
    );
  }
  if (filter === "discarded") {
    menu.push(
      {
        label: "Restore to Inbox",
        icon: <RotateCcw aria-hidden className="size-3.5" />,
        onClick: onRestore,
      },
      {
        label: "Archive",
        icon: <Archive aria-hidden className="size-3.5" />,
        onClick: onArchive,
      },
      {
        label: "Delete permanently",
        icon: <Trash2 aria-hidden className="size-3.5" />,
        onClick: onDelete,
        danger: true,
      },
    );
  }

  if (editing) {
    return (
      <li className="px-4 py-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          aria-label="Edit thought"
          className="w-full resize-y rounded-md border border-line bg-surface-soft px-3 py-2 text-[14px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 [color-scheme:light]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Category"
              className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 [color-scheme:light]"
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
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
                setErr(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={isPending}
              disabled={!content.trim()}
              onClick={save}
            >
              Save
            </Button>
          </div>
        </div>
        {err && <p className="mt-1.5 text-[12px] text-danger">{err}</p>}
      </li>
    );
  }

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors",
        pending && "opacity-55",
      )}
    >
      {bulkEnabled && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          aria-label={`Select "${capture.content.slice(0, 40)}"`}
          className="mt-1 size-4 shrink-0 accent-gold"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-body">
          {capture.content}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
          {stamp && (
            <time
              dateTime={stamp}
              title={formatInTimeZone(stamp, timezone)}
              suppressHydrationWarning
            >
              {formatRelative(stamp, timezone)}
            </time>
          )}
          {capture.category && (
            <CategoryChip
              name={capture.category.name}
              color={capture.category.color}
            />
          )}
          {filter !== "inbox" && capture.task && (
            <span>{DECISION_LABEL[capture.task.bucket] ?? "Processed"}</span>
          )}
          {filter !== "inbox" && capture.task ? (
            <button
              type="button"
              disabled={taskLoading}
              onClick={() => onOpenTask(capture.task!.id)}
              className="inline-flex items-center gap-1 font-medium text-gold-dark hover:underline disabled:opacity-50"
            >
              Created task: {capture.task.title}
              <ArrowUpRight aria-hidden className="size-3" />
            </button>
          ) : filter === "processed" && !capture.task ? (
            <span className="italic">Original task is no longer available.</span>
          ) : null}
        </div>
      </div>

      {(filter === "processed" || filter === "archived") && capture.task && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={taskLoading}
          onClick={() => onOpenTask(capture.task!.id)}
        >
          View task
        </Button>
      )}
      <DropdownMenu label="Thought actions" items={menu} />
    </li>
  );
}
