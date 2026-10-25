import type { Metadata } from "next";
import { CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/AuthShell";
import styles from "@/components/welcome/welcome.module.css";

export const metadata: Metadata = { title: "Verify your email" };

const RPC_BY_TYPE = {
  sender: "sender_email_verify",
  primary: "primary_email_verify",
} as const;

function errorCopy(code: string): { heading: string; subtitle: string } {
  switch (code) {
    case "expired_token":
      return {
        heading: "This link has expired.",
        subtitle:
          "Verification links expire after 30 minutes. Go back to Settings and resend one.",
      };
    case "already_verified":
      return {
        heading: "Already verified.",
        subtitle: "This address was already confirmed.",
      };
    case "unavailable":
      return {
        heading: "Not available yet.",
        subtitle:
          "Email to Dream Catcher isn't set up on this environment yet.",
      };
    default:
      return {
        heading: "This link is no longer valid.",
        subtitle:
          "It may have already been used, or the link is incomplete. Go back to Settings and resend a verification email.",
      };
  }
}

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/verify-email">) {
  const params = await searchParams;
  const type = params.type === "primary" ? "primary" : "sender";
  const token = typeof params.token === "string" ? params.token : "";

  if (!token) {
    const { heading, subtitle } = errorCopy("invalid_token");
    return <ErrorShell heading={heading} subtitle={subtitle} />;
  }

  const supabase = await createClient();
  // Deliberately not logging `token` anywhere in this request.
  const rpc = await supabase.rpc(RPC_BY_TYPE[type], { p_token: token });

  if (rpc.error) {
    const code =
      rpc.error.code && ["42883", "PGRST202", "PGRST203"].includes(rpc.error.code)
        ? "unavailable"
        : rpc.error.message;
    const { heading, subtitle } = errorCopy(code);
    return <ErrorShell heading={heading} subtitle={subtitle} />;
  }

  return (
    <AuthShell
      eyebrow="All set"
      heading="Email verified!"
      subtitle="This address can now send to your Dream Catcher."
    >
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <CheckCircle2 aria-hidden className="size-8" style={{ color: "var(--gold-light)" }} />
        <Link
          href="/app/settings"
          className={`${styles.btnPrimary} ${styles.btnBlock}`}
          style={{ textDecoration: "none", textAlign: "center", marginTop: "0.5rem" }}
        >
          Back to Settings
        </Link>
      </div>
    </AuthShell>
  );
}

function ErrorShell({ heading, subtitle }: { heading: string; subtitle: string }) {
  return (
    <AuthShell eyebrow="Verification" heading={heading} subtitle={subtitle}>
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <CircleAlert aria-hidden className="size-8" style={{ color: "var(--danger)" }} />
        <Link
          href="/app/settings"
          className={`${styles.btnPrimary} ${styles.btnBlock}`}
          style={{ textDecoration: "none", textAlign: "center", marginTop: "0.5rem" }}
        >
          Back to Settings
        </Link>
      </div>
    </AuthShell>
  );
}
