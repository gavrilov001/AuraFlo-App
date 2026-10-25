"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createDreamcatcherAdminClient } from "@/lib/supabase/dreamcatcher-admin";
import {
  actionError,
  actionOk,
  parseInput,
  toMessage,
  type ActionResult,
} from "@/lib/actions/result";
import { addSenderEmailSchema, senderEmailIdSchema } from "@/lib/validation/sender-emails";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { buildVerificationEmail } from "@/lib/email/verification-templates";

// Mirrors the RPC-not-applied-yet detection used elsewhere in this app (see
// src/app/app/capture/actions.ts) — until the migration is applied in
// Supabase, these codes mean "the function doesn't exist yet", not "bad
// request".
const RPC_MISSING = new Set(["42883", "PGRST202", "PGRST203"]);

const MIGRATION_NOT_APPLIED_MESSAGE =
  "Email to Dream Catcher isn't set up on this environment yet. Ask an admin to apply the pending Supabase migration.";

function mapRpcError(error: PostgrestError): string {
  if (RPC_MISSING.has(error.code ?? "")) return MIGRATION_NOT_APPLIED_MESSAGE;
  switch (error.message) {
    case "limit_reached":
      return "You can only have up to 2 additional email addresses.";
    case "email_in_use":
      // Deliberately generic — do not reveal whether the address belongs to
      // this account, another AuraFlo account, or is just malformed.
      return "That email address can't be added.";
    case "already_verified":
      return "This address is already verified.";
    case "rate_limited":
      return "Please wait a bit before requesting another verification email.";
    case "not_found":
      return "That address could not be found.";
    default:
      return toMessage(error, "Something went wrong.");
  }
}

async function sendVerification(
  kind: "sender" | "primary",
  token: string,
  to: string,
): Promise<void> {
  const { subject, html, text } = buildVerificationEmail(kind, token);
  // `token` lives only in this call's arguments — never logged.
  await sendTransactionalEmail({ to, subject, html, text });
}

export async function addSenderEmailAction(
  input: unknown,
): Promise<ActionResult<{ id: string; emailSent: boolean }>> {
  const parsed = parseInput(addSenderEmailSchema, input);
  if (!parsed.success) return actionError(parsed.error, parsed.fieldErrors);

  try {
    // sender_email_add mints and returns a raw verification token, so it is
    // intentionally NOT callable via the user-scoped client — only
    // `service_role` has execute on it (see the migration's comments).
    // requireUser() independently verifies the session (via getClaims(),
    // not client input) before that id is trusted as p_user_id.
    const user = await requireUser();
    const admin = await createDreamcatcherAdminClient();

    const rpc = await admin.rpc("sender_email_add", {
      p_user_id: user.id,
      p_email: parsed.data.email,
    });
    if (rpc.error) return actionError(mapRpcError(rpc.error));

    const { id, token, email } = rpc.data as {
      id: string;
      token: string;
      email: string;
    };

    // The row is already committed at this point. If the send itself fails
    // (a transient Resend outage, say), that must not be reported as if the
    // whole operation failed: the row would otherwise exist in the database
    // but never become visible in the UI (no revalidate, no client-side
    // state update on an actionError return), leaving the user with no
    // Resend button to retry from — a verification they can never
    // complete without reloading the page first. Reporting success with
    // emailSent: false keeps the row visible immediately, so Resend (same
    // 60s/24h cooldown as any other resend) is the one, safe way to retry —
    // nothing is duplicated or lost either way.
    let emailSent = true;
    try {
      await sendVerification("sender", token, email);
    } catch {
      emailSent = false;
    }

    revalidatePath("/app/settings");
    return actionOk({ id, emailSent });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't add that address."));
  }
}

export async function resendSenderEmailVerificationAction(
  input: unknown,
): Promise<ActionResult<{ emailSent: boolean }>> {
  const parsed = parseInput(senderEmailIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    // Same reasoning as addSenderEmailAction above — sender_email_resend
    // also mints and returns a token.
    const user = await requireUser();
    const admin = await createDreamcatcherAdminClient();

    const rpc = await admin.rpc("sender_email_resend", {
      p_user_id: user.id,
      p_id: parsed.data.id,
    });
    if (rpc.error) return actionError(mapRpcError(rpc.error));

    const { token, email } = rpc.data as { token: string; email: string };

    // Same retry-safety reasoning as addSenderEmailAction: the new token
    // is already stored even if sending it fails, so report emailSent
    // rather than a hard error — the user can press Resend again once the
    // cooldown passes, with nothing duplicated or stuck.
    let emailSent = true;
    try {
      await sendVerification("sender", token, email);
    } catch {
      emailSent = false;
    }

    return actionOk({ emailSent });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't resend that verification."));
  }
}

export async function removeSenderEmailAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = parseInput(senderEmailIdSchema, input);
  if (!parsed.success) return actionError(parsed.error);

  try {
    await requireUser();
    const supabase = await createClient();

    const rpc = await supabase.rpc("sender_email_remove", { p_id: parsed.data.id });
    if (rpc.error) return actionError(mapRpcError(rpc.error));

    revalidatePath("/app/settings");
    return actionOk(null);
  } catch (error) {
    return actionError(toMessage(error, "We couldn't remove that address."));
  }
}

export async function requestPrimaryEmailVerificationAction(): Promise<
  ActionResult<{ emailSent: boolean }>
> {
  try {
    // Same reasoning as addSenderEmailAction above —
    // primary_email_request_verification also mints and returns a token.
    const user = await requireUser();
    const admin = await createDreamcatcherAdminClient();

    const rpc = await admin.rpc("primary_email_request_verification", {
      p_user_id: user.id,
    });
    if (rpc.error) return actionError(mapRpcError(rpc.error));

    const { token, email } = rpc.data as { token: string; email: string };

    // Same retry-safety reasoning as addSenderEmailAction.
    let emailSent = true;
    try {
      await sendVerification("primary", token, email);
    } catch {
      emailSent = false;
    }

    return actionOk({ emailSent });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't start verification."));
  }
}

export async function regenerateInboundAliasAction(): Promise<
  ActionResult<{ inboundAlias: string }>
> {
  try {
    await requireUser();
    const supabase = await createClient();

    const rpc = await supabase.rpc("inbound_alias_regenerate");
    if (rpc.error) return actionError(mapRpcError(rpc.error));

    const { inbound_alias: inboundAlias } = rpc.data as { inbound_alias: string };

    revalidatePath("/app/settings");
    return actionOk({ inboundAlias });
  } catch (error) {
    return actionError(toMessage(error, "We couldn't regenerate that address."));
  }
}
