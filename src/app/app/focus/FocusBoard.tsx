"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { TextField, TextAreaField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { EmptyState } from "@/components/ui/Surface";
import { cn } from "@/lib/utils/cn";
import { formatDateOnly } from "@/lib/utils/datetime";
import type {
  FocusHorizon,
  FocusItem,
  FocusStatus,
} from "@/lib/types/database.types";
import type { FocusItemsByHorizon } from "@/lib/data/focus";
import {
  createFocusItemAction,
  reorderFocusItemAction,
  setFocusStatusAction,
  updateFocusItemAction,
} from "./actions";

const HORIZONS: {
  key: FocusHorizon;
  title: string;
  blurb: string;
}[] = [
  { key: "short", title: "Short term", blurb: "What matters now" },
  {
    key: "medium",
    title: "Medium term",
    blurb: "What you're building toward",
  },
  {
    key: "long",
    title: "Long term",
    blurb: "The direction you want to move toward",
  },
];

const STATUS_LABEL: Record<FocusStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Done",
  archived: "Archived",
};

export function FocusBoard({
  live,
  archived,
}: {
  live: FocusItemsByHorizon;
  archived: FocusItem[];
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {HORIZONS.map((horizon) => (
        <FocusSection
          key={horizon.key}
          horizon={horizon.key}
          title={horizon.title}
          blurb={horizon.blurb}
          items={live[horizon.key]}
          onError={setError}
        />
      ))}

      {archived.length > 0 && (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-muted">
            Archived ({archived.length})
          </summary>
          <ul className="flex flex-col gap-2 border-t border-border p-3">
            {archived.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="text-ink-muted line-through">{item.title}</span>
                <ReopenButton id={item.id} onError={setError} />
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
  blurb,
  items,
  onError,
}: {
  horizon: FocusHorizon;
  title: string;
  blurb: string;
  items: FocusItem[];
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby={`focus-${horizon}`} className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2
            id={`focus-${horizon}`}
            className="text-base font-semibold text-ink"
          >
            {title}
          </h2>
          <p className="text-xs text-ink-muted">{blurb}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
        >
          <Plus aria-hidden className="size-4" />
          Add
        </Button>
      </div>

      {adding && (
        <AddFocusForm
          horizon={horizon}
          onDone={() => setAdding(false)}
          onError={onError}
        />
      )}

      {items.length === 0 && !adding ? (
        <EmptyState
          title="Nothing here yet"
          description="Add one thing you want to keep in view."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <FocusItemCard
              key={item.id}
              item={item}
              horizon={horizon}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddFocusForm({
  horizon,
  onDone,
  onError,
}: {
  horizon: FocusHorizon;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(formData: FormData) {
    setFieldErrors({});
    startTransition(async () => {
      const result = await createFocusItemAction({
        title: formData.get("title"),
        description: formData.get("description") || null,
        horizon,
        targetDate: formData.get("targetDate") || null,
      });
      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else onError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form
      action={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border-strong bg-surface p-3 shadow-soft"
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
  onError,
}: {
  item: FocusItem;
  horizon: FocusHorizon;
  isFirst: boolean;
  isLast: boolean;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function run(promise: Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok && result.error) {
        onError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleEdit(formData: FormData) {
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateFocusItemAction({
        id: item.id,
        title: formData.get("title"),
        description: formData.get("description") || null,
        targetDate: formData.get("targetDate") || null,
      });
      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else onError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="rounded-md border border-border-strong bg-surface p-3 shadow-soft">
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

  return (
    <li
      className={cn(
        "rounded-md border border-border bg-surface p-3 shadow-soft",
        item.status === "completed" && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 pt-0.5">
          <button
            type="button"
            aria-label="Move up"
            disabled={isFirst || isPending}
            onClick={() =>
              run(
                reorderFocusItemAction({
                  id: item.id,
                  horizon,
                  direction: "up",
                }),
              )
            }
            className="text-ink-subtle hover:text-ink disabled:opacity-30"
          >
            <ChevronUp aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={isLast || isPending}
            onClick={() =>
              run(
                reorderFocusItemAction({
                  id: item.id,
                  horizon,
                  direction: "down",
                }),
              )
            }
            className="text-ink-subtle hover:text-ink disabled:opacity-30"
          >
            <ChevronDown aria-hidden className="size-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "text-sm font-medium text-ink",
                item.status === "completed" && "line-through",
              )}
            >
              {item.title}
            </p>
            {item.status !== "active" && (
              <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {STATUS_LABEL[item.status]}
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
              {item.description}
            </p>
          )}
          {item.target_date && (
            <p className="mt-1 text-xs text-ink-subtle">
              Target: {formatDateOnly(item.target_date)}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <CardAction label="Edit" onClick={() => setEditing(true)} />
            {item.status === "active" && (
              <CardAction
                icon={<Pause className="size-3.5" />}
                label="Pause"
                disabled={isPending}
                onClick={() =>
                  run(setFocusStatusAction({ id: item.id, status: "paused" }))
                }
              />
            )}
            {item.status === "paused" && (
              <CardAction
                icon={<Play className="size-3.5" />}
                label="Resume"
                disabled={isPending}
                onClick={() =>
                  run(setFocusStatusAction({ id: item.id, status: "active" }))
                }
              />
            )}
            {item.status !== "completed" ? (
              <CardAction
                icon={<CircleCheck className="size-3.5" />}
                label="Complete"
                disabled={isPending}
                onClick={() =>
                  run(
                    setFocusStatusAction({ id: item.id, status: "completed" }),
                  )
                }
              />
            ) : (
              <CardAction
                icon={<RotateCcw className="size-3.5" />}
                label="Reopen"
                disabled={isPending}
                onClick={() =>
                  run(setFocusStatusAction({ id: item.id, status: "active" }))
                }
              />
            )}
            <ArchiveAction
              disabled={isPending}
              onConfirm={() =>
                run(setFocusStatusAction({ id: item.id, status: "archived" }))
              }
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function CardAction({
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
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function ArchiveAction({
  onConfirm,
  disabled,
}: {
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-ink-muted">Archive?</span>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          disabled={disabled}
          className="rounded px-1.5 py-1 font-medium text-danger hover:bg-danger-soft"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-1 font-medium text-ink-muted hover:bg-surface-sunken"
        >
          No
        </button>
      </span>
    );
  }

  return (
    <CardAction label="Archive" onClick={() => setConfirming(true)} />
  );
}

function ReopenButton({
  id,
  onError,
}: {
  id: string;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await setFocusStatusAction({ id, status: "active" });
          if (!result.ok) {
            onError(result.error);
            return;
          }
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-evergreen hover:bg-evergreen-soft disabled:opacity-50"
    >
      <RotateCcw aria-hidden className="size-3.5" />
      Reopen
    </button>
  );
}
