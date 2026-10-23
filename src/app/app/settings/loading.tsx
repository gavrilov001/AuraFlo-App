import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div
      className="flex max-w-[800px] flex-col gap-2"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="mt-6 flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-t border-line-soft py-8">
            <Skeleton className="h-11 w-full max-w-sm rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
