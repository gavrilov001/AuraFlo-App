"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Trash2 } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormMessage } from "@/components/ui/FormMessage";
import { EmptyState } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import type { CategoryOption } from "@/lib/data/categories";
import type { FocusOption } from "@/lib/data/start-day";
import type { TaskRow as TaskRowData, TaskListResult } from "@/lib/data/tasks";
import {
  TASK_VIEWS,
  type Destination,
  type ListTasksInput,
  type TaskView,
} from "@/lib/validation/tasks";
import { TaskRow, type RowCallbacks } from "./TaskRow";
import { TaskPanel, type Mode } from "./TaskPanel";
import {
  deleteAllTasksAction,
  moveTaskAction,
  reorderTasksAction,
  setTaskStatusAction,
  setTaskTopThreeAction,
} from "./actions";

const VIEW_LABEL: Record<TaskView, string> = {
  open: "Open",
  today: "Today",
  scheduled: "Scheduled",
  delegated: "Delegated",
  later: "Later",
  completed: "Completed",
};

const EMPTY: Record<TaskView, { title: string; description?: string }> = {
  open: { title: "Nothing open right now." },
  today: { title: "No tasks have been chosen for today." },
  scheduled: { title: "Nothing is scheduled." },
  delegated: { title: "You're not waiting on anyone." },
  later: { title: "Nothing is waiting for later." },
  completed: { title: "No completed tasks yet." },
};

type Patch = Partial<
  Pick<TaskRowData, "status" | "completed_at" | "is_top_three">
>;

export function TasksWorkspace({
  result,
  params,
  categories,
  focusItems,
  timezone,
  taskTotal,
}: {
  result: TaskListResult;
  params: ListTasksInput;
  categories: CategoryOption[];
  focusItems: FocusOption[];
  timezone: string;
  taskTotal: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [panel, setPanel] = useState<Mode | null>(null);
  const [patch, setPatch] = useState<Record<string, Patch>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [localOrder, setLocalOrder] = useState<Record<string, string[]>>({});
  const [cancelTask, setCancelTask] = useState<TaskRowData | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllPhrase, setDeleteAllPhrase] = useState("");
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const reorderQueues = useRef(new Map<string, Promise<void>>());

  // Reset overlays whenever the server data changes (navigation / refresh).
  const [snapshot, setSnapshot] = useState(result);
  if (snapshot !== result) {
    setSnapshot(result);
    setPatch({});
    setHidden(new Set());
    setPending(new Set());
    setLocalOrder({});
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const view = params.view;
  const dndEnabled =
    params.sort === "manual" && view !== "completed" && view !== "open";

  const topThreeCount =
    result.topThreeCount +
    Object.entries(patch).filter(
      ([id, p]) =>
        p.is_top_three === true &&
        !result.tasks.find((t) => t.id === id)?.is_top_three,
    ).length -
    Object.entries(patch).filter(
      ([id, p]) =>
        p.is_top_three === false &&
        result.tasks.find((t) => t.id === id)?.is_top_three,
    ).length;

  const applyRow = useCallback(
    (t: TaskRowData): TaskRowData => ({ ...t, ...patch[t.id] }),
    [patch],
  );

  // --- URL helpers -------------------------------------------------------
  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in updates)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [search, pathname, router],
  );

  // debounced search
  const [q, setQ] = useState(params.q);
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) {
      firstQ.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      setParam({ q: q || null });
    }, 280);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function tabHref(v: TaskView): string {
    const next = new URLSearchParams();
    next.set("view", v);
    if (params.q) next.set("q", params.q);
    if (params.category) next.set("category", params.category);
    if (params.focus) next.set("focus", params.focus);
    if (params.sort !== "manual") next.set("sort", params.sort);
    return `${pathname}?${next.toString()}`;
  }

  // --- mutations --------------------------------------------------------
  function markPending(id: string, on: boolean) {
    setPending((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  function setP(id: string, p: Patch) {
    setPatch((cur) => ({ ...cur, [id]: { ...cur[id], ...p } }));
  }
  function revert(id: string) {
    setPatch((cur) => {
      const n = { ...cur };
      delete n[id];
      return n;
    });
    setHidden((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  function complete(id: string) {
    if (pending.has(id)) return;
    const row = result.tasks.find((t) => t.id === id);
    setP(id, { status: "completed", completed_at: new Date().toISOString() });
    if (view !== "completed") setHidden((s) => new Set(s).add(id));
    markPending(id, true);
    void setTaskStatusAction({ taskId: id, op: "complete" }).then((r) => {
      markPending(id, false);
      if (!r.ok) {
        revert(id);
        toast.error(r.error);
        return;
      }
      toast.success("Task completed.", {
        label: "Undo",
        onClick: () => reopen(id, row),
      });
    });
  }

  function reopen(id: string, prev?: TaskRowData) {
    if (pending.has(id)) return;
    const row = prev ?? result.tasks.find((t) => t.id === id);
    const next = row?.bucket === "delegated" ? "waiting" : "open";
    setP(id, { status: next, completed_at: null });
    if (view === "completed") setHidden((s) => new Set(s).add(id));
    markPending(id, true);
    void setTaskStatusAction({ taskId: id, op: "reopen" }).then((r) => {
      markPending(id, false);
      if (!r.ok) {
        revert(id);
        toast.error(r.error);
      }
    });
  }

  function cancel(task: TaskRowData) {
    const id = task.id;
    setCancelTask(null);
    setHidden((s) => new Set(s).add(id));
    setP(id, { status: "cancelled" });
    markPending(id, true);
    void setTaskStatusAction({ taskId: id, op: "cancel" }).then((r) => {
      markPending(id, false);
      if (!r.ok) {
        revert(id);
        toast.error(r.error);
        return;
      }
      toast.success("Task cancelled.");
    });
  }

  function toggleTop(id: string, value: boolean) {
    if (pending.has(id)) return;
    if (value && topThreeCount >= 3) {
      toast.error("You can choose up to three top priorities.");
      return;
    }
    setP(id, { is_top_three: value });
    markPending(id, true);
    void setTaskTopThreeAction({ taskId: id, value }).then((r) => {
      markPending(id, false);
      if (!r.ok) {
        setP(id, { is_top_three: !value });
        toast.error(r.error);
      }
    });
  }

  function move(task: TaskRowData, destination: Destination) {
    if (destination === "scheduled" || destination === "delegated") {
      setPanel({ kind: "edit", task, forceDestination: destination });
      return;
    }
    const id = task.id;
    if (pending.has(id)) return;
    // Optimistic: it leaves every view except "open" (which regroups on refresh).
    if (view !== "open") setHidden((s) => new Set(s).add(id));
    markPending(id, true);
    void moveTaskAction({
      taskId: id,
      destination,
      scheduledFor: null,
      dueAt: null,
      delegateName: null,
      delegateEmail: null,
      reopenPlan: false,
    }).then((r) => {
      markPending(id, false);
      if (!r.ok) {
        if (r.error.includes("Reopen it")) {
          // let the user confirm reopening today's plan
          setHidden((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
          void moveTaskAction({
            taskId: id,
            destination,
            scheduledFor: null,
            dueAt: null,
            delegateName: null,
            delegateEmail: null,
            reopenPlan: true,
          }).then((r2) => {
            if (!r2.ok) toast.error(r2.error);
            else router.refresh();
          });
          return;
        }
        revert(id);
        toast.error(r.error);
        return;
      }
      toast.success(
        `Moved to ${destination === "later" ? "Later" : VIEW_LABEL[destination as TaskView]}.`,
      );
      router.refresh();
    });
  }

  function confirmDeleteAll() {
    if (deleteAllBusy || deleteAllPhrase !== "DELETE ALL") return;
    setDeleteAllBusy(true);
    void deleteAllTasksAction({ confirm: deleteAllPhrase }).then((r) => {
      setDeleteAllBusy(false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setDeleteAllOpen(false);
      setDeleteAllPhrase("");
      toast.success(
        r.data.deleted === 1 ? "1 task deleted." : `${r.data.deleted} tasks deleted.`,
      );
      router.refresh();
    });
  }

  function reorderGroup(groupKey: string, orderedIds: string[]) {
    setLocalOrder((o) => ({ ...o, [groupKey]: orderedIds }));
    const previous = reorderQueues.current.get(groupKey) ?? Promise.resolve();
    const queue = previous.catch(() => {}).then(async () => {
      const result = await reorderTasksAction({ taskIds: orderedIds });
      if (!result.ok) {
        setLocalOrder((current) => {
          if (current[groupKey]?.join(",") !== orderedIds.join(",")) {
            return current;
          }
          const next = { ...current };
          delete next[groupKey];
          return next;
        });
        toast.error(result.error);
      }
    });
    reorderQueues.current.set(groupKey, queue);
    void queue.finally(() => {
      if (reorderQueues.current.get(groupKey) === queue) {
        reorderQueues.current.delete(groupKey);
      }
    });
  }

  function nudge(groupKey: string, id: string, dir: -1 | 1, ids: string[]) {
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= ids.length) return;
    reorderGroup(groupKey, arrayMove(ids, from, to));
  }

  const cb: (groupKey: string, ids: string[]) => RowCallbacks = (
    groupKey,
    ids,
  ) => ({
    onOpen: (task) =>
      setPanel({
        kind: "edit",
        task,
      }),
    onComplete: complete,
    onReopen: (id) => reopen(id),
    onCancel: (task) => setCancelTask(task),
    onToggleTop: toggleTop,
    onMove: move,
    onLinkFocus: (task) => setPanel({ kind: "edit", task }),
    onNudge: (id, dir) => nudge(groupKey, id, dir, ids),
  });

  // --- groups w/ overlays applied --------------------------------------
  const groups = useMemo(() => {
    return result.groups
      .map((g) => {
        let tasks = g.tasks.filter((t) => !hidden.has(t.id)).map(applyRow);
        const order = localOrder[g.key];
        if (order) {
          const byId = new Map(tasks.map((t) => [t.id, t]));
          tasks = order.map((id) => byId.get(id)).filter(Boolean) as TaskRowData[];
        }
        return { ...g, tasks };
      })
      .filter((g) => g.tasks.length > 0);
  }, [result.groups, hidden, applyRow, localOrder]);

  const isEmpty = groups.length === 0;

  function handleDragEnd(groupKey: string, ids: string[]) {
    return (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(active.id as string);
      const to = ids.indexOf(over.id as string);
      if (from === -1 || to === -1) return;
      reorderGroup(groupKey, arrayMove(ids, from, to));
    };
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="All Tasks"
          subtitle="Everything you've decided to keep, in one clear place."
        />
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => setPanel({ kind: "add" })}>
            <Plus aria-hidden className="size-4" />
            Add task
          </Button>
          {taskTotal > 0 && (
            <DropdownMenu
              label="Task list actions"
              items={[
                {
                  label: "Delete all tasks",
                  icon: <Trash2 aria-hidden className="size-3.5" />,
                  danger: true,
                  onClick: () => {
                    setDeleteAllPhrase("");
                    setDeleteAllOpen(true);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Task views"
        className="-mx-1 flex gap-x-5 gap-y-1.5 overflow-x-auto border-b border-line-soft px-1 [scrollbar-width:none]"
      >
        {TASK_VIEWS.map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={tabHref(v)}
              role="tab"
              aria-selected={active}
              scroll={false}
              className={cn(
                "-mb-px shrink-0 border-b-2 pb-2.5 pt-1 text-[15px] transition-colors",
                active
                  ? "border-gold font-semibold text-ink"
                  : "border-transparent font-medium text-muted hover:text-ink",
              )}
            >
              {VIEW_LABEL[v]}
            </Link>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, notes, delegate…"
            aria-label="Search tasks"
            className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </div>
        <ToolbarSelect
          label="Category"
          value={params.category}
          onChange={(v) => setParam({ category: v || null })}
          options={[
            { value: "", label: "All categories" },
            { value: "none", label: "No category" },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <ToolbarSelect
          label="Focus"
          value={params.focus}
          onChange={(v) => setParam({ focus: v || null })}
          options={[
            { value: "", label: "All focus" },
            { value: "none", label: "No focus" },
            ...focusItems.map((f) => ({ value: f.id, label: f.title })),
          ]}
        />
        <ToolbarSelect
          label="Sort"
          value={params.sort}
          onChange={(v) => setParam({ sort: v === "manual" ? null : v })}
          options={[
            { value: "manual", label: "Manual" },
            { value: "due", label: "Due soon" },
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]}
        />
        {view === "completed" && (
          <button
            type="button"
            onClick={() =>
              setParam({ showCancelled: params.showCancelled ? null : "1" })
            }
            className="h-9 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-muted hover:text-ink"
          >
            {params.showCancelled ? "Hide cancelled" : "Show cancelled"}
          </button>
        )}
      </div>

      {/* List */}
      {isEmpty ? (
        <EmptyState
          title={EMPTY[view].title}
          description={EMPTY[view].description}
          action={
            view === "open" || view === "today" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPanel({ kind: "add" })}
              >
                Add a task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((g) => {
            const ids = g.tasks.map((t) => t.id);
            const callbacks = cb(g.key, ids);
            const list = (
              <ul className="divide-y divide-line-soft">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    timezone={timezone}
                    pending={pending.has(t.id)}
                    draggable={dndEnabled}
                    topThreeFull={topThreeCount >= 3}
                    cb={callbacks}
                  />
                ))}
              </ul>
            );
            return (
              <section key={g.key} className="flex flex-col gap-1.5">
                {g.label && (
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-faint">
                    {g.label}
                    <span className="ml-1.5 tabular-nums font-normal">
                      {g.tasks.length}
                    </span>
                  </h2>
                )}
                {dndEnabled ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd(g.key, ids)}
                  >
                    <SortableContext
                      items={ids}
                      strategy={verticalListSortingStrategy}
                    >
                      {list}
                    </SortableContext>
                  </DndContext>
                ) : (
                  list
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-faint">
        {params.page > 1 && (
          <Button
            size="sm"
            variant="ghost"
            loading={isPending}
            onClick={() =>
              startTransition(() =>
                setParam({ page: String(params.page - 1) }),
              )
            }
          >
            Newer
          </Button>
        )}
        <span>Page {params.page}</span>
        {params.page > 1 && (
          <Button
            size="sm"
            variant="ghost"
            loading={isPending}
            onClick={() => startTransition(() => setParam({ page: null }))}
          >
            Newest
          </Button>
        )}
        {result.hasMore && (
          <Button
            size="sm"
            variant="secondary"
            loading={isPending}
            onClick={() =>
              startTransition(() =>
                setParam({ page: String(params.page + 1) }),
              )
            }
          >
            Older
          </Button>
        )}
      </div>

      {!dndEnabled && params.sort === "manual" && view === "open" && (
        <FormMessage tone="success">
          Switch to a single destination view to reorder tasks by hand.
        </FormMessage>
      )}

      <TaskPanel
        mode={panel}
        categories={categories}
        focusItems={focusItems}
        onClose={() => setPanel(null)}
        onDone={({ structural }) => {
          setPanel(null);
          if (structural) router.refresh();
        }}
      />

      <ConfirmDialog
        open={cancelTask !== null}
        title="Cancel this task?"
        description="It stays in your history but is no longer active. This can't be undone from here."
        confirmLabel="Cancel task"
        destructive
        onCancel={() => setCancelTask(null)}
        onConfirm={() => cancelTask && cancel(cancelTask)}
      />

      <DeleteAllTasksDialog
        open={deleteAllOpen}
        count={taskTotal}
        value={deleteAllPhrase}
        busy={deleteAllBusy}
        onChange={setDeleteAllPhrase}
        onCancel={() => {
          if (deleteAllBusy) return;
          setDeleteAllOpen(false);
          setDeleteAllPhrase("");
        }}
        onConfirm={confirmDeleteAll}
      />
    </>
  );
}

function DeleteAllTasksDialog({
  open,
  count,
  value,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
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
      aria-label="Delete all tasks"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[min(100vw-2rem,28rem)] rounded-[14px] border border-line bg-surface p-0 text-body shadow-pop backdrop:bg-navy-900/30"
    >
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">Delete all tasks?</h2>
        <p className="text-sm leading-relaxed text-muted">
          This will permanently delete all tasks in this workspace, including
          completed, scheduled, delegated, and later tasks. Dream Catcher
          thoughts, Focus items, and workspace settings will remain.
        </p>
        <p className="text-[13px] font-medium text-body">
          {count === 1
            ? "1 task will be deleted."
            : `${count} tasks will be deleted.`}
        </p>
        <label className="text-[13px] font-medium text-body">
          Type <span className="font-mono">DELETE ALL</span> to confirm
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            disabled={busy}
            className={cn(
              "mt-1 h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px]",
              "text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30",
            )}
          />
        </label>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            disabled={value !== "DELETE ALL"}
            onClick={onConfirm}
          >
            Delete all tasks
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function ToolbarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
