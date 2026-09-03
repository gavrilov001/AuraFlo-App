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

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
