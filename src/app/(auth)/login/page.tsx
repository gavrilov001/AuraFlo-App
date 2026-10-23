import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const redirectTo =
    typeof params.redirectTo === "string" ? params.redirectTo : undefined;
  // Set by /auth/callback when a recovery/magic link is invalid, expired,
  // or already used — surfaced here instead of silently dropping the user
  // on a plain sign-in page with no explanation.
  const callbackError =
    typeof params.error === "string" ? params.error : undefined;

  return (
    <AuthShell
      eyebrow="Welcome back"
      heading="Continue your flow."
      subtitle="Sign in to pick up where you left off."
    >
      <LoginForm redirectTo={redirectTo} callbackError={callbackError} />
    </AuthShell>
  );
}
