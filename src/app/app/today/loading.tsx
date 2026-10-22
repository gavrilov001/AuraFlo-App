import { Skeleton } from "@/components/ui/Skeleton";

export default function TodayLoading() {
  return (
    <div
      className="mx-auto w-full max-w-[1320px]"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="mb-6 h-4 w-40" />
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
