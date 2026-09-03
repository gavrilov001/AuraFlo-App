"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import styles from "@/components/welcome/welcome.module.css";

interface AuthPasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
}

export function AuthPasswordField({
  label,
  error,
  id,
  ...props
}: AuthPasswordFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={fieldId} className={styles.authLabel}>
        {label}
      </label>
      <div className={styles.pwWrap}>
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          className={cn(styles.authInput, styles.hasToggle)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        <button
          type="button"
          className={styles.pwToggle}
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} className={styles.authError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
