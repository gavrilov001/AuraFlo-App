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

  return (
    <AuthShell
      eyebrow="Welcome back"
      heading="Continue your flow."
      subtitle="Sign in to pick up where you left off."
    >
      <LoginForm redirectTo={redirectTo} />
    </AuthShell>
  );
}
