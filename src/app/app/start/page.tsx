import type { Metadata } from "next";
import { Sunrise } from "lucide-react";

import { ComingNextPhase } from "@/components/app-shell/ComingNextPhase";

export const metadata: Metadata = { title: "Start My Day" };

export default function StartMyDayPage() {
  return (
    <ComingNextPhase
      title="Start My Day"
      summary="A short morning pass to clear your inbox and set your priorities."
      icon={<Sunrise aria-hidden className="size-6" />}
      points={[
        "Review new captures and turn the keepers into tasks",
        "Choose today's top three",
        "Begin the day with a plan you actually made",
      ]}
    />
  );
}
