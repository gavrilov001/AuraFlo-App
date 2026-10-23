import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
      <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Enter your email and we&apos;ll send you a link to choose a new one.
      </p>

      <div className="mt-6">
        <ForgotPasswordForm />
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link href="/login" className="text-evergreen hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
