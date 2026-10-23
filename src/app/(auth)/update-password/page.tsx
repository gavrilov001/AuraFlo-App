import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { getUser } from "@/lib/auth/context";
import { AuthShell } from "@/components/auth/AuthShell";
import styles from "@/components/welcome/welcome.module.css";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage({
  searchParams,
}: PageProps<"/update-password">) {
  const params = await searchParams;
  // Set only by updatePasswordAction's own redirect after it has already
  // verified the session, updated the password, and signed the session out
  // server-side — never a client-settable signal for anything sensitive.
  // Takes priority over the session gate below: by this point there is no
  // session (we just signed it out on purpose), which would otherwise read
  // as "link expired" instead of the success it actually is.
  if (params.reset === "success") {
    return (
      <AuthShell
        eyebrow="All set"
        heading="Password updated successfully!"
        subtitle="Your password has been changed. Please sign in with your new password to continue."
      >
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <CheckCircle2
            aria-hidden
            className="size-8"
            style={{ color: "var(--gold-light)" }}
          />
          <Link
            href="/login"
            className={`${styles.btnPrimary} ${styles.btnBlock}`}
            style={{
              textDecoration: "none",
              textAlign: "center",
              marginTop: "0.5rem",
            }}
          >
            Sign in to AuraFlo
          </Link>
        </div>
      </AuthShell>
    );
  }

  // Gates the form on a valid session up front, rather than only at submit
  // time: a recovery link's code/token_hash is exchanged for a session by
  // /auth/callback before landing here, so no session at all means the link
  // was invalid, expired, or already used. getUser() verifies the access
  // token's signature (see src/lib/auth/context.ts) — the authoritative
  // check happens again in updatePasswordAction right before the mutation,
  // this is purely about not showing the form to begin with when there's
  // nothing it could do.
  const user = await getUser();

  if (!user) {
    return (
      <AuthShell
        eyebrow="Link expired"
        heading="This link is no longer valid."
        subtitle="Password reset links expire after a short time, or may have already been used once. Request a new one to continue."
      >
        <div
          className={styles.authLinks}
          style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}
        >
          <Link href="/forgot-password" className={styles.authLinkPrimary}>
            Request a new reset link
          </Link>
          <Link href="/login" className={styles.authLinkBack}>
            <span aria-hidden>&larr;</span> Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Almost there"
      heading="Choose a new password."
      subtitle="Enter a new password for your AuraFlo account."
    >
      <UpdatePasswordForm />
    </AuthShell>
  );
}
