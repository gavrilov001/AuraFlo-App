"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import type { CategoryOption } from "@/lib/data/categories";
import { createCaptureAction } from "./actions";

const PLACEHOLDER = "Drop a thought, task, or reminder…";

export function CaptureComposer({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSubmitted = useRef<string>("");

  function submit() {
    const trimmed = content.trim();
    if (!trimmed || isPending) return;
    // Guard against an accidental double submit of the same thought.
    if (trimmed === lastSubmitted.current) return;

    setError(null);
    const token = crypto.randomUUID();

    startTransition(async () => {
      const result = await createCaptureAction({
        content: trimmed,
        categoryId: categoryId || null,
        clientToken: token,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      lastSubmitted.current = trimmed;
      setContent("");
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
      router.refresh();
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section
      aria-label="New capture"
      className="rounded-lg border border-border bg-surface p-4 shadow-soft"
    >
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder={PLACEHOLDER}
        aria-label="Capture a thought"
        className="w-full resize-y rounded-md border-0 bg-transparent p-1 text-[15px] leading-relaxed text-ink placeholder:text-ink-subtle focus-visible:outline-none"
      />

      {error && (
        <div className="mt-2">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {categories.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <span className="sr-only sm:not-sr-only">Category</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-ink"
              >
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span
            aria-live="polite"
            className="flex items-center gap-1 text-xs text-evergreen"
          >
            {justSaved && (
              <>
                <Check aria-hidden className="size-3.5" />
                Captured
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-subtle sm:inline">
            Enter to save · Shift+Enter for a new line
          </span>
          <Button
            onClick={submit}
            loading={isPending}
            disabled={!content.trim()}
            size="sm"
          >
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}
