/**
 * The Resend receiving domain confirmed operational for Dream Catcher
 * inbound email (MX verified). Overridable per-environment since a
 * local/staging setup won't share production's receiving domain. The
 * per-user random-hex inbound_alias this domain used to serve is gone
 * (decommissioned in favor of the readable dream_handle below) — this
 * domain now exists only to host the legacy shared
 * dream@<this-domain> address (getLegacyInboundAddresses()).
 */
export function getInboundDomain(): string {
  return process.env.NEXT_PUBLIC_DREAMCATCHER_INBOUND_DOMAIN ?? "inbound.auraflo.com";
}

/**
 * The Resend receiving domain for readable per-user Dream Catcher handles
 * (<handle>@this-domain, e.g. vlatko@dream.auraflo.com) — see
 * supabase/migrations/20261101000000_dream_catcher_handles.sql. This
 * domain's addresses are deliberately short and guessable (unlike a
 * capability-style random token), which is why the webhook applies an
 * extra sender-confirmation step to mail addressed here.
 */
export function getDreamDomain(): string {
  return process.env.NEXT_PUBLIC_DREAMCATCHER_DREAM_DOMAIN ?? "dream.auraflo.com";
}

/** Builds the full address a user gives out for their readable handle. */
export function buildDreamAddress(handle: string): string {
  return `${handle}@${getDreamDomain()}`;
}

/**
 * The original shared inbound address(es) the currently-working legacy
 * Email → Dream Catcher integration already receives mail at, routed
 * entirely by sender (From header) rather than by a personal alias. The
 * webhook allows the legacy from-header path ONLY for an exact match
 * against one of these — never for "any address we didn't recognize",
 * which would let an unmatched, malformed, or revoked personal alias fall
 * back to spoofable sender-only routing. Confirmed value: dream@<inbound
 * domain>. Overridable (comma-separated) for an environment with a
 * different legacy address on file.
 */
export function getLegacyInboundAddresses(): string[] {
  const raw = process.env.DREAMCATCHER_LEGACY_INBOUND_ADDRESSES;
  const list = raw && raw.trim() ? raw.split(",") : [`dream@${getInboundDomain()}`];
  return list.map((a) => a.trim().toLowerCase()).filter(Boolean);
}
