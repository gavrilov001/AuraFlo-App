import { Webhook, WebhookVerificationError } from "svix";

import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";
import { createDreamcatcherAdminClient } from "@/lib/supabase/dreamcatcher-admin";
import { getDreamDomain, getLegacyInboundAddresses } from "@/lib/email/inbound-address";

// Resend signs webhooks with Svix. Verifying here means the raw body must be
// read as text (not JSON) before any parsing happens — see
// https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
export const runtime = "nodejs";

interface ResendEmailReceivedPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    to?: string[] | null;
    received_for?: string[] | null;
    subject?: string | null;
  };
}

interface ReceivedEmail {
  text: string | null;
  html: string | null;
}

type AdminClient = Awaited<ReturnType<typeof createDreamcatcherAdminClient>>;

// Postgres/PostgREST codes meaning "that table, column, or function doesn't
// exist" — i.e. one or more of 20261026120000_email_to_dreamcatcher.sql,
// 20261101000000_dream_catcher_handles.sql, or
// 20261103000000_dream_capture_direct_insert.sql haven't been applied to
// this database yet. Treated as "no handle schema available yet", never as
// a hard failure, so the legacy from-header path keeps working for
// existing users until the migration is applied, and deploy order between
// this app code and any of those migrations is never load-bearing.
const SCHEMA_NOT_READY = new Set(["42P01", "42703", "PGRST202", "PGRST205"]);

function isSchemaNotReady(code: string | undefined | null): boolean {
  return code != null && SCHEMA_NOT_READY.has(code);
}

// Structured timing logs, correlated by Resend's own email_id (never a
// sender/recipient address, subject, or body — see module header). Each
// line is independently greppable/joinable in CloudWatch Logs Insights by
// `email_id`. `console.log`/`console.warn` land in the Amplify SSR compute
// function's stdout, which CloudWatch tails automatically.
function logTiming(
  event: string,
  emailId: string,
  extra: Record<string, number | string | boolean> = {},
): void {
  console.log(JSON.stringify({ event, email_id: emailId, ts: new Date().toISOString(), ...extra }));
}

/**
 * Logs the final "responded" timing line (skipped when `context` is absent,
 * i.e. for failures before an email_id/start time exist — signature
 * verification, malformed JSON, missing fields) and returns the Response.
 * Centralizing this means every exit point after the timer starts reports
 * the same total_duration_ms/http_status shape, with nothing to keep in
 * sync by hand across the many early-return branches below.
 */
function respond(status: number, context?: { emailId: string; t0: number }): Response {
  if (context) {
    logTiming("resend_webhook.responded", context.emailId, {
      total_duration_ms: Date.now() - context.t0,
      http_status: status,
    });
  }
  return new Response(null, { status });
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCaptureContent(subject: string | null | undefined, body: string | null | undefined): string {
  const trimmedSubject = subject?.trim() ?? "";
  const trimmedBody = body?.trim() ?? "";
  if (trimmedSubject && trimmedBody) return `${trimmedSubject}\n\n${trimmedBody}`;
  return trimmedSubject || trimmedBody;
}

async function findUserIdByEmail(admin: AdminClient, email: string): Promise<string | null> {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function resolveWorkspaceId(admin: AdminClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.workspace_id ?? null;
}

async function fetchReceivedEmail(emailId: string, apiKey: string): Promise<ReceivedEmail> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Resend receiving-email lookup failed with status ${res.status}.`);
  }
  const body = (await res.json()) as { text?: string | null; html?: string | null };
  return { text: body.text ?? null, html: body.html ?? null };
}

/**
 * Extracts a recipient's local-part, only when its domain matches `domain`.
 * Returns null for anything else (a cc'd unrelated address, a malformed
 * entry, the other Dream Catcher domain, etc).
 */
function localPartForDomain(address: string, domain: string): string | null {
  const normalized = extractEmailAddress(address);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return null;
  const [local, recipientDomain] = [normalized.slice(0, at), normalized.slice(at + 1)];
  if (recipientDomain !== domain) return null;
  return local;
}

/**
 * Resolves the single user whose dream_handle appears among this email's
 * recipients, from `received_for` (the addresses Resend actually routed to
 * us) falling back to `to` if that field is absent. Returns null when no
 * handle matched (caller falls back to the legacy from-header path) or when
 * more than one distinct user matched — an ambiguous email is never routed,
 * rather than guessing and risking a cross-account delivery.
 */
async function resolveUserByDreamHandle(
  admin: AdminClient,
  recipients: string[],
): Promise<string | null | "ambiguous"> {
  const handles = Array.from(
    new Set(
      recipients
        .map((r) => localPartForDomain(r, getDreamDomain()))
        .filter((a): a is string => a !== null),
    ),
  );
  if (handles.length === 0) return null;

  const { data, error } = await admin.from("profiles").select("id").in("dream_handle", handles);
  if (error) {
    if (isSchemaNotReady(error.code)) return null;
    throw error;
  }
  if (!data || data.length === 0) return null;

  const distinctUserIds = Array.from(new Set(data.map((row) => row.id)));
  if (distinctUserIds.length > 1) return "ambiguous";
  return distinctUserIds[0];
}

/** True if any recipient exactly matches a recognized legacy address. */
function recipientsIncludeLegacyAddress(recipients: string[]): boolean {
  const legacy = new Set(getLegacyInboundAddresses());
  return recipients.some((r) => legacy.has(extractEmailAddress(r)));
}

/**
 * True only if `senderEmail` is a *verified* approved sender for `userId` —
 * either their primary account email (verified via
 * primary_email_request_verification/verify, since Supabase email
 * confirmation is disabled for this project and auth.users.email alone is
 * not proof of ownership) or a verified row in user_sender_emails. Resend's
 * webhook/API does not expose SPF/DKIM/DMARC verdicts, so this check is the
 * entire trust boundary for the handle-routed path — the From header itself
 * is still just a claim, which is why it must match a verified record.
 */
async function isApprovedSender(
  admin: AdminClient,
  userId: string,
  senderEmail: string,
): Promise<boolean> {
  // These two reads are independent (different tables, neither depends on
  // the other's result) — running them concurrently means the common case
  // (approved via primary email) pays for the unused user_sender_emails
  // query, but in parallel, not in sequence, so it never adds wall-clock
  // time. Only the conditional getUserById() below has a real dependency
  // (it only runs to double-check a primary-email match) and stays awaited
  // on its own.
  const [profileResult, senderResult] = await Promise.all([
    admin
      .from("profiles")
      .select("primary_email_verified_email, primary_email_verified_at")
      .eq("id", userId)
      .maybeSingle(),
    admin
      .from("user_sender_emails")
      .select("id")
      .eq("user_id", userId)
      .eq("email_normalized", senderEmail)
      .eq("status", "verified")
      .maybeSingle(),
  ]);

  const { data: profile, error: profileError } = profileResult;
  if (profileError) {
    if (isSchemaNotReady(profileError.code)) return false;
    throw profileError;
  }
  if (profile?.primary_email_verified_at && profile.primary_email_verified_email === senderEmail) {
    // primary_email_verified_email is a point-in-time snapshot. If the
    // user's Supabase Auth email has since changed, that snapshot is stale
    // and must not keep approving an address they may no longer control —
    // supabase/migrations/20261026120000_email_to_dreamcatcher.sql's
    // auth.users trigger clears this on change, but this re-check is
    // defense in depth for any row written before that trigger existed.
    const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
    if (authError) throw authError;
    const currentPrimaryEmail = authUser.user?.email?.toLowerCase() ?? null;
    if (currentPrimaryEmail === profile.primary_email_verified_email) {
      return true;
    }
  }

  const { data: sender, error: senderError } = senderResult;
  if (senderError) {
    if (isSchemaNotReady(senderError.code)) return false;
    throw senderError;
  }
  return sender != null;
}

async function insertCapture(
  admin: AdminClient,
  params: { workspaceId: string; userId: string; content: string; emailId: string },
): Promise<"inserted" | "duplicate"> {
  const { error } = await admin.from("captures").insert({
    workspace_id: params.workspaceId,
    created_by: params.userId,
    content: params.content,
    source: "email",
    source_external_id: params.emailId,
    status: "inbox",
  });
  if (error) {
    // Unique violation on (workspace_id, source, source_external_id) means
    // this email was already captured by a prior delivery of this webhook.
    if (error.code === "23505") return "duplicate";
    throw error;
  }
  return "inserted";
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let secrets;
  try {
    secrets = await getDreamcatcherSecrets();
  } catch (error) {
    console.error("resend webhook: failed to resolve Dreamcatcher secrets", error);
    return new Response(null, { status: 500 });
  }

  try {
    new Webhook(secrets.resendWebhookSecret).verify(rawBody, svixHeaders);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.warn("resend webhook: signature verification failed");
      return new Response(null, { status: 401 });
    }
    throw error;
  }

  let payload: ResendEmailReceivedPayload;
  try {
    payload = JSON.parse(rawBody) as ResendEmailReceivedPayload;
  } catch {
    console.warn("resend webhook: body is not valid JSON after verification");
    return new Response(null, { status: 400 });
  }

  if (payload.type !== "email.received") {
    return new Response(null, { status: 200 });
  }

  const { email_id: emailId, from, subject } = payload.data ?? {};
  if (!emailId || !from) {
    console.warn("resend webhook: email.received payload missing email_id or from");
    return new Response(null, { status: 200 });
  }

  const senderEmail = extractEmailAddress(from);
  const recipients = [
    ...(Array.isArray(payload.data.received_for) ? payload.data.received_for : []),
    ...(Array.isArray(payload.data.to) ? payload.data.to : []),
  ];

  const t0 = Date.now();
  const timing = { emailId, t0 };
  logTiming("resend_webhook.received", emailId);

  try {
    const admin = await createDreamcatcherAdminClient();

    // --- New path: the email was sent to a personal, readable Dream
    // Catcher handle. Routing is by recipient, not by the spoofable From
    // header — but the sender must still be a *verified* approved address
    // for that specific user, or the email is ignored and never captured.
    // Captures immediately, with no confirmation step: the handle is
    // guessable and Resend exposes no per-message authentication signal
    // (see 20261103000000_dream_capture_direct_insert.sql's REMAINING RISK
    // note), so a correctly-guessed handle + a correctly-guessed verified
    // sender address can land a forged capture — an accepted, documented
    // tradeoff for frictionless capture, not a claim that this route is
    // spoof-proof.
    const handleResolution = await resolveUserByDreamHandle(admin, recipients);
    if (handleResolution === "ambiguous") {
      console.warn("resend webhook: email addressed to more than one user's handle, ignoring");
      return respond(200, timing);
    }
    if (handleResolution !== null) {
      const userId = handleResolution;

      const tVerify = Date.now();
      const approved = await isApprovedSender(admin, userId, senderEmail);
      logTiming("resend_webhook.sender_verified", emailId, {
        duration_ms: Date.now() - tVerify,
        approved,
      });
      if (!approved) {
        // Deliberately NOT fetching the email body before this check. The
        // content fetch and the sender-approval check are logically
        // independent (fetchReceivedEmail only needs emailId), so they
        // could run concurrently — but doing so would mean every spoofed or
        // guessed-handle delivery, approved or not, costs a Resend API call
        // and briefly holds the decoded body in memory before being
        // discarded. Given isApprovedSender() is this route's entire trust
        // boundary (see 20261103000000_dream_capture_direct_insert.sql's
        // REMAINING RISK note), that tradeoff isn't worth a few tens of ms:
        // an unapproved sender's message content is never fetched at all.
        console.warn("resend webhook: sender is not a verified approved address for this user");
        return respond(200, timing);
      }

      const tFetch = Date.now();
      const { text, html } = await fetchReceivedEmail(emailId, secrets.resendApiKey);
      logTiming("resend_webhook.content_fetched", emailId, { duration_ms: Date.now() - tFetch });
      const body = text ?? (html ? htmlToPlainText(html) : null);
      const content = buildCaptureContent(subject, body);
      if (!content) {
        console.warn("resend webhook: email had no usable subject or body, skipping");
        return respond(200, timing);
      }

      const tInsert = Date.now();
      const insert = await admin.rpc("dream_capture_insert", {
        p_user_id: userId,
        p_sender_email: senderEmail,
        p_source_external_id: emailId,
        p_content: content,
      });
      if (insert.error) {
        if (isSchemaNotReady(insert.error.code)) {
          console.warn("resend webhook: dream_capture_insert not available yet, dropping");
          return respond(200, timing);
        }
        throw insert.error;
      }

      // dream_capture_insert() returns a status rather than raising for
      // every expected outcome — "captured" (new or a deduped retry) needs
      // no further action; the rest are drops, logged for visibility.
      const status = (insert.data as { status?: string } | null)?.status;
      logTiming("resend_webhook.capture_inserted", emailId, {
        duration_ms: Date.now() - tInsert,
        status: status ?? "unknown",
      });
      switch (status) {
        case "no_workspace":
          console.warn("resend webhook: no workspace found for resolved user");
          break;
        case "not_approved":
          // Defense-in-depth branch inside dream_capture_insert itself —
          // shouldn't normally trigger, since isApprovedSender() above
          // already gated this. Worth knowing about if it ever does.
          console.warn("resend webhook: dream_capture_insert rejected a sender isApprovedSender had approved");
          break;
        case "rate_limited":
          console.warn("resend webhook: dream-handle capture rate limit hit, dropping");
          break;
        default:
          break;
      }
      return respond(200, timing);
    }

    // --- Legacy path: allowed ONLY when a recipient is an exact match for
    // one of the explicitly recognized legacy addresses
    // (getLegacyInboundAddresses()) — never merely because no personal
    // handle matched. An unknown or malformed handle-shaped address must be
    // dropped here, not silently fall through to spoofable sender-only
    // routing. This is the one path that still trusts the From header alone
    // — preserved deliberately, per 20261026120000_email_to_dreamcatcher.sql.
    if (!recipientsIncludeLegacyAddress(recipients)) {
      console.warn("resend webhook: recipient matched no known handle or legacy address, ignoring");
      return respond(200, timing);
    }

    const tVerify = Date.now();
    const userId = await findUserIdByEmail(admin, senderEmail);
    logTiming("resend_webhook.sender_verified", emailId, {
      duration_ms: Date.now() - tVerify,
      approved: userId !== null,
    });
    if (!userId) {
      // Same reasoning as the handle-route branch above: the sender's
      // identity (hence any right to have their content fetched) isn't
      // established until findUserIdByEmail resolves a real AuraFlo user,
      // so the Resend content fetch below never starts for an unmatched
      // sender.
      console.warn("resend webhook: no AuraFlo user found for sender");
      return respond(200, timing);
    }

    // The sender is now a confirmed existing user — unlike the fetch
    // itself, resolving their workspace isn't a trust decision (it can
    // only ever be "this exact user's own workspace" or missing), so it's
    // safe to run concurrently with the Resend content fetch rather than
    // gating it. Content is simply discarded below if no workspace turns up.
    const tFetch = Date.now();
    const [workspaceId, fetched] = await Promise.all([
      resolveWorkspaceId(admin, userId),
      fetchReceivedEmail(emailId, secrets.resendApiKey),
    ]);
    logTiming("resend_webhook.content_fetched", emailId, { duration_ms: Date.now() - tFetch });
    if (!workspaceId) {
      console.warn("resend webhook: no workspace found for resolved user");
      return respond(200, timing);
    }

    const { text, html } = fetched;
    const body = text ?? (html ? htmlToPlainText(html) : null);
    const content = buildCaptureContent(subject, body);
    if (!content) {
      console.warn("resend webhook: email had no usable subject or body, skipping");
      return respond(200, timing);
    }

    const tInsert = Date.now();
    const insertStatus = await insertCapture(admin, { workspaceId, userId, content, emailId });
    logTiming("resend_webhook.capture_inserted", emailId, {
      duration_ms: Date.now() - tInsert,
      status: insertStatus,
    });
    return respond(200, timing);
  } catch (error) {
    console.error("resend webhook: failed to process email.received", error);
    return respond(500, timing);
  }
}
