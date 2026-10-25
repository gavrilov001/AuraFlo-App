/**
 * The Resend receiving domain confirmed operational for Dream Catcher
 * inbound email (MX verified). Overridable per-environment since a
 * local/staging setup won't share production's receiving domain.
 */
export function getInboundDomain(): string {
  return process.env.NEXT_PUBLIC_DREAMCATCHER_INBOUND_DOMAIN ?? "inbound.auraflo.com";
}

/** Builds the full address a user forwards/sends mail to for their alias. */
export function buildInboundAddress(alias: string): string {
  return `${alias}@${getInboundDomain()}`;
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
