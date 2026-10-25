import { getDreamcatcherSecrets } from "@/lib/secrets/dreamcatcher";

const FROM_ADDRESS = "AuraFlo <no-reply@auraflo.com>";

/**
 * Sends a transactional email through Resend's REST API, reusing the same
 * API key already used by the inbound webhook to fetch received-email
 * bodies (src/lib/secrets/dreamcatcher.ts). There is no Resend SDK
 * dependency in this repo — the inbound webhook already calls Resend's
 * REST API directly with fetch(), so outbound sending follows the same
 * convention instead of adding a new dependency.
 *
 * Never pass token/secret values into `html`/`text` logging — callers must
 * not log the arguments to this function.
 */
export async function sendTransactionalEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const { resendApiKey } = await getDreamcatcherSecrets();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    }),
  });

  if (!res.ok) {
    // Deliberately no response body in the log: Resend error payloads can
    // echo back request content.
    throw new Error(`Resend send failed with status ${res.status}.`);
  }
}
