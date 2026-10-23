import { cn } from "@/lib/utils/cn";

/** Warm shimmer placeholder. The global reduced-motion rule flattens it. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-soft",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:bg-gradient-to-r after:from-transparent after:via-white/50 after:to-transparent",
        "after:animate-[app-shimmer_1.6s_infinite]",
        className,
      )}
    />
  );
}
