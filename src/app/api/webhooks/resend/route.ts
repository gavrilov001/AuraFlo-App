import { Webhook, WebhookVerificationError } from "svix";

import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";
import { createDreamcatcherAdminClient } from "@/lib/supabase/dreamcatcher-admin";
import { getInboundDomain, getDreamDomain, getLegacyInboundAddresses } from "@/lib/email/inbound-address";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { buildDreamCaptureConfirmEmail } from "@/lib/email/verification-templates";

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
// exist" — i.e. 20261026120000_email_to_dreamcatcher.sql and/or
// 20261101000000_dream_catcher_handles.sql haven't been applied to this
// database yet. Treated as "no alias schema available yet", never as a hard
// failure, so the legacy from-header path keeps working for existing users
// until the migration is applied, and deploy order between this app code
// and either migration is never load-bearing.
const SCHEMA_NOT_READY = new Set(["42P01", "42703", "PGRST202", "PGRST205"]);

function isSchemaNotReady(code: string | undefined | null): boolean {
  return code != null && SCHEMA_NOT_READY.has(code);
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

type AliasMatch = { userId: string; route: "alias" | "dream" };

/**
 * Resolves the single user addressed by this email's recipients, from
 * `received_for` (the addresses Resend actually routed to us) falling back
 * to `to` if that field is absent. Checks both the unguessable random-hex
 * `inbound_alias` (route "alias") and the readable, guessable `dream_handle`
 * (route "dream") — the two are deliberately on different domains so a
 * recipient can only ever match one of them. Returns null when neither
 * matched (caller falls back to the legacy from-header path) or when more
 * than one distinct user matched — an ambiguous email is never routed,
 * rather than guessing and risking a cross-account delivery.
 */
async function resolveUserByAlias(
  admin: AdminClient,
  recipients: string[],
): Promise<AliasMatch | null | "ambiguous"> {
  const aliases = Array.from(
    new Set(
      recipients
        .map((r) => localPartForDomain(r, getInboundDomain()))
        .filter((a): a is string => a !== null),
    ),
  );
  const handles = Array.from(
    new Set(
      recipients
        .map((r) => localPartForDomain(r, getDreamDomain()))
        .filter((a): a is string => a !== null),
    ),
  );
  if (aliases.length === 0 && handles.length === 0) return null;

  const matches: AliasMatch[] = [];

  if (aliases.length > 0) {
    const { data, error } = await admin.from("profiles").select("id").in("inbound_alias", aliases);
    if (error) {
      if (!isSchemaNotReady(error.code)) throw error;
    } else if (data) {
      matches.push(...data.map((row) => ({ userId: row.id, route: "alias" as const })));
    }
  }

  if (handles.length > 0) {
    const { data, error } = await admin.from("profiles").select("id").in("dream_handle", handles);
    if (error) {
      if (!isSchemaNotReady(error.code)) throw error;
    } else if (data) {
      matches.push(...data.map((row) => ({ userId: row.id, route: "dream" as const })));
    }
  }

  if (matches.length === 0) return null;

  const distinctUserIds = Array.from(new Set(matches.map((m) => m.userId)));
  if (distinctUserIds.length > 1) return "ambiguous";
  return matches[0];
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
 * entire trust boundary for the alias-routed path — the From header itself
 * is still just a claim, which is why it must match a verified record.
 */
async function isApprovedSender(
  admin: AdminClient,
  userId: string,
  senderEmail: string,
): Promise<boolean> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("primary_email_verified_email, primary_email_verified_at")
    .eq("id", userId)
    .maybeSingle();
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

  const { data: sender, error: senderError } = await admin
    .from("user_sender_emails")
    .select("id")
    .eq("user_id", userId)
    .eq("email_normalized", senderEmail)
    .eq("status", "verified")
    .maybeSingle();
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

  try {
    const admin = await createDreamcatcherAdminClient();

    // --- New path: the email was sent to a personal Dream Catcher address
    // (either route). Routing is by recipient, not by the spoofable From
    // header — but the sender must still be a *verified* approved address
    // for that specific user, or the email is ignored.
    const aliasResolution = await resolveUserByAlias(admin, recipients);
    if (aliasResolution === "ambiguous") {
      console.warn("resend webhook: email addressed to more than one user's address, ignoring");
      return new Response(null, { status: 200 });
    }
    if (aliasResolution !== null) {
      const { userId, route } = aliasResolution;
      const approved = await isApprovedSender(admin, userId, senderEmail);
      if (!approved) {
        console.warn("resend webhook: sender is not a verified approved address for this user");
        return new Response(null, { status: 200 });
      }

      const { text, html } = await fetchReceivedEmail(emailId, secrets.resendApiKey);
      const body = text ?? (html ? htmlToPlainText(html) : null);
      const content = buildCaptureContent(subject, body);
      if (!content) {
        console.warn("resend webhook: email had no usable subject or body, skipping");
        return new Response(null, { status: 200 });
      }

      if (route === "alias") {
        // inbound_alias is a 128-bit unguessable capability — sender-match
        // is an adequate trust boundary on its own, same as today.
        const workspaceId = await resolveWorkspaceId(admin, userId);
        if (!workspaceId) {
          console.warn("resend webhook: no workspace found for resolved user");
          return new Response(null, { status: 200 });
        }
        await insertCapture(admin, { workspaceId, userId, content, emailId });
        return new Response(null, { status: 200 });
      }

      // route === "dream": the readable handle is guessable, so sender-match
      // alone is not enough (see 20261101000000_dream_catcher_handles.sql).
      // dream_capture_submit() only captures immediately for an already-
      // confirmed sender; otherwise it holds the content and mints a
      // confirmation token for us to email to the user's verified primary
      // address — the real safeguard, since an attacker spoofing the sender
      // can't read that inbox.
      const submit = await admin.rpc("dream_capture_submit", {
        p_user_id: userId,
        p_sender_email: senderEmail,
        p_source_external_id: emailId,
        p_content: content,
      });
      if (submit.error) {
        if (isSchemaNotReady(submit.error.code)) {
          console.warn("resend webhook: dream_capture_submit not available yet, dropping");
          return new Response(null, { status: 200 });
        }
        throw submit.error;
      }

      // dream_capture_submit() returns a status rather than raising for
      // every expected outcome (see 20261101000000_dream_catcher_handles.sql
      // for why — a raised exception would roll back its own internal
      // cleanup delete). "captured", "duplicate_pending", "no_workspace",
      // "not_approved", "no_verified_destination", and "rate_limited" all
      // need no further action here — only "pending" does.
      const submitData = submit.data as { status?: string; token?: string; confirm_to?: string } | null;
      const status = submitData?.status;
      switch (status) {
        case "no_workspace":
          console.warn("resend webhook: no workspace found for resolved user");
          break;
        case "not_approved":
          // Defense-in-depth branch inside dream_capture_submit itself —
          // shouldn't normally trigger, since isApprovedSender() above
          // already gated this. Worth knowing about if it ever does.
          console.warn("resend webhook: dream_capture_submit rejected a sender isApprovedSender had approved");
          break;
        case "no_verified_destination":
          console.warn("resend webhook: user has no verified primary email to confirm to, dropping");
          break;
        case "rate_limited":
          console.warn("resend webhook: dream-handle handshake rate limit hit, dropping");
          break;
        case "pending": {
          // Sent only to the proven-owned primary_email_verified_email the
          // RPC itself resolved — never the live auth.users.email (see the
          // migration for why that distinction matters).
          const token = submitData?.token;
          const confirmTo = submitData?.confirm_to;
          if (token && confirmTo) {
            const { subject: confirmSubject, html: confirmHtml, text: confirmText } =
              buildDreamCaptureConfirmEmail(senderEmail, token);
            try {
              await sendTransactionalEmail({
                to: confirmTo,
                subject: confirmSubject,
                html: confirmHtml,
                text: confirmText,
              });
            } catch (sendError) {
              // The pending row already exists — this is a lost
              // notification, not a lost capture. Nothing to retry here:
              // the sender's next email (if any) will hit the same pending
              // row via the unique index and won't send a duplicate either.
              console.error("resend webhook: failed to send dream-capture confirmation email", sendError);
            }
          }
          break;
        }
        default:
          break;
      }
      return new Response(null, { status: 200 });
    }

    // --- Legacy path: allowed ONLY when a recipient is an exact match for
    // one of the explicitly recognized legacy addresses
    // (getLegacyInboundAddresses()) — never merely because no personal
    // alias matched. An unknown, malformed, or revoked personal-alias-shaped
    // address must be dropped here, not silently fall through to spoofable
    // sender-only routing. This is the one path that still trusts the From
    // header alone — preserved so the already-working legacy integration
    // isn't broken by this rollout; see the architecture report for that
    // tradeoff.
    if (!recipientsIncludeLegacyAddress(recipients)) {
      console.warn("resend webhook: recipient matched no known alias or legacy address, ignoring");
      return new Response(null, { status: 200 });
    }

    const userId = await findUserIdByEmail(admin, senderEmail);
    if (!userId) {
      console.warn("resend webhook: no AuraFlo user found for sender");
      return new Response(null, { status: 200 });
    }

    const workspaceId = await resolveWorkspaceId(admin, userId);
    if (!workspaceId) {
      console.warn("resend webhook: no workspace found for resolved user");
      return new Response(null, { status: 200 });
    }

    const { text, html } = await fetchReceivedEmail(emailId, secrets.resendApiKey);
    const body = text ?? (html ? htmlToPlainText(html) : null);
    const content = buildCaptureContent(subject, body);
    if (!content) {
      console.warn("resend webhook: email had no usable subject or body, skipping");
      return new Response(null, { status: 200 });
    }

    await insertCapture(admin, { workspaceId, userId, content, emailId });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("resend webhook: failed to process email.received", error);
    return new Response(null, { status: 500 });
  }
}
