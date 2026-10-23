import type { Metadata } from "next";
import { ListChecks } from "lucide-react";

import { ComingNextPhase } from "@/components/app-shell/ComingNextPhase";

export const metadata: Metadata = { title: "All Tasks" };

export default function AllTasksPage() {
  return (
    <ComingNextPhase
      title="All Tasks"
      summary="Everything you've committed to, in one place."
      icon={<ListChecks aria-hidden className="size-6" />}
      points={[
        "Group by Today, Scheduled, Delegated, and Someday",
        "Filter by category or the focus it supports",
        "Reschedule, complete, or hand off without losing context",
      ]}
    />
  );
}
