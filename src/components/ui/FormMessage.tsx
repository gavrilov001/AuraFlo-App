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
        "flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm",
        tone === "error"
          ? "border-danger/25 bg-danger-soft text-danger"
          : "border-line bg-surface-soft text-ink",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success" && "text-gold-dark",
        )}
      />
      <span>{children}</span>
    </div>
  );
}
