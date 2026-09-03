import { PageHeader } from "@/components/ui/PageHeader";

interface PlannedPageProps {
  title: string;
  description: string;
  points: string[];
}

/** Quiet editorial placeholder for routes whose feature isn't built yet. */
export function ComingNextPhase({
  title,
  description,
  points,
}: PlannedPageProps) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={title} subtitle={description} note="Planned" />

      <div className="border-t border-line-soft pt-6">
        <p className="text-[15px] text-muted">
          This part of AuraFlo isn&rsquo;t here yet. When it arrives, it will:
        </p>
        <ul className="mt-3 flex max-w-xl flex-col gap-2.5">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-3 text-[15px] text-body"
            >
              <span
                aria-hidden
                className="mt-2 size-1 shrink-0 rounded-full bg-faint"
              />
              {point}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
