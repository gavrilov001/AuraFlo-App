"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarClock,
  Check,
  Clock3,
  GripVertical,
  Link2,
  Pencil,
  RotateCcw,
  Star,
  Sun,
  UserPlus,
} from "lucide-react";

import { DropdownMenu, type MenuItem } from "@/components/ui/DropdownMenu";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { cn } from "@/lib/utils/cn";
import { formatDateOnly, formatInTimeZone } from "@/lib/utils/datetime";
import type { TaskRow as TaskRowData } from "@/lib/data/tasks";

const BUCKET_LABEL: Record<string, string> = {
  today: "Today",
  scheduled: "Scheduled",
  delegated: "Delegated",
  someday: "Later",
};

export interface RowCallbacks {
  onOpen: (task: TaskRowData) => void;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onCancel: (task: TaskRowData) => void;
  onToggleTop: (id: string, value: boolean) => void;
  onMove: (
    task: TaskRowData,
    destination: "today" | "scheduled" | "delegated" | "later",
  ) => void;
  onLinkFocus: (task: TaskRowData) => void;
  onNudge: (id: string, dir: -1 | 1) => void;
}

export function TaskRow({
  task,
  timezone,
  pending,
  draggable,
  topThreeFull,
  cb,
}: {
  task: TaskRowData;
  timezone: string;
  pending: boolean;
  draggable: boolean;
  topThreeFull: boolean;
  cb: RowCallbacks;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !draggable });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isDone = task.status === "completed";
  const isCancelled = task.status === "cancelled";

  const menu: MenuItem[] = [];
  if (isDone || isCancelled) {
    menu.push({
      label: "View details",
      icon: <Pencil aria-hidden className="size-3.5" />,
      onClick: () => cb.onOpen(task),
    });
    if (isDone) {
      menu.push({
        label: "Reopen",
        icon: <RotateCcw aria-hidden className="size-3.5" />,
        onClick: () => cb.onReopen(task.id),
      });
    }
  } else {
    if (draggable) {
      menu.push(
        {
          label: "Move up",
          icon: <ArrowUp aria-hidden className="size-3.5" />,
          onClick: () => cb.onNudge(task.id, -1),
        },
        {
          label: "Move down",
          icon: <ArrowDown aria-hidden className="size-3.5" />,
          onClick: () => cb.onNudge(task.id, 1),
        },
      );
    }
    menu.push({
      label: "Edit",
      icon: <Pencil aria-hidden className="size-3.5" />,
      onClick: () => cb.onOpen(task),
    });
    if (task.bucket !== "today") {
      menu.push({
        label: "Move to Today",
        icon: <Sun aria-hidden className="size-3.5" />,
        onClick: () => cb.onMove(task, "today"),
      });
    }
    if (task.bucket !== "scheduled") {
      menu.push({
        label: "Schedule",
        icon: <CalendarClock aria-hidden className="size-3.5" />,
        onClick: () => cb.onMove(task, "scheduled"),
      });
    }
    if (task.bucket !== "delegated") {
      menu.push({
        label: "Delegate",
        icon: <UserPlus aria-hidden className="size-3.5" />,
        onClick: () => cb.onMove(task, "delegated"),
      });
    }
    if (task.bucket !== "someday") {
      menu.push({
        label: "Move to Later",
        icon: <Clock3 aria-hidden className="size-3.5" />,
        onClick: () => cb.onMove(task, "later"),
      });
    }
    menu.push({
      label: task.focus ? "Change Focus" : "Link Focus",
      icon: <Link2 aria-hidden className="size-3.5" />,
      onClick: () => cb.onLinkFocus(task),
    });
    menu.push({
      label: "Cancel task",
      icon: <Ban aria-hidden className="size-3.5" />,
      onClick: () => cb.onCancel(task),
      danger: true,
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-2.5 px-1 py-3 transition-colors",
        isDragging && "relative z-10 rounded-lg bg-surface shadow-pop",
        pending && "opacity-55",
      )}
    >
      {draggable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${task.title}`}
          className="mt-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => cb.onOpen(task)}
          className="block max-w-full text-left"
        >
          <span
            className={cn(
              "text-[14px] font-medium leading-snug",
              isDone || isCancelled ? "text-muted line-through" : "text-ink",
            )}
          >
            {task.title}
          </span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
          {task.is_top_three && (
            <span className="inline-flex items-center gap-1 text-gold-dark">
              <Star aria-hidden className="size-3 fill-gold text-gold" />
              Top priority
            </span>
          )}
          {task.category && (
            <CategoryChip
              name={task.category.name}
              color={task.category.color}
            />
          )}
          <span>{BUCKET_LABEL[task.bucket] ?? task.bucket}</span>
          {task.scheduled_for && (
            <span>{formatDateOnly(task.scheduled_for)}</span>
          )}
          {task.due_at && (
            <span>due {formatInTimeZone(task.due_at, timezone)}</span>
          )}
          {task.bucket === "delegated" && task.delegate_name && (
            <span>with {task.delegate_name}</span>
          )}
          {task.focus && (
            <span className="inline-flex items-center gap-1">
              <Link2 aria-hidden className="size-3" />
              {task.focus.title}
            </span>
          )}
          {isCancelled && <span>cancelled</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {task.is_top_three || (task.bucket === "today" && !isDone && !isCancelled) ? (
          <TopToggle
            active={task.is_top_three}
            disabled={pending || (!task.is_top_three && topThreeFull)}
            onClick={() => cb.onToggleTop(task.id, !task.is_top_three)}
          />
        ) : null}
        {!isCancelled && (
          <CompleteControl
            done={isDone}
            disabled={pending}
            onClick={() =>
              isDone ? cb.onReopen(task.id) : cb.onComplete(task.id)
            }
          />
        )}
        <DropdownMenu label="Task actions" items={menu} />
      </div>
    </li>
  );
}

function CompleteControl({
  done,
  disabled,
  onClick,
}: {
  done: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50",
        done
          ? "border-transparent bg-gold/15 text-gold-dark hover:bg-gold/25"
          : "border-line bg-surface text-muted hover:border-gold/50 hover:bg-gold/10 hover:text-gold-dark",
      )}
    >
      {done ? (
        <>
          <RotateCcw aria-hidden className="size-3.5" />
          Reopen
        </>
      ) : (
        <>
          <Check aria-hidden className="size-3.5" />
          Complete
        </>
      )}
    </button>
  );
}

function TopToggle({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "Remove from top priorities" : "Make a top priority"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-40",
        active ? "text-gold-dark" : "text-faint hover:text-ink",
      )}
    >
      <Star
        aria-hidden
        className={cn("size-4", active && "fill-gold text-gold")}
      />
    </button>
  );
}
