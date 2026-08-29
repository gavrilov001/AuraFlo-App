import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./LoginForm";
import { FormMessage } from "@/components/ui/FormMessage";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const redirectTo =
    typeof params.redirectTo === "string" ? params.redirectTo : undefined;
  const linkError =
    typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
      <h1 className="text-xl font-semibold text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign in to reach your Dream Catcher.
      </p>

      {linkError && (
        <div className="mt-4">
          <FormMessage tone="error">{linkError}</FormMessage>
        </div>
      )}

      <div className="mt-6">
        <LoginForm redirectTo={redirectTo} />
      </div>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          href="/forgot-password"
          className="text-evergreen hover:underline"
        >
          Forgot password?
        </Link>
        <span className="text-ink-muted">
          New here?{" "}
          <Link href="/signup" className="text-evergreen hover:underline">
            Create an account
          </Link>
        </span>
      </div>
    </div>
  );
}
