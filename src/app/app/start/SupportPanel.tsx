import type { PlanCounts, ReviewCapture } from "@/lib/data/start-day";

const ROWS: { key: keyof PlanCounts; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "scheduled", label: "Scheduled" },
  { key: "delegated", label: "Delegated" },
  { key: "later", label: "Later" },
];

function shorten(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * One editorial supporting panel for Step 1: "Plan so far" counts (always
 * shown, including zeros) and a quiet, non-interactive "Coming up" preview,
 * separated by a divider.
 */
export function SupportPanel({
  counts,
  upcoming,
  remaining,
  className,
}: {
  counts: PlanCounts;
  upcoming: ReviewCapture[];
  remaining: number;
  className?: string;
}) {
  const more = remaining - 1 - upcoming.length;

  return (
    <section
      aria-label="Plan context"
      className={
        "rounded-lg border border-line-soft bg-surface-soft/50 p-4 " +
        (className ?? "")
      }
    >
      <h2 className="text-[13px] font-semibold text-ink">Plan so far</h2>
      <dl className="mt-2.5 flex flex-col gap-1.5">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between">
            <dt className="text-[13px] text-muted">{row.label}</dt>
            <dd className="text-[13px] font-medium tabular-nums text-ink">
              {counts[row.key]}
            </dd>
          </div>
        ))}
      </dl>

      <div className="my-3.5 border-t border-line-soft" />

      <h2 className="text-[13px] font-semibold text-ink">Coming up</h2>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This is the last thought in your inbox.
        </p>
      ) : (
        <>
          <ul className="mt-2.5 flex flex-col gap-2">
            {upcoming.map((t) => (
              <li key={t.id} className="text-[13px] leading-snug text-muted">
                <span className="block">{shorten(t.content)}</span>
                {t.category && (
                  <span className="mt-0.5 inline-block text-[11px] text-faint">
                    {t.category.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {more > 0 && (
            <p className="mt-2.5 text-[12px] text-faint">
              + {more} more after {more === 1 ? "this" : "these"}
            </p>
          )}
        </>
      )}
    </section>
  );
}
