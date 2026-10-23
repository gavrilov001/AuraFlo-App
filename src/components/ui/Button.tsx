"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-evergreen";

const variants: Record<Variant, string> = {
  primary:
    "bg-evergreen text-on-evergreen hover:bg-evergreen-hover disabled:hover:bg-evergreen",
  secondary:
    "border border-border-strong bg-surface text-ink hover:bg-surface-sunken",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  danger:
    "border border-danger/30 bg-danger-soft text-danger hover:bg-danger hover:text-white",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
