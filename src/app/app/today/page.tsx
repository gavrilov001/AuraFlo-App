import type { Metadata } from "next";
import { Sun } from "lucide-react";

import { ComingNextPhase } from "@/components/app-shell/ComingNextPhase";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <ComingNextPhase
      title="Today"
      summary="Your focused view of what to do right now."
      icon={<Sun aria-hidden className="size-6" />}
      points={[
        "The three things that matter most today, front and center",
        "A calm list of everything else scheduled for today",
        "Quick check-off with progress that carries into tomorrow",
      ]}
    />
  );
}
