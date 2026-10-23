import type { Metadata } from "next";

import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Enter a new password for your account.
      </p>
      <div className="mt-6">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
