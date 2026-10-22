import { Skeleton } from "@/components/ui/Skeleton";

export default function StartDayLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
