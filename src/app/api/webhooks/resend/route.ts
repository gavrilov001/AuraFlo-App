import { Webhook, WebhookVerificationError } from "svix";

import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";
import { createDreamcatcherAdminClient } from "@/lib/supabase/dreamcatcher-admin";

// Resend signs webhooks with Svix. Verifying here means the raw body must be
// read as text (not JSON) before any parsing happens — see
// https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
export const runtime = "nodejs";

interface ResendEmailReceivedPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    subject?: string | null;
  };
}

interface ReceivedEmail {
  text: string | null;
  html: string | null;
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

async function findUserIdByEmail(
  admin: Awaited<ReturnType<typeof createDreamcatcherAdminClient>>,
  email: string,
): Promise<string | null> {
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

async function resolveWorkspaceId(
  admin: Awaited<ReturnType<typeof createDreamcatcherAdminClient>>,
  userId: string,
): Promise<string | null> {
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

  try {
    const admin = await createDreamcatcherAdminClient();

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

    const { error } = await admin.from("captures").insert({
      workspace_id: workspaceId,
      created_by: userId,
      content,
      source: "email",
      source_external_id: emailId,
      status: "inbox",
    });

    if (error) {
      // Unique violation on (workspace_id, source, source_external_id) means
      // this email was already captured by a prior delivery of this webhook.
      if (error.code === "23505") {
        return new Response(null, { status: 200 });
      }
      throw error;
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("resend webhook: failed to process email.received", error);
    return new Response(null, { status: 500 });
  }
}
