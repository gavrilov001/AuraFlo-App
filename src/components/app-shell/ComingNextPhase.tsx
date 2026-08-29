import { EmptyState } from "@/components/ui/Surface";

interface ComingNextPhaseProps {
  title: string;
  summary: string;
  points: string[];
  icon: React.ReactNode;
}

export function ComingNextPhase({
  title,
  summary,
  points,
  icon,
}: ComingNextPhaseProps) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{summary}</p>
      </header>

      <EmptyState
        icon={icon}
        title="Coming in the next phase"
        description="This section isn't wired up yet. Here's what it will do:"
      />

      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <li
            key={point}
            className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-muted"
          >
            <span
              aria-hidden
              className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber"
            />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}
