"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import type { CategoryOption } from "@/lib/data/categories";

const PLACEHOLDER = "What's on your mind?";

export interface CaptureInput {
  content: string;
  categoryId: string;
}

export function CaptureComposer({
  categories,
  onCapture,
}: {
  categories: CategoryOption[];
  onCapture: (input: CaptureInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [content, setContent] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSubmitted = useRef<string>("");

  function submit() {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    if (trimmed === lastSubmitted.current) return;

    setError(null);
    lastSubmitted.current = trimmed;
    // Optimistic: clear the field immediately and keep capturing.
    setContent("");
    setBusy(true);
    textareaRef.current?.focus();

    void onCapture({ content: trimmed, categoryId }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        // Restore the text so nothing is lost.
        setContent((current) => current || trimmed);
        lastSubmitted.current = "";
        setError(result.error ?? "We couldn't save that capture.");
        return;
      }
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
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
      aria-label="Quick capture"
      className="rounded-xl border border-line bg-surface p-[22px] shadow-note sm:p-6"
    >
      <h2 className="text-sm font-semibold text-ink">Quick capture</h2>

      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDER}
        aria-label="Capture a thought"
        className="mt-3 min-h-[104px] w-full resize-y rounded-md border border-line-soft bg-surface-soft px-3.5 py-3 text-[16px] leading-relaxed text-ink placeholder:text-faint transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 sm:min-h-[116px] [color-scheme:light]"
      />

      {error && (
        <div className="mt-2.5">
          <FormMessage tone="error">{error}</FormMessage>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {categories.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <span className="sr-only sm:not-sr-only">Category</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 [color-scheme:light]"
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
            className="flex items-center gap-1 text-[13px] text-gold-dark"
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
          <span className="hidden text-[13px] text-faint sm:inline">
            Enter to capture · Shift+Enter for a new line
          </span>
          <Button onClick={submit}>Capture</Button>
        </div>
      </div>
    </section>
  );
}
