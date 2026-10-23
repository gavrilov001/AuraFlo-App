"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils/cn";

type Tone = "default" | "danger";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: Tone;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, tone = "default", className, children, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted " +
            "transition-colors hover:bg-surface-hover hover:text-ink " +
            "disabled:cursor-not-allowed disabled:opacity-45",
          tone === "danger" && "hover:bg-danger-soft hover:text-danger",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
