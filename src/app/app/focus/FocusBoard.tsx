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

export function FocusBoard({
  live,
  archived,
}: {
  live: FocusItemsByHorizon;
  archived: FocusItem[];
}) {
  const toast = useToast();
  const onError = (message: string) => toast.error(message);

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
            items={live[horizon.key]}
            onError={onError}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <details className="border-t border-line-soft pt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
            Archived ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5">
            {archived.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-faint line-through">{item.title}</span>
                <ReopenButton id={item.id} onError={onError} />
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
  onError,
}: {
  horizon: FocusHorizon;
  title: string;
  label: string;
  blurb: string;
  items: FocusItem[];
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
  const [confirmArchive, setConfirmArchive] = useState(false);
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
            className="size-7"
          >
            <ChevronUp aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton
            label="Move down"
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
            disabled={isPending}
            onClick={() =>
              run(setFocusStatusAction({ id: item.id, status: "paused" }))
            }
          />
        )}
        {item.status === "paused" && (
          <TextAction
            icon={<Play aria-hidden className="size-3.5" />}
            label="Resume"
            disabled={isPending}
            onClick={() =>
              run(setFocusStatusAction({ id: item.id, status: "active" }))
            }
          />
        )}
        {done ? (
          <TextAction
            icon={<RotateCcw aria-hidden className="size-3.5" />}
            label="Reopen"
            disabled={isPending}
            onClick={() =>
              run(setFocusStatusAction({ id: item.id, status: "active" }))
            }
          />
        ) : (
          <TextAction
            icon={<CircleCheck aria-hidden className="size-3.5" />}
            label="Complete"
            disabled={isPending}
            onClick={() =>
              run(setFocusStatusAction({ id: item.id, status: "completed" }))
            }
          />
        )}
        <TextAction
          label="Archive"
          disabled={isPending}
          onClick={() => setConfirmArchive(true)}
        />
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this focus?"
        description={`"${item.title}" moves to your archived list. You can reopen it later.`}
        confirmLabel="Archive"
        loading={isPending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          run(setFocusStatusAction({ id: item.id, status: "archived" }));
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
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] font-medium text-muted hover:text-ink disabled:opacity-45"
    >
      <RotateCcw aria-hidden className="size-3.5" />
      Reopen
    </button>
  );
}
