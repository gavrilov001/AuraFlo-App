"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { NavTabs } from "@/components/ui/NavTabs";
import { EmptyState } from "@/components/ui/Surface";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import type { CategoryOption } from "@/lib/data/categories";
import type { FocusOption } from "@/lib/data/start-day";
import type {
  CaptureCounts,
  CaptureListResult,
  CaptureWithCategory,
} from "@/lib/data/captures";
import type { ListCapturesInput } from "@/lib/validation/captures";
import { TaskPanel, type Mode as TaskPanelMode } from "../tasks/TaskPanel";
import { taskDetailAction } from "../tasks/actions";
import { CaptureComposer, type CaptureInput } from "./CaptureComposer";
import { CaptureList } from "./CaptureList";
import {
  archiveCaptureAction,
  copyCaptureToInboxAction,
  createCaptureAction,
  deleteCaptureAction,
  deleteCapturesBulkAction,
  discardCaptureAction,
  restoreCaptureAction,
} from "./actions";

const FILTERS = [
  { key: "inbox", label: "Inbox" },
  { key: "processed", label: "Processed" },
  { key: "archived", label: "Archived" },
  { key: "discarded", label: "Discarded" },
] as const;

const EMPTY: Record<string, { title: string; description: string }> = {
  inbox: {
    title: "Your mind is clear — for now.",
    description:
      "When something comes up, capture it here without stopping to organize it.",
  },
  processed: {
    title: "Nothing processed yet.",
    description:
      "Thoughts you turn into tasks through Start My Day are kept here as source records.",
  },
  archived: {
    title: "Nothing archived.",
    description: "Thoughts you set aside — hidden, never deleted — show up here.",
  },
  discarded: {
    title: "Nothing discarded.",
    description: "Thoughts you let go of stay here until you delete them.",
  },
};

export function CaptureBoard({
  result,
  counts,
  categories,
  focusItems,
  timezone,
  params,
}: {
  result: CaptureListResult;
  counts: CaptureCounts;
  categories: CategoryOption[];
  focusItems: FocusOption[];
  timezone: string;
  params: ListCapturesInput;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const filter = params.filter;

  // --- optimistic capture create (inbox only) ------------------------
  // Rapid captures each show instantly as a pending row; a single debounced
  // refresh reconciles them with the saved records once typing stops.
  const [pendingRows, setPendingRows] = useState<CaptureWithCategory[]>([]);
  const refreshTimer = useRef<number | undefined>(undefined);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      router.refresh();
    }, 650);
  }, [router]);

  function handleCapture(
    input: CaptureInput,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const category =
        categories.find((c) => c.id === input.categoryId) ?? null;
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;
      if (filter === "inbox") {
        setPendingRows((p) => [
          {
            id: tempId,
            workspace_id: "",
            created_by: null,
            content: input.content,
            notes: null,
            source: "manual",
            source_external_id: null,
            status: "inbox",
            category_id: input.categoryId || null,
            captured_at: now,
            processed_at: null,
            processed_in_daily_plan_id: null,
            archived_at: null,
            discarded_at: null,
            created_at: now,
            updated_at: now,
            category: category
              ? { id: category.id, name: category.name, color: category.color }
              : null,
            task: null,
          },
          ...p,
        ]);
      }
      void createCaptureAction({
        content: input.content,
        categoryId: input.categoryId || null,
        clientToken: crypto.randomUUID(),
      }).then((r) => {
        if (r.ok) {
          scheduleRefresh();
          resolve({ ok: true });
        } else {
          setPendingRows((p) => p.filter((x) => x.id !== tempId));
          resolve({ ok: false, error: r.error });
        }
      });
    });
  }

  // --- lifecycle mutations (optimistic remove-from-tab) --------------
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState(result);
  if (snapshot !== result) {
    setSnapshot(result);
    setHidden(new Set());
    setBusy(new Set());
    setSelected(new Set());
    setPendingRows([]);
  }

  function mark(id: string, on: boolean) {
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  function hide(id: string) {
    setHidden((s) => new Set(s).add(id));
  }
  function unhide(id: string) {
    setHidden((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  function run(
    id: string,
    action: Promise<{ ok: boolean; error?: string }>,
    opts: { onOk?: () => void } = {},
  ) {
    if (busy.has(id)) return;
    hide(id);
    mark(id, true);
    void action.then((r) => {
      mark(id, false);
      if (!r.ok) {
        unhide(id);
        toast.error(r.error ?? "That didn't work.");
        return;
      }
      opts.onOk?.();
      router.refresh();
    });
  }

  const archive = (id: string) =>
    run(id, archiveCaptureAction({ id }), {
      onOk: () =>
        toast.success("Archived.", { label: "Undo", onClick: () => restore(id) }),
    });
  const discard = (id: string) =>
    run(id, discardCaptureAction({ id }), {
      onOk: () =>
        toast.success("Moved to Discarded.", {
          label: "Undo",
          onClick: () => restore(id),
        }),
    });
  const restore = (id: string) => {
    if (busy.has(id)) return;
    hide(id);
    mark(id, true);
    void restoreCaptureAction({ id }).then((r) => {
      mark(id, false);
      if (!r.ok) {
        unhide(id);
        toast.error(r.error);
        return;
      }
      toast.success(
        r.data.status === "processed"
          ? "Restored to Processed."
          : "Restored to your inbox.",
      );
      router.refresh();
    });
  };
  const copyToInbox = (id: string) => {
    if (busy.has(id)) return;
    mark(id, true);
    void copyCaptureToInboxAction({ id }).then((r) => {
      mark(id, false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Copied to your inbox as a new thought.");
      router.refresh();
    });
  };

  // --- permanent delete -------------------------------------------
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState("");

  function confirmDelete() {
    const id = deleteId;
    if (!id) return;
    setDeleteId(null);
    run(id, deleteCaptureAction({ id }), {
      onOk: () => toast.success("Permanently deleted."),
    });
  }
  function confirmBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    startTransition(async () => {
      const r = await deleteCapturesBulkAction({ ids, confirm: bulkConfirm });
      setBulkOpen(false);
      setBulkConfirm("");
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      ids.forEach(hide);
      setSelected(new Set());
      toast.success(`Deleted ${r.data.deleted}.`);
      router.refresh();
    });
  }

  // --- linked task panel -----------------------------------------
  const [panelMode, setPanelMode] = useState<TaskPanelMode | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  function openTask(taskId: string) {
    setPanelLoading(true);
    void taskDetailAction(taskId).then((r) => {
      setPanelLoading(false);
      if (r.ok) setPanelMode({ kind: "edit", task: r.data.detail });
      else toast.error("Original task is no longer available.");
    });
  }

  // --- URL helpers ---------------------------------------------
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

  const [q, setQ] = useState(params.q);
  useEffect(() => {
    // Only push to the URL when the typed value actually diverges from what the
    // server rendered — avoids a mount-time replace that would strip ?page.
    if (q === params.q) return;
    const id = window.setTimeout(() => setParam({ q: q || null }), 280);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, params.q]);

  function tabHref(key: string): string {
    return key === "inbox" ? "/app/capture" : `/app/capture?filter=${key}`;
  }

  const savedIds = new Set(result.captures.map((c) => c.id));
  const visible = [
    ...pendingRows.filter((p) => !savedIds.has(p.id)),
    ...result.captures,
  ].filter((c) => !hidden.has(c.id));
  const showToolbar = filter !== "inbox";
  const bulkEnabled = filter === "archived" || filter === "discarded";

  const displayCounts: CaptureCounts =
    filter === "inbox" && pendingRows.length > 0
      ? { ...counts, inbox: counts.inbox + pendingRows.length }
      : counts;

  return (
    <div className="flex flex-col gap-6">
      <NavTabs
        label="Filter thoughts"
        activeKey={filter}
        tabs={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          count: displayCounts[f.key],
          href: tabHref(f.key),
        }))}
      />

      {filter === "inbox" && (
        <CaptureComposer categories={categories} onCapture={handleCapture} />
      )}

      {showToolbar && (
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
              placeholder="Search these thoughts…"
              aria-label="Search thoughts"
              className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </div>
          <label className="flex items-center">
            <span className="sr-only">Category</span>
            <select
              value={params.category}
              onChange={(e) => setParam({ category: e.target.value || null })}
              aria-label="Category filter"
              className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            >
              <option value="">All categories</option>
              <option value="none">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-faint">
            <span className="sr-only sm:not-sr-only">From</span>
            <input
              type="date"
              value={params.from ?? ""}
              onChange={(e) => setParam({ from: e.target.value || null })}
              aria-label="From date"
              className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-faint">
            <span className="sr-only sm:not-sr-only">To</span>
            <input
              type="date"
              value={params.to ?? ""}
              onChange={(e) => setParam({ to: e.target.value || null })}
              aria-label="To date"
              className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </label>
        </div>
      )}

      {bulkEnabled && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 shadow-pop">
          <span className="text-[13px] font-medium text-ink">
            {selected.size} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setBulkOpen(true)}
            >
              Delete permanently
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={EMPTY[filter].title}
          description={EMPTY[filter].description}
        />
      ) : (
        <>
          <CaptureList
            filter={filter}
            captures={visible}
            categories={categories}
            timezone={timezone}
            busy={busy}
            bulkEnabled={bulkEnabled}
            selected={selected}
            onToggleSelect={(id) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onArchive={archive}
            onDiscard={discard}
            onRestore={restore}
            onCopyToInbox={copyToInbox}
            onDelete={setDeleteId}
            onOpenTask={openTask}
            taskLoading={panelLoading}
            onSaved={() => router.refresh()}
          />
          {result.hasMore && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  startTransition(() =>
                    setParam({ page: String(params.page + 1) }),
                  )
                }
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Permanently delete this thought?"
        description="This cannot be undone. Any task created from this thought will remain, but the original Dream Catcher record and its history will be removed."
        confirmLabel="Delete permanently"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={confirmDelete}
      />

      <BulkDeleteDialog
        open={bulkOpen}
        count={selected.size}
        value={bulkConfirm}
        onChange={setBulkConfirm}
        onCancel={() => {
          setBulkOpen(false);
          setBulkConfirm("");
        }}
        onConfirm={confirmBulkDelete}
      />

      <TaskPanel
        mode={panelMode}
        categories={categories}
        focusItems={focusItems}
        onClose={() => setPanelMode(null)}
        onDone={() => {
          setPanelMode(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function BulkDeleteDialog({
  open,
  count,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  value: string;
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
      aria-label="Permanently delete thoughts"
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
        <h2 className="text-lg font-semibold text-ink">
          Permanently delete {count}{" "}
          {count === 1 ? "thought" : "thoughts"}?
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          This cannot be undone. Any tasks created from these thoughts will
          remain, but the original Dream Catcher records and their history will
          be removed.
        </p>
        <label className="text-[13px] font-medium text-body">
          Type <span className="font-mono">DELETE</span> to confirm
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            className={cn(
              "mt-1 h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px]",
              "text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30",
            )}
          />
        </label>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={value !== "DELETE"}
            onClick={onConfirm}
          >
            Delete permanently
          </Button>
        </div>
      </div>
    </dialog>
  );
}
