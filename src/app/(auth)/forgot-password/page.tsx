import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Forgot password"
      heading="Let's get you back in."
      subtitle="Enter the email on your account and we'll send you a link to choose a new password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
