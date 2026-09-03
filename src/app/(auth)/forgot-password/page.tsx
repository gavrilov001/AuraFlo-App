import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="app-root flex min-h-dvh w-full flex-col justify-center bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-note">
        <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your email and we&apos;ll send you a link to choose a new one.
        </p>

        <div className="mt-6">
          <ForgotPasswordForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="text-ink hover:text-gold-dark">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
