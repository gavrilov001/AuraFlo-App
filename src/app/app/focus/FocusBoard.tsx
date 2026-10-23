"use client";

import { useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { TextField, TextAreaField } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatDateOnly } from "@/lib/utils/datetime";
import type {
  FocusHorizon,
  FocusItem,
  FocusStatus,
} from "@/lib/types/database.types";
import type { FocusItemsByHorizon } from "@/lib/data/focus";
import type { ActionResult } from "@/lib/actions/result";
import {
  createFocusItemAction,
  reorderFocusItemAction,
  setFocusStatusAction,
  updateFocusItemAction,
} from "./actions";

const HORIZONS: {
  key: FocusHorizon;
  title: string;
  label: string;
  blurb: string;
}[] = [
  {
    key: "short",
    title: "Now",
    label: "Short term",
    blurb: "What needs your attention this week or two.",
  },
  {
    key: "medium",
    title: "Next",
    label: "Medium term",
    blurb: "What you're steadily building toward.",
  },
  {
    key: "long",
    title: "Direction",
    label: "Long term",
    blurb: "Where you want all of this to lead.",
  },
];

const STATUS_LABEL: Record<FocusStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Done",
  archived: "Archived",
};

interface FocusBoardState {
  live: FocusItemsByHorizon;
  archived: FocusItem[];
}

interface FocusFormInput {
  title: string;
  description: string | null;
  targetDate: string | null;
}

/** Same ordering the server query uses, so an optimistic insert lands where a refetch would put it. */
function compareItems(a: FocusItem, b: FocusItem): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function insertSorted(list: FocusItem[], item: FocusItem): FocusItem[] {
  const next = list.filter((i) => i.id !== item.id);
  const index = next.findIndex((i) => compareItems(item, i) < 0);
  if (index === -1) next.push(item);
  else next.splice(index, 0, item);
  return next;
}

function findItem(board: FocusBoardState, id: string): FocusItem | undefined {
  for (const horizon of HORIZONS) {
    const found = board.live[horizon.key].find((i) => i.id === id);
    if (found) return found;
  }
  return board.archived.find((i) => i.id === id);
}

/** Moves `item` to `nextStatus`, relocating it between its horizon list and the archived list as needed. */
function applyStatusChange(
  board: FocusBoardState,
  item: FocusItem,
  nextStatus: FocusStatus,
): FocusBoardState {
  const wasArchived = item.status === "archived";
  const willArchive = nextStatus === "archived";
  const updated: FocusItem = { ...item, status: nextStatus };

  if (!wasArchived && !willArchive) {
    const list = board.live[item.horizon].map((i) =>
      i.id === item.id ? updated : i,
    );
    return { ...board, live: { ...board.live, [item.horizon]: list } };
  }
  if (!wasArchived && willArchive) {
    const list = board.live[item.horizon].filter((i) => i.id !== item.id);
    return {
      live: { ...board.live, [item.horizon]: list },
      archived: insertSorted(board.archived, updated),
    };
  }
  // wasArchived && !willArchive — reopening back into its horizon.
  return {
    archived: board.archived.filter((i) => i.id !== item.id),
    live: {
      ...board.live,
      [item.horizon]: insertSorted(board.live[item.horizon], updated),
    },
  };
}

export function FocusBoard({
  live,
  archived,
  workspaceId,
}: {
  live: FocusItemsByHorizon;
  archived: FocusItem[];
  workspaceId: string;
}) {
  const toast = useToast();
  const onError = (message: string) => toast.error(message);

  // A fresh `live`/`archived` prop pair (new navigation, or a future refetch)
  // replaces local optimistic state outright.
  const [snapshot, setSnapshot] = useState({ live, archived });
  const [board, setBoard] = useState<FocusBoardState>(snapshot);
  if (snapshot.live !== live || snapshot.archived !== archived) {
    setSnapshot({ live, archived });
    setBoard({ live, archived });
  }

  // One request in flight per horizon at a time, so a reorder call's "current
  // order" read on the server always reflects every earlier queued swap.
  const reorderQueues = useRef(new Map<FocusHorizon, Promise<void>>());

  async function createItem(
    horizon: FocusHorizon,
    input: FocusFormInput,
  ): Promise<ActionResult<{ id: string }>> {
    const tempId = `temp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const maxSortOrder = board.live[horizon].reduce(
      (max, i) => Math.max(max, i.sort_order),
      0,
    );
    const tempItem: FocusItem = {
      id: tempId,
      workspace_id: workspaceId,
      created_by: null,
      title: input.title,
      description: input.description,
      horizon,
      status: "active",
      target_date: input.targetDate,
      sort_order: maxSortOrder + 10,
      created_at: now,
      updated_at: now,
    };
    setBoard((b) => ({
      ...b,
      live: { ...b.live, [horizon]: [...b.live[horizon], tempItem] },
    }));

    const result = await createFocusItemAction({
      title: input.title,
      description: input.description,
      horizon,
      targetDate: input.targetDate,
    });

    if (!result.ok) {
      setBoard((b) => ({
        ...b,
        live: {
          ...b.live,
          [horizon]: b.live[horizon].filter((i) => i.id !== tempId),
        },
      }));
      return result;
    }

    setBoard((b) => ({
      ...b,
      live: {
        ...b.live,
        [horizon]: b.live[horizon].map((i) =>
          i.id === tempId ? { ...i, id: result.data.id } : i,
        ),
      },
    }));
    return result;
  }

  async function editItem(
    item: FocusItem,
    input: FocusFormInput,
  ): Promise<ActionResult<null>> {
    const result = await updateFocusItemAction({
      id: item.id,
      title: input.title,
      description: input.description,
      targetDate: input.targetDate,
    });
    if (result.ok) {
      setBoard((b) => ({
        ...b,
        live: {
          ...b.live,
          [item.horizon]: b.live[item.horizon].map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  title: input.title,
                  description: input.description,
                  target_date: input.targetDate,
                }
              : i,
          ),
        },
      }));
    }
    return result;
  }

  function setStatus(item: FocusItem, nextStatus: FocusStatus) {
    const previousStatus = item.status;
    setBoard((b) => applyStatusChange(b, item, nextStatus));
    void setFocusStatusAction({ id: item.id, status: nextStatus }).then(
      (result) => {
        if (!result.ok) {
          setBoard((b) => {
            const current = findItem(b, item.id);
            // Only undo if nothing else changed this item's status meanwhile.
            if (!current || current.status !== nextStatus) return b;
            return applyStatusChange(b, current, previousStatus);
          });
          onError(result.error);
        }
      },
    );
  }

  function reorderItem(
    horizon: FocusHorizon,
    item: FocusItem,
    direction: "up" | "down",
  ) {
    const list = board.live[horizon];
    const index = list.findIndex((i) => i.id === item.id);
    if (index === -1) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= list.length) return;

    const current = list[index];
    const neighbor = list[swapWith];

    setBoard((b) => {
      const l = b.live[horizon];
      const i = l.findIndex((x) => x.id === current.id);
      const j = l.findIndex((x) => x.id === neighbor.id);
      if (i === -1 || j === -1) return b;
      const next = [...l];
      next[i] = { ...l[j], sort_order: l[i].sort_order };
      next[j] = { ...l[i], sort_order: l[j].sort_order };
      return { ...b, live: { ...b.live, [horizon]: next } };
    });

    const previousInQueue =
      reorderQueues.current.get(horizon) ?? Promise.resolve();
    const queued = previousInQueue.catch(() => {}).then(async () => {
      const result = await reorderFocusItemAction({
        id: current.id,
        horizon,
        direction,
      });
      if (!result.ok) {
        setBoard((b) => {
          const l = b.live[horizon];
          const i = l.findIndex((x) => x.id === current.id);
          const j = l.findIndex((x) => x.id === neighbor.id);
          // Only undo if the two are still exactly where this swap put them —
          // a later queued reorder or other edit may have moved on already.
          if (i === -1 || j === -1 || Math.abs(i - j) !== 1) return b;
          const [a, bIdx] = i < j ? [i, j] : [j, i];
          const next = [...l];
          next[a] = { ...l[bIdx], sort_order: l[a].sort_order };
          next[bIdx] = { ...l[a], sort_order: l[bIdx].sort_order };
          return { ...b, live: { ...b.live, [horizon]: next } };
        });
        onError(result.error);
      }
    });
    reorderQueues.current.set(horizon, queued);
    void queued.finally(() => {
      if (reorderQueues.current.get(horizon) === queued) {
        reorderQueues.current.delete(horizon);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-[clamp(1rem,1.6vw,1.5rem)] sm:grid-cols-2 xl:grid-cols-3">
        {HORIZONS.map((horizon) => (
          <FocusSection
            key={horizon.key}
            horizon={horizon.key}
            title={horizon.title}
            label={horizon.label}
            blurb={horizon.blurb}
            items={board.live[horizon.key]}
            onCreate={createItem}
            onEdit={editItem}
            onSetStatus={setStatus}
            onReorder={reorderItem}
            onError={onError}
          />
        ))}
      </div>

      {board.archived.length > 0 && (
        <details className="border-t border-line-soft pt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
            Archived ({board.archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5">
            {board.archived.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-faint line-through">{item.title}</span>
                <ReopenButton item={item} onSetStatus={setStatus} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FocusSection({
  horizon,
  title,
  label,
  blurb,
  items,
  onCreate,
  onEdit,
  onSetStatus,
  onReorder,
  onError,
}: {
  horizon: FocusHorizon;
  title: string;
  label: string;
  blurb: string;
  items: FocusItem[];
  onCreate: (
    horizon: FocusHorizon,
    input: FocusFormInput,
  ) => Promise<ActionResult<{ id: string }>>;
  onEdit: (
    item: FocusItem,
    input: FocusFormInput,
  ) => Promise<ActionResult<null>>;
  onSetStatus: (item: FocusItem, status: FocusStatus) => void;
  onReorder: (
    horizon: FocusHorizon,
    item: FocusItem,
    direction: "up" | "down",
  ) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section
      aria-labelledby={`focus-${horizon}`}
      className="flex min-h-[300px] flex-col gap-4 rounded-lg border border-line-soft border-t-[3px] border-t-gold/45 bg-surface-soft/40 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-faint">{label}</p>
          <h2
            id={`focus-${horizon}`}
            className="text-[20px] font-semibold leading-tight text-ink"
          >
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{blurb}</p>
        </div>
        <IconButton
          label={`Add to ${title}`}
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="mt-0.5 shrink-0 border border-line bg-surface"
        >
          <Plus aria-hidden className="size-4" />
        </IconButton>
      </div>

      {adding && (
        <AddFocusForm
          horizon={horizon}
          onCreate={onCreate}
          onDone={() => setAdding(false)}
          onError={onError}
        />
      )}

      {items.length === 0 && !adding ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-2 py-4">
          <p className="text-[14px] font-medium text-ink">Nothing here yet.</p>
          <p className="text-[13px] text-muted">
            Add one thing worth keeping in view.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden className="size-4" />
            Add focus
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <FocusItemCard
              key={item.id}
              item={item}
              horizon={horizon}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              onEdit={onEdit}
              onSetStatus={onSetStatus}
              onReorder={onReorder}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function readFormInput(formData: FormData): FocusFormInput {
  const description = formData.get("description");
  const targetDate = formData.get("targetDate");
  return {
    title: String(formData.get("title") ?? ""),
    description: description ? String(description) : null,
    targetDate: targetDate ? String(targetDate) : null,
  };
}

function AddFocusForm({
  horizon,
  onCreate,
  onDone,
  onError,
}: {
  horizon: FocusHorizon;
  onCreate: (
    horizon: FocusHorizon,
    input: FocusFormInput,
  ) => Promise<ActionResult<{ id: string }>>;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(formData: FormData) {
    setFieldErrors({});
    startTransition(async () => {
      const result = await onCreate(horizon, readFormInput(formData));
      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else onError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form
      action={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-note"
    >
      <TextField
        label="What do you want to keep in view?"
        name="title"
        required
        autoFocus
        error={fieldErrors.title}
      />
      <TextAreaField
        label="Notes (optional)"
        name="description"
        rows={2}
        error={fieldErrors.description}
      />
      <TextField
        label="Target date (optional)"
        name="targetDate"
        type="date"
        error={fieldErrors.targetDate}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={isPending}>
          Add focus
        </Button>
      </div>
    </form>
  );
}

function FocusItemCard({
  item,
  horizon,
  isFirst,
  isLast,
  onEdit,
  onSetStatus,
  onReorder,
  onError,
}: {
  item: FocusItem;
  horizon: FocusHorizon;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (
    item: FocusItem,
    input: FocusFormInput,
  ) => Promise<ActionResult<null>>;
  onSetStatus: (item: FocusItem, status: FocusStatus) => void;
  onReorder: (
    horizon: FocusHorizon,
    item: FocusItem,
    direction: "up" | "down",
  ) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleEdit(formData: FormData) {
    setFieldErrors({});
    startTransition(async () => {
      const result = await onEdit(item, readFormInput(formData));
      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else onError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-line bg-surface p-3.5 shadow-note">
        <form action={handleEdit} className="flex flex-col gap-3">
          <TextField
            label="Title"
            name="title"
            defaultValue={item.title}
            required
            error={fieldErrors.title}
          />
          <TextAreaField
            label="Notes"
            name="description"
            rows={2}
            defaultValue={item.description ?? ""}
            error={fieldErrors.description}
          />
          <TextField
            label="Target date"
            name="targetDate"
            type="date"
            defaultValue={item.target_date ?? ""}
            error={fieldErrors.targetDate}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={isPending}>
              Save
            </Button>
          </div>
        </form>
      </li>
    );
  }

  const done = item.status === "completed";

  return (
    <li
      className={cn(
        "group rounded-lg border border-line bg-surface p-3.5 shadow-note transition-colors hover:border-line-soft",
        done && "opacity-65",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={cn(
            "text-[15px] font-medium text-ink",
            done && "line-through",
          )}
        >
          {item.title}
        </p>
        {item.status !== "active" && <Badge>{STATUS_LABEL[item.status]}</Badge>}
      </div>
      {item.description && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">
          {item.description}
        </p>
      )}
      {item.target_date && (
        <p className="mt-1 text-[12px] text-faint">
          Target {formatDateOnly(item.target_date)}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <div className="mr-1 flex items-center">
          <IconButton
            label="Move up"
            disabled={isFirst}
            onClick={() => onReorder(horizon, item, "up")}
            className="size-7"
          >
            <ChevronUp aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton
            label="Move down"
            disabled={isLast}
            onClick={() => onReorder(horizon, item, "down")}
            className="size-7"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </IconButton>
        </div>

        <TextAction label="Edit" onClick={() => setEditing(true)} />
        {item.status === "active" && (
          <TextAction
            icon={<Pause aria-hidden className="size-3.5" />}
            label="Pause"
            onClick={() => onSetStatus(item, "paused")}
          />
        )}
        {item.status === "paused" && (
          <TextAction
            icon={<Play aria-hidden className="size-3.5" />}
            label="Resume"
            onClick={() => onSetStatus(item, "active")}
          />
        )}
        {done ? (
          <TextAction
            icon={<RotateCcw aria-hidden className="size-3.5" />}
            label="Reopen"
            onClick={() => onSetStatus(item, "active")}
          />
        ) : (
          <TextAction
            icon={<CircleCheck aria-hidden className="size-3.5" />}
            label="Complete"
            onClick={() => onSetStatus(item, "completed")}
          />
        )}
        <TextAction label="Archive" onClick={() => setConfirmArchive(true)} />
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this focus?"
        description={`"${item.title}" moves to your archived list. You can reopen it later.`}
        confirmLabel="Archive"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          onSetStatus(item, "archived");
        }}
      />
    </li>
  );
}

function TextAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-45"
    >
      {icon}
      {label}
    </button>
  );
}

function ReopenButton({
  item,
  onSetStatus,
}: {
  item: FocusItem;
  onSetStatus: (item: FocusItem, status: FocusStatus) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSetStatus(item, "active")}
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] font-medium text-muted hover:text-ink disabled:opacity-45"
    >
      <RotateCcw aria-hidden className="size-3.5" />
      Reopen
    </button>
  );
}
