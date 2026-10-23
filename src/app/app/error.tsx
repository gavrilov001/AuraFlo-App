"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

export default function AppError({
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
    <div className="flex flex-col items-start gap-3 border-t border-line-soft py-14">
      <p className="text-[17px] font-semibold text-ink">
        Something went wrong here.
      </p>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted">
        This page hit an unexpected error. Try again — if it keeps happening,
        reload AuraFlo.
      </p>
      <Button variant="secondary" size="sm" onClick={reset} className="mt-1">
        Try again
      </Button>
    </div>
  );
}
