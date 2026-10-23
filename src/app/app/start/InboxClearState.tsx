"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";
import { goToShapeDayAction } from "./actions";

export function InboxClearState({
  planId,
  hadNone,
}: {
  planId: string;
  hadNone: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function shapeDay() {
    startTransition(async () => {
      const result = await goToShapeDayAction({ planId });
      if (!result.ok) {
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-xl rounded-xl border border-line bg-surface p-6 shadow-note sm:p-8">
      <h2 className="text-[19px] font-semibold text-ink">
        {hadNone ? "Nothing waiting in your inbox." : "Your inbox is clear."}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Now let&rsquo;s decide what deserves your attention today.
      </p>
      <div className="mt-5">
        <Button onClick={shapeDay} loading={isPending}>
          Shape my day
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
      <noscript>
        <FormMessage tone="error" className="mt-3">
          JavaScript is required to continue.
        </FormMessage>
      </noscript>
    </div>
  );
}
