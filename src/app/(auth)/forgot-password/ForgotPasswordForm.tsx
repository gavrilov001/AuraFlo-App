"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";

import { requestPasswordResetAction } from "../actions";
import { AuthField } from "@/components/auth/AuthField";
import styles from "@/components/welcome/welcome.module.css";

const COOLDOWN_SECONDS = 30;
const COOLDOWN_STORAGE_KEY = "auraflo:lastPasswordResetRequestAt";

/**
 * Client-side-only spam guard: disables the button for a short window after
 * a request, surviving a page reload via localStorage. This is a courtesy
 * on top of — not a replacement for — Supabase's own server-side rate
 * limiting on `resetPasswordForEmail`, which is the actual enforcement
 * layer and can't be bypassed by clearing local storage.
 */
function useResendCooldown(): [number, () => void] {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(COOLDOWN_STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode, etc.) — fall back to no cooldown.
      return;
    }
    const lastAt = raw ? Number(raw) : 0;
    const tick = () => {
      const elapsed = (Date.now() - lastAt) / 1000;
      const left = Math.max(0, Math.ceil(COOLDOWN_SECONDS - elapsed));
      setRemaining(left);
      if (left <= 0) clearInterval(interval);
    };
    // `interval` must be assigned before the first `tick()` call, since a
    // just-expired cooldown clears it on that very first call.
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, []);

  function start() {
    try {
      window.localStorage.setItem(COOLDOWN_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore — cooldown is best-effort only.
    }
    setRemaining(COOLDOWN_SECONDS);
  }

  return [remaining, start];
}

function SubmitButton({ cooldown }: { cooldown: number }) {
  const { pending } = useFormStatus();
  const disabled = pending || cooldown > 0;
  return (
    <button
      type="submit"
      className={`${styles.btnPrimary} ${styles.btnBlock}`}
      disabled={disabled}
      aria-busy={pending || undefined}
    >
      {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {cooldown > 0 ? `Try again in ${cooldown}s` : "Send reset link"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordResetAction,
    null,
  );
  const [cooldown, startCooldown] = useResendCooldown();

  useEffect(() => {
    if (state?.ok && state.data.sent) startCooldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state?.ok && state.data.sent) {
    return (
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <MailCheck aria-hidden className="size-8" style={{ color: "var(--gold-light)" }} />
        <p className={styles.authSubtitle} style={{ margin: 0 }}>
          If an account exists for that email, a reset link is on its way.
          Check your inbox (and spam folder).
        </p>
        <p className={styles.authSubtitle} style={{ margin: 0, fontSize: "0.85rem" }}>
          {cooldown > 0
            ? `You can request another link in ${cooldown}s.`
            : "Didn't get it? You can request another link now."}
        </p>
      </div>
    );
  }

  const fieldErrors = state?.ok === false ? state.fieldErrors : undefined;
  const formError =
    state?.ok === false && !state.fieldErrors ? state.error : undefined;

  return (
    <>
      <form action={formAction} className={styles.authForm} noValidate>
        {formError && (
          <p className={styles.authAlert} role="alert">
            {formError}
          </p>
        )}

        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors?.email}
        />

        <SubmitButton cooldown={cooldown} />
      </form>

      <div className={styles.authLinks}>
        <Link href="/login" className={styles.authLinkBack}>
          <span aria-hidden>&larr;</span> Back to sign in
        </Link>
      </div>
    </>
  );
}
