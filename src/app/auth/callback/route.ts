import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/env";

/**
 * Handles Supabase auth redirects:
 * - PKCE `?code=...` (OAuth / magic link / signup confirmation)
 * - `?token_hash=...&type=...` (email OTP links)
 * then forwards to `next` (defaults to /app).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/app";

  // Redirects are built from our own trusted site-url configuration, never
  // from the incoming request's origin/Host header. Confirmed on AWS
  // Amplify: request.nextUrl.origin (derived from how the platform's proxy
  // forwards the request to the app) reflected the app's internal origin
  // rather than the public https://app.auraflo.com the browser actually
  // requested, sending real recovery-link clicks to an unreachable
  // localhost URL. A raw Host/X-Forwarded-Host header is also
  // attacker-controllable in general and must never be trusted for
  // building an auth redirect on any platform, independent of this
  // specific Amplify behavior.
  const siteUrl = getSiteUrl();

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${siteUrl}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${siteUrl}${next}`);
  }

  return NextResponse.redirect(
    `${siteUrl}/login?error=${encodeURIComponent(
      "That link is invalid or has expired. Please try again.",
    )}`,
  );
}
