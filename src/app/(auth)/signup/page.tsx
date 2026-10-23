import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
      <h1 className="text-xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Start capturing thoughts in seconds.
      </p>

      <div className="mt-6">
        <SignupForm />
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-evergreen hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
