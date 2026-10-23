import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/types/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

const PROTECTED_PREFIX = "/app";
const AUTH_ROUTES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session on every request and enforces route access:
 * - unauthenticated users hitting /app/* are sent to /login (with redirectTo)
 * - authenticated users hitting /login or /signup are sent to /app
 */
export async function updateSession(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith(PROTECTED_PREFIX)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    const requestedPath = pathname + request.nextUrl.search;
    if (requestedPath && requestedPath !== "/app") {
      redirectUrl.searchParams.set("redirectTo", requestedPath);
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/app";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
