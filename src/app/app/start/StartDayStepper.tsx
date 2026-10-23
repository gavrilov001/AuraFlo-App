import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const STEPS = [
  { label: "Clear the inbox" },
  { label: "Shape the day" },
  { label: "Ready" },
];

export function StartDayStepper({
  current,
  progress,
}: {
  current: 0 | 1 | 2;
  progress?: { reviewed: number; total: number };
}) {
  const showProgress = current === 0 && progress && progress.total > 0;
  const pct = showProgress
    ? Math.round((progress.reviewed / progress.total) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Mobile: compact */}
      <p className="text-[13px] text-muted sm:hidden">
        Step {current + 1} of 3 &middot;{" "}
        <span className="font-medium text-ink">{STEPS[current].label}</span>
      </p>

      {/* Desktop: full stepper */}
      <ol className="hidden items-center sm:flex" aria-label="Start my day progress">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "active" : "next";
          return (
            <li
              key={step.label}
              className={cn("flex items-center", i < 2 && "flex-1")}
            >
              <div
                className="flex shrink-0 items-center gap-2.5"
                aria-current={state === "active" ? "step" : undefined}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full border text-[12px] font-semibold",
                    state === "done" &&
                      "border-gold bg-gold/15 text-gold-dark",
                    state === "active" &&
                      "border-gold bg-gold text-navy-900",
                    state === "next" && "border-line text-faint",
                  )}
                >
                  {state === "done" ? (
                    <Check aria-hidden className="size-3.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "text-[14px]",
                    state === "active"
                      ? "font-medium text-ink"
                      : state === "done"
                        ? "text-body"
                        : "text-faint",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < 2 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-3 h-px flex-1",
                    i < current ? "bg-gold/50" : "bg-line",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      {showProgress && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-muted">
            {progress!.reviewed} of {progress!.total} thoughts reviewed
          </p>
          <div className="h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-line-soft">
            <div
              role="progressbar"
              aria-valuenow={progress!.reviewed}
              aria-valuemin={0}
              aria-valuemax={progress!.total}
              aria-label="Thoughts reviewed"
              className="h-full rounded-full bg-gold transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
