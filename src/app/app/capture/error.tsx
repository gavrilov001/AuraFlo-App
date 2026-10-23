"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function CaptureError({
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
    <div className="flex flex-col items-start gap-3 py-14">
      <p className="text-[17px] font-semibold text-ink">
        We couldn&rsquo;t load your thoughts.
      </p>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted">
        Something went wrong fetching Dream Catcher. Try again.
      </p>
      <Button variant="secondary" size="sm" onClick={reset} className="mt-1">
        Retry
      </Button>
    </div>
  );
}
