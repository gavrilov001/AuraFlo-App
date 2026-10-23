"use client";

import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils/cn";

const controlClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-subtle shadow-soft transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen " +
  "aria-[invalid=true]:border-danger disabled:opacity-60";

interface FieldShellProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function FieldShell({ label, htmlFor, error, hint, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-ink-muted">{hint}</p>
      )}
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, hint, id, className, ...props }, ref) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint}>
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(controlClass, className)}
          {...props}
        />
      </FieldShell>
    );
  },
);

export interface TextAreaFieldProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  TextAreaFieldProps
>(function TextAreaField({ label, error, hint, id, className, ...props }, ref) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint}>
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cn(controlClass, "min-h-24 resize-y", className)}
        {...props}
      />
    </FieldShell>
  );
});

export interface SelectFieldProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, error, hint, id, className, children, ...props },
    ref,
  ) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell label={label} htmlFor={fieldId} error={error} hint={hint}>
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn(controlClass, "pr-8", className)}
          {...props}
        >
          {children}
        </select>
      </FieldShell>
    );
  },
);

export { controlClass };
