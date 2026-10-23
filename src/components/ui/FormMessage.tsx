import { CheckCircle2, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils/cn";

interface FormMessageProps {
  tone: "error" | "success";
  children: React.ReactNode;
  className?: string;
}

export function FormMessage({ tone, children, className }: FormMessageProps) {
  const Icon = tone === "error" ? CircleAlert : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "error"
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-evergreen/25 bg-evergreen-soft text-evergreen",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
