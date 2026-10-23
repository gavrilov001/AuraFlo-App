"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { controlClass } from "./Field";

export interface PasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  hint?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, error, hint, id, className, ...props }, ref) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const [visible, setVisible] = useState(false);

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-ink">
          {label}
        </label>
        <div className="relative">
          <input
            ref={ref}
            id={fieldId}
            type={visible ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            className={cn(controlClass, "pr-10", className)}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted hover:text-ink"
          >
            {visible ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        </div>
        {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
        {error && (
          <p className="text-xs font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
