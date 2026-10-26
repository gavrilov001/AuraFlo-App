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
  "dream-capture": "dream_capture_confirm",
} as const;

function errorCopy(
  code: string,
  type: "sender" | "primary" | "dream-capture" = "sender",
): { heading: string; subtitle: string } {
  switch (code) {
    case "expired_token":
      return type === "dream-capture"
        ? {
            heading: "This link has expired.",
            subtitle: "Confirmation links expire after 24 hours. Send another thought to generate a new one.",
          }
        : {
            heading: "This link has expired.",
            subtitle:
              "Verification links expire after 30 minutes. Go back to Settings and resend one.",
          };
    case "already_verified":
      return {
        heading: "Already verified.",
        subtitle: "This address was already confirmed.",
      };
    case "not_approved":
      return {
        heading: "This sender is no longer approved.",
        subtitle:
          "The address this thought came from was removed, or your account email changed, since it was sent. Nothing was added.",
      };
    case "no_access":
      return {
        heading: "This link is no longer valid.",
        subtitle: "Nothing was added to your Dream Catcher.",
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
  const type =
    params.type === "primary" || params.type === "dream-capture" ? params.type : "sender";
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
    const { heading, subtitle } = errorCopy(code, type);
    return <ErrorShell heading={heading} subtitle={subtitle} />;
  }

  // dream_capture_confirm() never raises for an expected outcome — it
  // always returns {status: ...} instead, so a cleanup delete it performs
  // can't be rolled back by a later raised exception in the same
  // transaction (see supabase/migrations/20261101000000_dream_catcher_handles.sql).
  // Every other RPC here still signals failure via rpc.error, handled above.
  if (type === "dream-capture") {
    const status = (rpc.data as { status?: string } | null)?.status;
    if (status !== "confirmed") {
      const code =
        status === "not_approved" ? "not_approved" : status === "no_access" ? "no_access" : "invalid_token";
      const { heading, subtitle } = errorCopy(code, type);
      return <ErrorShell heading={heading} subtitle={subtitle} />;
    }
  }

  const success =
    type === "dream-capture"
      ? {
          eyebrow: "Confirmed",
          heading: "Thought added!",
          subtitle: "That sender is now confirmed — future emails from them won't need this step.",
        }
      : {
          eyebrow: "All set",
          heading: "Email verified!",
          subtitle: "This address can now send to your Dream Catcher.",
        };

  return (
    <AuthShell
      eyebrow={success.eyebrow}
      heading={success.heading}
      subtitle={success.subtitle}
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
