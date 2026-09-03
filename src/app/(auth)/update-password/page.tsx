import type { Metadata } from "next";

import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="app-root flex min-h-dvh w-full flex-col justify-center bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-note">
        <h1 className="text-xl font-semibold text-ink">
          Choose a new password
        </h1>
        <p className="mt-1 text-sm text-muted">
          Enter a new password for your account.
        </p>
        <div className="mt-6">
          <UpdatePasswordForm />
        </div>
      </div>
    </div>
  );
}
