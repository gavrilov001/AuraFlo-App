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
