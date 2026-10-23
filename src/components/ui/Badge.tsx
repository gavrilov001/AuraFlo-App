import { cn } from "@/lib/utils/cn";

/**
 * Quiet status text. Not a pill — just small muted text with an optional
 * subtle warm background for statuses that need a touch more weight.
 */
export function Badge({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "soft";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[12px] font-medium",
        tone === "muted"
          ? "text-faint"
          : "rounded border border-line-soft bg-surface-soft px-1.5 py-0.5 text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
