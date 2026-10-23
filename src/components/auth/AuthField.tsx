"use client";

import { useId } from "react";

import { cn } from "@/lib/utils/cn";
import styles from "@/components/welcome/welcome.module.css";

interface AuthFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function AuthField({
  label,
  error,
  id,
  className,
  ...props
}: AuthFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;

  return (
    <div>
      <label htmlFor={fieldId} className={styles.authLabel}>
        {label}
      </label>
      <input
        id={fieldId}
        className={cn(styles.authInput, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <p id={errorId} className={styles.authError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
