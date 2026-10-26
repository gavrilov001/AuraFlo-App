/**
 * Centralized access to the public Supabase environment variables.
 * Only the publishable (browser-safe) key is read here. The service-role /
 * secret key must never be imported into application code.
 */

// Next.js inlines NEXT_PUBLIC_* vars into client bundles only where it can
// statically see the literal `process.env.NEXT_PUBLIC_X` form — a dynamic
// `process.env[name]` lookup (the previous shape of this helper) can't be
// replaced that way, so it silently read `undefined` in any client bundle,
// never in server code (where process.env is the real runtime environment,
// not a build-time replacement). Unnoticed until src/app/app/capture/
// CaptureBoard.tsx became the first client component to import this module.
// Each call site below passes its own already-dereferenced
// `process.env.NEXT_PUBLIC_X` literal so the bundler can still inline it.
function readEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

export const SUPABASE_URL = readEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
export const SUPABASE_PUBLISHABLE_KEY = readEnv(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/**
 * The one trusted source for this app's own public origin — used to build
 * absolute links in outgoing emails (password reset, Email to Dream
 * Catcher verification) and every authentication redirect
 * (/auth/callback/route.ts, src/lib/supabase/middleware.ts). None of those
 * call sites use request.nextUrl.origin or any Host/X-Forwarded-Host
 * header: on AWS Amplify, request.nextUrl.origin was confirmed to reflect
 * the app's internal origin rather than the public
 * https://app.auraflo.com the browser actually requested — sending real
 * recovery-link clicks to an unreachable localhost URL — and a raw
 * forwarded-host header is attacker-controllable in general regardless of
 * platform, so it must never be trusted for an auth redirect either way.
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
