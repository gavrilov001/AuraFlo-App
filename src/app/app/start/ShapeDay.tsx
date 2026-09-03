"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Star,
  CalendarClock,
  Clock3,
  X,
} from "lucide-react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField, SelectField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { DropdownMenu, type MenuItem } from "@/components/ui/DropdownMenu";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatDateOnly } from "@/lib/utils/datetime";
import type { CategoryOption } from "@/lib/data/categories";
import type {
  FocusOption,
  PlanItemWithTask,
  PlanTask,
} from "@/lib/data/start-day";
import {
  addTaskToPlanAction,
  backToStepAction,
  createPlanTaskAction,
  finishAdjustAction,
  goToReadyAction,
  linkFocusAction,
  moveTaskToLaterAction,
  removeFromPlanAction,
  reorderPlanItemsAction,
  rescheduleTaskAction,
  toggleTopThreeAction,
  updatePlanTaskAction,
} from "./actions";

const BUCKET_LABEL: Record<string, string> = {
  today: "Today",
  scheduled: "Scheduled",
  delegated: "Delegated",
  someday: "Later",
};

type RunFn = (
  p: Promise<{ ok: boolean; error?: string }>,
  cb?: () => void,
) => void;

export function ShapeDay({
  plan,
  planItems,
  availableTasks,
  focusItems,
  categories,
  adjustMode = false,
}: {
  plan: { id: string; plan_date: string };
  planItems: PlanItemWithTask[];
  availableTasks: PlanTask[];
  focusItems: FocusOption[];
  categories: CategoryOption[];
  adjustMode?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  // Local order + top-three overlay so drag/prioritise feel instant. Re-synced
  // whenever the server sends a fresh planItems prop (any other mutation).
  const [items, setItems] = useState(planItems);
  const [snapshot, setSnapshot] = useState(planItems);
  if (snapshot !== planItems) {
    setSnapshot(planItems);
    setItems(planItems);
  }

  const persistedOrder = useRef<string[]>(planItems.map((i) => i.id));

  const topThreeCount = items.filter((i) => i.is_top_three).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function run(promise: Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  function persistOrder(next: PlanItemWithTask[]) {
    const previous = persistedOrder.current;
    const nextIds = next.map((i) => i.id);
    persistedOrder.current = nextIds;
    void reorderPlanItemsAction({ planId: plan.id, itemIds: nextIds }).then(
      (result) => {
        if (!result.ok) {
          persistedOrder.current = previous;
          setItems((current) => {
            const map = new Map(current.map((i) => [i.id, i]));
            return previous.map((id) => map.get(id)).filter(Boolean) as
              PlanItemWithTask[];
          });
          toast.error(result.error ?? "We couldn't save the new order.");
        }
      },
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    persistOrder(next);
  }

  function moveBy(id: string, direction: -1 | 1) {
    const from = items.findIndex((i) => i.id === id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= items.length) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    persistOrder(next);
  }

  function toggleTop(item: PlanItemWithTask) {
    const nextValue = !item.is_top_three;
    if (nextValue && topThreeCount >= 3) {
      toast.error("You can choose up to three top priorities.");
      return;
    }
    setItems((current) =>
      current.map((i) =>
        i.id === item.id ? { ...i, is_top_three: nextValue } : i,
      ),
    );
    void toggleTopThreeAction({ planItemId: item.id, value: nextValue }).then(
      (result) => {
        if (!result.ok) {
          setItems((current) =>
            current.map((i) =>
              i.id === item.id ? { ...i, is_top_three: !nextValue } : i,
            ),
          );
          toast.error(result.error ?? "We couldn't update priorities.");
        }
      },
    );
  }

  function reviewPlan() {
    if (adjustMode) {
      setError(null);
      startTransition(async () => {
        const result = await finishAdjustAction({ planId: plan.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(result.data.redirectTo);
      });
      return;
    }
    run(goToReadyAction({ planId: plan.id }));
  }

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-[22px] font-semibold text-ink">
          {adjustMode ? "Adjust today's plan" : "Shape your day"}
        </h2>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-muted">
          {adjustMode
            ? "Change what's on today and which few things matter most. Your day stays active."
            : "Drag to order your day, and star up to three things that would make it feel meaningful."}
        </p>
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}

      <section aria-label="Today's plan" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-ink">
            Today&rsquo;s plan
          </h3>
          <p className="text-[13px] text-faint">
            {topThreeCount} of 3 top priorities
          </p>
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-faint">
            Nothing here yet. Add a task below, or bring one in from the list.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {items.map((item, index) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    isFirst={index === 0}
                    isLast={index === items.length - 1}
                    topThreeFull={topThreeCount >= 3}
                    focusItems={focusItems}
                    planDate={plan.plan_date}
                    pending={isPending}
                    onRun={run}
                    onMove={moveBy}
                    onToggleTop={toggleTop}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {adding ? (
          <NewTaskForm
            planId={plan.id}
            focusItems={focusItems}
            categories={categories}
            pending={isPending}
            onDone={() => setAdding(false)}
            onRun={run}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden className="size-4" />
            Add a task
          </Button>
        )}
      </section>

      {availableTasks.length > 0 && (
        <section aria-label="Available tasks" className="flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold text-ink">
            Bring in from your tasks
          </h3>
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
            {availableTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-body">{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                    <span>{BUCKET_LABEL[task.bucket] ?? task.bucket}</span>
                    {task.scheduled_for && (
                      <span>{formatDateOnly(task.scheduled_for)}</span>
                    )}
                    {task.category && (
                      <CategoryChip
                        name={task.category.name}
                        color={task.category.color}
                      />
                    )}
                    {task.delegate_name && (
                      <span>waiting on {task.delegate_name}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      addTaskToPlanAction({ planId: plan.id, taskId: task.id }),
                    )
                  }
                >
                  Add to today
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line-soft pt-6">
        <Button onClick={reviewPlan} loading={isPending}>
          {adjustMode ? "Save and return to Today" : "Review my plan"}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
        {!adjustMode && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(backToStepAction({ planId: plan.id, step: "capture_review" }))
            }
            className="text-[13px] font-medium text-faint hover:text-ink disabled:opacity-50"
          >
            Back to the inbox
          </button>
        )}
      </div>
    </div>
  );
}

function SortableRow({
  item,
  isFirst,
  isLast,
  topThreeFull,
  focusItems,
  planDate,
  pending,
  onRun,
  onMove,
  onToggleTop,
}: {
  item: PlanItemWithTask;
  isFirst: boolean;
  isLast: boolean;
  topThreeFull: boolean;
  focusItems: FocusOption[];
  planDate: string;
  pending: boolean;
  onRun: RunFn;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggleTop: (item: PlanItemWithTask) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border bg-surface shadow-note",
        item.is_top_three ? "border-gold/50" : "border-line",
        isDragging && "relative z-10 border-gold/70 opacity-95 shadow-pop",
      )}
    >
      <div className="flex gap-2 p-3.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${item.task.title}`}
          className="mt-0.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <PlanItemBody
            item={item}
            isFirst={isFirst}
            isLast={isLast}
            topThreeFull={topThreeFull}
            focusItems={focusItems}
            planDate={planDate}
            pending={pending}
            onRun={onRun}
            onMove={onMove}
            onToggleTop={onToggleTop}
          />
        </div>
      </div>
    </li>
  );
}

function PlanItemBody({
  item,
  isFirst,
  isLast,
  topThreeFull,
  focusItems,
  planDate,
  pending,
  onRun,
  onMove,
  onToggleTop,
}: {
  item: PlanItemWithTask;
  isFirst: boolean;
  isLast: boolean;
  topThreeFull: boolean;
  focusItems: FocusOption[];
  planDate: string;
  pending: boolean;
  onRun: RunFn;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggleTop: (item: PlanItemWithTask) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [title, setTitle] = useState(item.task.title);
  const [notes, setNotes] = useState(item.task.notes ?? "");
  const [focusId, setFocusId] = useState(item.task.focus_item_id ?? "");
  const [when, setWhen] = useState(planDate);

  const top = item.is_top_three;
  const menu: MenuItem[] = [
    {
      label: "Move up",
      icon: <ArrowUp aria-hidden className="size-3.5" />,
      onClick: () => onMove(item.id, -1),
    },
    {
      label: "Move down",
      icon: <ArrowDown aria-hidden className="size-3.5" />,
      onClick: () => onMove(item.id, 1),
    },
    {
      label: "Edit task",
      icon: <Pencil aria-hidden className="size-3.5" />,
      onClick: () => setEditing(true),
    },
    {
      label: item.task.focus ? "Change focus link" : "Link to a focus",
      icon: <Link2 aria-hidden className="size-3.5" />,
      onClick: () => setLinking(true),
    },
    {
      label: "Reschedule",
      icon: <CalendarClock aria-hidden className="size-3.5" />,
      onClick: () => setRescheduling(true),
    },
    {
      label: "Move to later",
      icon: <Clock3 aria-hidden className="size-3.5" />,
      onClick: () => onRun(moveTaskToLaterAction({ taskId: item.task.id })),
    },
    {
      label: "Remove from today",
      icon: <X aria-hidden className="size-3.5" />,
      onClick: () => onRun(removeFromPlanAction({ planItemId: item.id })),
      danger: true,
    },
  ];
  if (isFirst) menu.shift();
  if (isLast) {
    const idx = menu.findIndex((m) => m.label === "Move down");
    if (idx !== -1) menu.splice(idx, 1);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextAreaField
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setTitle(item.task.title);
              setNotes(item.task.notes ?? "");
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            loading={pending}
            disabled={!title.trim()}
            onClick={() =>
              onRun(
                updatePlanTaskAction({
                  taskId: item.task.id,
                  title: title.trim(),
                  notes: notes.trim() || null,
                }),
                () => setEditing(false),
              )
            }
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="text-[14px] leading-relaxed text-ink">{item.task.title}</p>
      {item.task.notes && (
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
          {item.task.notes}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
        {item.task.category && (
          <CategoryChip
            name={item.task.category.name}
            color={item.task.category.color}
          />
        )}
        {item.task.due_at && (
          <span>due {new Date(item.task.due_at).toLocaleString()}</span>
        )}
        {item.task.focus && (
          <span className="inline-flex items-center gap-1">
            <Link2 aria-hidden className="size-3" />
            {item.task.focus.title}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1">
        <button
          type="button"
          aria-pressed={top}
          disabled={!top && topThreeFull}
          onClick={() => onToggleTop(item)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors disabled:opacity-40",
            top ? "text-gold-dark" : "text-muted hover:text-ink",
          )}
        >
          <Star
            aria-hidden
            className={cn("size-3.5", top && "fill-gold text-gold")}
          />
          {top ? "Top priority" : "Make a priority"}
        </button>
        <DropdownMenu label="Task actions" items={menu} />
      </div>

      {linking && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface-soft/60 p-3">
          <SelectField
            label="Focus link"
            value={focusId}
            onChange={(e) => setFocusId(e.target.value)}
          >
            <option value="">No focus link</option>
            {focusItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </SelectField>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                onRun(
                  linkFocusAction({
                    taskId: item.task.id,
                    focusItemId: focusId || null,
                  }),
                  () => setLinking(false),
                )
              }
            >
              Save link
            </Button>
          </div>
        </div>
      )}

      {rescheduling && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface-soft/60 p-3">
          <TextField
            label="New date"
            type="date"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRescheduling(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                onRun(
                  rescheduleTaskAction({
                    taskId: item.task.id,
                    scheduledFor: when,
                  }),
                  () => setRescheduling(false),
                )
              }
            >
              Reschedule
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function NewTaskForm({
  planId,
  focusItems,
  categories,
  pending,
  onDone,
  onRun,
}: {
  planId: string;
  focusItems: FocusOption[];
  categories: CategoryOption[];
  pending: boolean;
  onDone: () => void;
  onRun: RunFn;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [focusId, setFocusId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-note"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        onRun(
          createPlanTaskAction({
            planId,
            title: title.trim(),
            notes: notes.trim() || null,
            focusItemId: focusId || null,
            categoryId: categoryId || null,
          }),
          () => {
            setTitle("");
            setNotes("");
            setFocusId("");
            setCategoryId("");
            onDone();
          },
        );
      }}
    >
      <TextField
        label="New task for today"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        autoFocus
      />
      <TextAreaField
        label="Notes (optional)"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.length > 0 && (
          <SelectField
            label="Category (optional)"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        {focusItems.length > 0 && (
          <SelectField
            label="Focus link (optional)"
            value={focusId}
            onChange={(e) => setFocusId(e.target.value)}
          >
            <option value="">No focus link</option>
            {focusItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending} disabled={!title.trim()}>
          Add task
        </Button>
      </div>
    </form>
  );
}
