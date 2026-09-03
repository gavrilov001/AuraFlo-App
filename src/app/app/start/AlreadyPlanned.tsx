"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { adjustPlanAction } from "./actions";

export function AlreadyPlanned({
  planId,
  autoAdjust = false,
  canAdjust = true,
}: {
  planId: string;
  autoAdjust?: boolean;
  canAdjust?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fired = useRef(false);

  useEffect(() => {
    if (autoAdjust && !fired.current) {
      fired.current = true;
      startTransition(async () => {
        await adjustPlanAction({ planId });
        router.refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdjust]);

  if (autoAdjust) {
    return (
      <p className="text-[14px] text-muted">Opening your plan to adjust…</p>
    );
  }

  return (
    <div className="max-w-xl rounded-xl border border-line bg-surface p-6 shadow-note sm:p-8">
      <h2 className="text-[19px] font-semibold text-ink">
        Your day is already planned.
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        You started today with a plan. Open it in Today, or reopen the planning
        flow to change anything.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Link
          href="/app/today"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-navy-900 px-5 text-[15px] font-medium text-cream transition-colors hover:bg-navy-800"
        >
          View today
        </Link>
        {canAdjust && (
          <Link
            href="/app/start?mode=adjust"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface px-5 text-[15px] font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            Adjust plan
          </Link>
        )}
      </div>
    </div>
  );
}
