import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/types/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSiteUrl } from "./env";

const PROTECTED_PREFIX = "/app";
const AUTH_ROUTES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session on every request and enforces route access:
 * - unauthenticated users hitting /app/* are sent to /login (with redirectTo)
 * - authenticated users hitting /login or /signup are sent to /app
 */
export async function updateSession(request: NextRequest) {
  // Server Action requests (Next.js tags them with this header) never
  // navigate, so the redirect logic below is moot for them — and every
  // Server Action already re-verifies auth + workspace membership itself via
  // requireWorkspaceContext(), independently and server-side. Skipping the
  // extra auth round trip here cuts a hop off every mutation (capture,
  // complete, archive, ...) without weakening any check — the action still
  // fully authenticates on its own.
  if (request.headers.has("next-action")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() verifies the JWT's signature (locally, against a cached copy
  // of the project's public keys — this project uses asymmetric signing) and
  // also drives the same lazy session refresh getUser() did, so a near-expiry
  // access token still gets rotated here before the page renders. Unlike
  // getSession(), it never trusts an unverified cookie value. See
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const { pathname } = request.nextUrl;

  // Built from our own trusted site-url config, not request.nextUrl's own
  // origin — same reasoning as /auth/callback/route.ts and getSiteUrl()'s
  // own comment: an incoming request's perceived origin/Host is not
  // something an auth redirect should ever trust, platform quirks aside.
  if (!user && pathname.startsWith(PROTECTED_PREFIX)) {
    const redirectUrl = new URL("/login", getSiteUrl());
    const requestedPath = pathname + request.nextUrl.search;
    if (requestedPath && requestedPath !== "/app") {
      redirectUrl.searchParams.set("redirectTo", requestedPath);
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/app", getSiteUrl()));
  }

  return supabaseResponse;
}
