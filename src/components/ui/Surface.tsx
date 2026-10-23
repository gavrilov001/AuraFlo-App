import { cn } from "@/lib/utils/cn";

/** A cream working surface with a warm hairline border. Use only where
 *  containment is genuinely useful (forms, grouped content). */
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-note",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** A quiet editorial empty state — sits directly on the page, no big panel. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-2 py-10", className)}>
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-[17px] font-semibold text-ink">{title}</p>
      {description && (
        <p className="max-w-md text-[15px] leading-relaxed text-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
