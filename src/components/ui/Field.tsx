"use client";

import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils/cn";

const controlClass =
  "w-full rounded-md border border-line bg-surface px-3 text-[15px] text-ink " +
  "placeholder:text-faint transition-colors [color-scheme:light] " +
  "focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 " +
  "aria-[invalid=true]:border-danger disabled:opacity-60";

const inputHeight = "h-11";

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
      {hint && !error && <p className="text-[13px] text-muted">{hint}</p>}
      {error && (
        <p
          id={`${htmlFor}-error`}
          className="text-[13px] font-medium text-danger"
          role="alert"
        >
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
          className={cn(controlClass, inputHeight, className)}
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
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cn(
          controlClass,
          "min-h-24 py-2.5 leading-relaxed resize-y",
          className,
        )}
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
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(controlClass, inputHeight, "pr-9", className)}
          {...props}
        >
          {children}
        </select>
      </FieldShell>
    );
  },
);

export { controlClass };
