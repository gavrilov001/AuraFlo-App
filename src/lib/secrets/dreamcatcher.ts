import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

// The secret lives in eu-central-1 regardless of which region the Amplify
// SSR compute function itself runs in — never rely on the ambient AWS
// region for this call.
const SECRETS_MANAGER_REGION = "eu-central-1";
const DEFAULT_SECRET_ID = "auraflo/dev/dreamcatcher";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface DreamcatcherSecrets {
  resendApiKey: string;
  resendWebhookSecret: string;
  supabaseServiceRoleKey: string;
}

let client: SecretsManagerClient | null = null;
let cached: { value: DreamcatcherSecrets; expiresAt: number } | null = null;
let pending: Promise<DreamcatcherSecrets> | null = null;

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

function readLocalEnvSecrets(): DreamcatcherSecrets {
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!resendApiKey || !resendWebhookSecret || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing RESEND_API_KEY, RESEND_WEBHOOK_SECRET, or SUPABASE_SERVICE_ROLE_KEY. " +
        "Add them to .env.local (see .env.example) for local development.",
    );
  }
  return { resendApiKey, resendWebhookSecret, supabaseServiceRoleKey };
}

function getClient(): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({ region: SECRETS_MANAGER_REGION });
  }
  return client;
}

function readField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`Dreamcatcher secret is missing required field "${field}".`);
  }
  return value;
}

async function fetchFromSecretsManager(): Promise<DreamcatcherSecrets> {
  const secretId = process.env.DREAMCATCHER_SECRET_ID ?? DEFAULT_SECRET_ID;
  const result = await getClient().send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error("Dreamcatcher secret has no SecretString payload.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.SecretString) as Record<string, unknown>;
  } catch {
    throw new Error("Dreamcatcher secret is not valid JSON.");
  }

  return {
    resendApiKey: readField(parsed, "RESEND_API_KEY"),
    resendWebhookSecret: readField(parsed, "RESEND_WEBHOOK_SECRET"),
    supabaseServiceRoleKey: readField(parsed, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/**
 * Resolves the three Dreamcatcher webhook credentials.
 *
 * Local development (NODE_ENV !== "production") always reads them from
 * process.env (.env.local) — never calls AWS.
 *
 * In production, they are ALWAYS fetched from AWS Secrets Manager
 * (auraflo/dev/dreamcatcher, eu-central-1) via the Amplify SSR compute
 * role's IAM permissions, even if the same-named environment variables
 * happen to be present. A failed Secrets Manager request throws — it never
 * falls back to process.env — so a misconfigured IAM role or an outage
 * fails closed instead of silently using a stale or absent value.
 *
 * A successful result is cached in-memory for 5 minutes, so a rotated
 * secret is picked up without a redeploy while a warm container avoids a
 * Secrets Manager round trip on every webhook delivery. Concurrent callers
 * racing a cold cache share one in-flight request instead of each issuing
 * their own GetSecretValue call.
 */
export async function getDreamcatcherSecrets(): Promise<DreamcatcherSecrets> {
  if (isLocalDevelopment()) {
    return readLocalEnvSecrets();
  }

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (!pending) {
    pending = fetchFromSecretsManager()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
        return value;
      })
      .finally(() => {
        pending = null;
      });
  }

  return pending;
}
