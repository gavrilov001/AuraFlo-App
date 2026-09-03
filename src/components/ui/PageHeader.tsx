import { cn } from "@/lib/utils/cn";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Small planned/coming label rendered quietly after the title. */
  note?: string;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  note,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[clamp(2.125rem,1.7rem+1.3vw,2.625rem)] font-semibold leading-tight tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {note && <span className="text-[13px] text-faint">{note}</span>}
      </div>
      {subtitle && (
        <p className="max-w-2xl text-[16px] leading-relaxed text-muted">
          {subtitle}
        </p>
      )}
    </header>
  );
}
