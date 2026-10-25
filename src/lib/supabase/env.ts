/**
 * Centralized access to the public Supabase environment variables.
 * Only the publishable (browser-safe) key is read here. The service-role /
 * secret key must never be imported into application code.
 */

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

export const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_PUBLISHABLE_KEY = readEnv(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
);

/**
 * Base URL used to build absolute links in outgoing emails (password reset,
 * Email to Dream Catcher verification) — there's no incoming request to
 * derive an origin from at send time, unlike /auth/callback/route.ts which
 * uses request.nextUrl.origin instead.
 *
 * NEXT_PUBLIC_* variables are inlined into the build output wherever
 * they're referenced — client or server code — at `next build` time, not
 * read live from the deployed process's environment. On Amplify this means
 * the value must be set as a BUILD-time environment variable (Amplify
 * Console -> App settings -> Environment variables, available to the build
 * step) for the branch being built; setting it only as a runtime-only
 * variable after the fact does nothing until the next rebuild. A
 * misconfiguration here previously failed silently — every outgoing email
 * link quietly pointed at localhost even in production — so a genuinely
 * missing value in a production build now throws instead, surfacing as a
 * clear "couldn't send the verification email" error rather than a
 * delivered-but-broken link. Local dev and preview builds that are not
 * NODE_ENV=production keep the localhost fallback unchanged.
 */
export function getSiteUrl(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing NEXT_PUBLIC_SITE_URL in the build environment. Set it (e.g. " +
        "https://app.auraflo.com) in Amplify's build-time environment " +
        "variables for this branch and redeploy.",
    );
  }
  return "http://localhost:3000";
}
