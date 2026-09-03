"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import styles from "@/components/welcome/welcome.module.css";

export function AuthSubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`${styles.btnPrimary} ${styles.btnBlock}`}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
