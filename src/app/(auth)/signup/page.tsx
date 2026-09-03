import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="Create your space"
      heading="Make room for what matters."
      subtitle="Create your account and begin with a clearer view of your day."
    >
      <SignupForm />
    </AuthShell>
  );
}
