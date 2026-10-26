import { getSiteUrl } from "@/lib/supabase/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildVerifyUrl(kind: "sender" | "primary", token: string): string {
  const url = new URL("/verify-email", getSiteUrl());
  url.searchParams.set("type", kind);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildDreamCaptureConfirmUrl(token: string): string {
  const url = new URL("/verify-email", getSiteUrl());
  url.searchParams.set("type", "dream-capture");
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Sent on the first email from a given sender to a user's readable
 * @dream.auraflo.com handle (see
 * supabase/migrations/20261101000000_dream_catcher_handles.sql). That
 * address is guessable, so this confirmation — sent to the user's own
 * already-verified primary inbox, not reachable by whoever sent the email —
 * is what stops a guessed address + spoofed sender from landing a capture
 * without the real account owner clicking through. Confirming also
 * allow-lists the sender so later emails need no further confirmation.
 */
export function buildDreamCaptureConfirmEmail(
  senderEmail: string,
  token: string,
): { subject: string; html: string; text: string } {
  const link = buildDreamCaptureConfirmUrl(token);
  const subject = "Confirm a new thought for your Dream Catcher";
  const bodyLine = `A thought was just sent to your Dream Catcher from ${senderEmail}. If that was you, confirm it below — future emails from this address won't need this step again.`;

  const text = `${bodyLine}\n\n${link}\n\nThis link expires in 24 hours. If you didn't send this, you can ignore this email — nothing will be added to your Dream Catcher.`;

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #17212c;">
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(bodyLine)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(link)}" style="display: inline-block; background: #081321; color: #f4e9c9; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Confirm this thought
        </a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">This link expires in 24 hours. If you didn't send this, you can ignore this email — nothing will be added to your Dream Catcher.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

/**
 * Builds the verification email for an additional sender address. `kind`
 * controls which Supabase RPC the link ultimately calls
 * (sender_email_verify vs primary_email_verify) via /verify-email.
 */
export function buildVerificationEmail(
  kind: "sender" | "primary",
  token: string,
): { subject: string; html: string; text: string } {
  const link = buildVerifyUrl(kind, token);
  const subject =
    kind === "primary"
      ? "Verify your AuraFlo account email"
      : "Verify your email for Dream Catcher";
  const bodyLine =
    kind === "primary"
      ? "Confirm this is your account email so AuraFlo can accept Dream Catcher emails you send from it."
      : "Confirm you own this address so AuraFlo can accept Dream Catcher emails you send from it.";

  const text = `${bodyLine}\n\n${link}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`;

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #17212c;">
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(bodyLine)}</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(link)}" style="display: inline-block; background: #081321; color: #f4e9c9; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Verify this email
        </a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `.trim();

  return { subject, html, text };
}
