"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col items-start gap-3 py-14">
      <p className="text-[17px] font-semibold text-ink">
        We couldn&rsquo;t load your tasks.
      </p>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted">
        Something went wrong fetching this list. Try again.
      </p>
      <Button variant="secondary" size="sm" onClick={reset} className="mt-1">
        Retry
      </Button>
    </div>
  );
}
