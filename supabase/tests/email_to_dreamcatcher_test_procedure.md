# Email to Dream Catcher — verification procedure

**Obsolete as of `20261102000000_remove_legacy_inbound_alias.sql`:** section
5 (`inbound_alias_regenerate`) and section 6's cases 1–5 and 9, which test
routing via `profiles.inbound_alias` — that column, its RPC, and every
stored value are gone once that migration is applied. Section 6's cases 6–8
(the legacy shared `dream@inbound.auraflo.com` address, idempotency, and
malformed-recipient handling) are unaffected and still apply. Everything
about the readable `dream_handle` address added by
`20261101000000_dream_catcher_handles.sql` was instead verified directly
against a disposable local Postgres sandbox during that change's own review
— see that migration's header for what was covered.

This procedure is intentionally not executed by the repository checks. Run it
against a disposable local Supabase database or a dedicated staging project
after applying `20261026120000_email_to_dreamcatcher.sql` on top of every
prior migration. Do not run against production data.

Use separate authenticated Supabase clients for: User A, User B (a different
account, not a workspace member of A — this feature is user-owned, not
workspace-shared), and a **service-role client** — required for this
section's calls, see below. `playwright/tests/settings-email-to-dreamcatcher.spec.ts`
covers everything reachable through the UI without receiving real mail; this
procedure covers the parts that require either a real token (sent by email,
not visible to the UI test) or direct RPC calls.

**Calling convention, read before running sections 1–4**: `sender_email_add`,
`sender_email_resend`, and `primary_email_request_verification` each mint and
return a raw verification token, so none of them are callable with a plain
authenticated-user client — only `service_role` has `EXECUTE` on them (see
the migration's comments). Wherever a step below says "as User A, call
`sender_email_add(...)`", that means: **using a service-role client**, call
`sender_email_add(p_user_id => '<User A's uuid>', p_email => '...')` — i.e.
exactly what `sender-emails-actions.ts` does after independently resolving
User A's id from their own verified session. Section 7 below is the
regression test proving a plain authenticated client *cannot* call these
three directly.

## 1. Primary email verification

1. Using a **service-role client**, call
   `primary_email_request_verification(p_user_id => '<A's uuid>')`. Assert it
   returns `{ token, email }` with `email` equal to A's `auth.users.email`,
   and that `profiles.primary_email_verification_token_hash` is now set to
   `sha256(token)` hex-encoded (never the raw token) with
   `primary_email_verification_expires_at` ~30 minutes out.
2. Call `primary_email_verify(token)` as an **unauthenticated** (anon) client.
   Assert it succeeds, returns `{ ok: true }`, and
   `profiles.primary_email_verified_at` / `primary_email_verified_email` are
   now set, with the token hash cleared.
3. Call `primary_email_verify(token)` again with the same token. Assert it
   fails with message `invalid_token` (single-use — the hash was cleared in
   step 2, so no row matches anymore).
4. Repeat step 1 (service-role, same `p_user_id`). Assert it fails with
   message `already_verified` (no new token minted once verified, unless the
   verified snapshot no longer matches the current auth email — not covered
   here).
5. **Expiry:** repeat step 1, then manually set
   `primary_email_verification_expires_at` to a past timestamp. Call
   `primary_email_verify(token)`. Assert it fails with `expired_token`.
6. **Rate limit:** repeat step 1 twice in immediate succession (service-role,
   same `p_user_id`). Assert the second call fails with `rate_limited`
   (60-second cooldown).

## 2. Additional sender address lifecycle

1. Using a **service-role client**, call
   `sender_email_add(p_user_id => '<A's uuid>', p_email => 'second@example.com')`.
   Assert it returns `{ id, token, email }` and inserts a `user_sender_emails`
   row with `status = 'pending'`.
2. Call `sender_email_verify(token)` unauthenticated. Assert `status`
   flips to `'verified'`, `verified_at` is set, token hash cleared.
3. Repeat step 1 (service-role, same `p_user_id`, same email). Assert it
   fails with `email_in_use` (global uniqueness on `email_normalized`, even
   though the first row is now verified rather than pending).
4. Add a second address for A, e.g. `third@example.com` (succeeds — 2nd of
   2, service-role call). Attempt a third: `fourth@example.com`. Assert it
   fails with `limit_reached`.
5. As User A (**their own authenticated client is fine here** —
   `sender_email_remove` returns no token, see Section 7's rationale): call
   `sender_email_remove(id)` for one of the two rows. Assert the row is gone
   and a new service-role `sender_email_add` call now succeeds again.
6. As User A, call `sender_email_remove(id)` for a row that does not belong
   to A (use an id from User B's rows in section 4 below). Assert it fails
   with `not_found` — never leaks whether the id exists for someone else.

## 3. Cross-account collision (the identity-uniqueness requirement)

All calls in this section are service-role, `p_user_id` as noted.

1. As B (`p_user_id => '<B's uuid>'`): attempt
   `sender_email_add(p_email => '<A's primary auth email>')`. Assert it
   fails with `email_in_use`. Confirm no row was inserted.
2. As A: attempt `sender_email_add(p_email => '<A's own primary auth email>')`.
   Assert it also fails with `email_in_use` (adding your own primary as an
   "additional" address is rejected the same way, not treated as a no-op).
3. As B: add and verify `shared@example.com`. As A: attempt
   `sender_email_add(p_email => 'shared@example.com')`. Assert `email_in_use`
   (global normalized-email uniqueness blocks it regardless of status).

## 4. Concurrency — the 2-address cap under a race

1. As A (two service-role connections in parallel, or two `psql` sessions):
   fire `sender_email_add(p_user_id => '<A's uuid>', p_email => 'race1@example.com')`
   and the same with `race2@example.com` at the same time, with A already
   having 1 existing address. Assert exactly one succeeds and the other
   fails with `limit_reached` — never both succeeding and leaving 3 rows.
   This exercises `pg_advisory_xact_lock` in both `sender_email_add` and the
   `_user_sender_emails_enforce_limit` trigger; rerun a few times since a
   race only reproduces reliably under real concurrent connections, not two
   sequential calls in one session.

## 5. inbound_alias_regenerate

1. Note User A's current `profiles.inbound_alias`. Call
   `inbound_alias_regenerate()` as User A. Assert it returns a new
   32-hex-character alias different from the old one, and
   `profiles.inbound_alias` is updated to it.
2. Confirm the old alias no longer appears in `profiles.inbound_alias` for
   any row (so an inbound email to the old address falls through to "no
   alias matched" in the webhook, per section 6 below — never silently
   still works).

## 6. Inbound webhook routing (simulate `email.received`, service-role)

Set up: User A verified their primary email (section 1) and one additional
address (section 2). User B exists with their own primary email, verified.

1. **Alias + verified primary sender → routes to A.** Simulate a payload
   with `to: ["<A's alias>@inbound.auraflo.com"]`, `from: "<A's primary
   email>"`. Assert a `captures` row is inserted with
   `created_by = A`, `workspace_id` = A's earliest workspace,
   `source = 'email'`.
2. **Alias + verified additional sender → routes to A.** Same alias, `from`
   = A's verified additional address. Assert it routes identically.
3. **Alias + unverified/unknown sender → ignored, not misrouted.** Same
   alias, `from: "someone-else@example.com"` (not a verified address for A).
   Assert **no** capture is inserted and the webhook still returns 200.
4. **Alias + User B's sender address → ignored, not routed to B.** Same
   alias (A's), `from` = B's own verified primary email. Assert no capture
   is inserted anywhere — a verified sender identity for B does not
   authorize writing into A's Dream Catcher just because B happens to be a
   genuine AuraFlo user. (This is the "avoid accidentally routing into
   another user's workspace" requirement.)
5. **Ambiguous recipients → ignored.** Payload with
   `to: ["<A's alias>@inbound.auraflo.com", "<B's alias>@inbound.auraflo.com"]`.
   Assert no capture is inserted for either user.
6. **Legacy address, exact match → legacy path (regression).** Payload with
   `to: ["dream@inbound.auraflo.com"]` (the one recognized legacy address,
   `getLegacyInboundAddresses()` in `src/lib/email/inbound-address.ts`),
   `from` = A's primary email (verified or not — the legacy path doesn't
   check verification, by design, to avoid breaking current users). Assert
   it routes to A exactly as the original from-header-only logic did before
   this migration.
6a. **Unmatched address that is NOT the legacy address → ignored, no
   fallback.** Payload with `to: ["someone@inbound.auraflo.com"]` — a local
   part that matches neither a known `profiles.inbound_alias` nor
   `dream@inbound.auraflo.com` — `from` = A's primary email. Assert **no**
   capture is inserted. This is the fix from this round of review: merely
   "no alias matched" must never fall back to sender-only routing; only an
   exact legacy-address match may.
7. **Idempotency.** Redeliver the exact payload from case 6 (same
   `email_id`) a second time. Assert still exactly one `captures` row for
   that `email_id` (unique index on `(workspace_id, source,
   source_external_id)` still enforced; webhook returns 200, not 500, on the
   resulting unique-violation).
8. **Malformed `to`/`received_for`.** Payload with `to: []`,
   `received_for` absent, `from` = A's verified primary email. Assert it is
   ignored (no legacy address present, so no fallback) — never errors.
9. **Revoked alias.** Using the pre-regeneration alias from section 5, step
   1 (now stale), repeat case 1 (`to` = the old, now-revoked alias; `from` =
   A's verified primary email). Assert it does **not** route and does
   **not** fall back to the legacy path either (the old alias is not
   `profiles.inbound_alias` for anyone anymore, and it is not the
   recognized legacy address) — it is simply ignored. The old address is
   fully inert after regeneration, never quietly still valid under either
   path.
10. **Stale primary-email verification after an email change.** As User A
   (verified primary email per section 1): change `auth.users.email` to a
   new address (e.g. via `auth.admin.updateUserById`). Confirm the
   `email_to_dreamcatcher_clear_primary_verification` trigger fired:
   `profiles.primary_email_verified_at` / `primary_email_verified_email` /
   token columns are now null. Repeat case 1's payload with `from` = A's
   *old* (pre-change) email. Assert it does **not** route — the old
   address no longer approves anything, even though it was genuinely
   verified before the change.
11. **Direct-write lockdown.** As User A (their own authenticated client,
   not service-role): attempt
   `supabase.from('profiles').update({ primary_email_verified_at: new Date().toISOString() }).eq('id', A.id)`.
   Assert this fails with a permission error (`42501` / "permission denied
   for column primary_email_verified_at") — confirms the column-level
   `revoke update on public.profiles from authenticated` /
   `grant update (full_name, timezone) ...` actually closes the gap where
   `profiles_update_own`'s row-level RLS would otherwise have allowed this.
   Also confirm `updateProfileAction`'s existing `full_name`/`timezone`
   update still succeeds unaffected.
12. **Add-side rate limit survives delete/recreate.** As A (service-role):
   call `sender_email_add` five times in quick succession, each followed by
   an (authenticated-client) `sender_email_remove` on the row it just
   created (clearing the 2-address cap each time so only the per-user
   throttle is being tested). Assert the 6th `sender_email_add` within the
   same hour fails with `rate_limited` — confirms
   `profiles.sender_email_add_count_1h` persists across the delete/recreate
   cycle rather than resetting with each new row.

## 7. Trust boundary: a direct RPC call cannot retrieve a token

This is the regression this round of review exists for. Automated coverage:
`playwright/tests/settings-email-to-dreamcatcher.spec.ts`'s "a direct RPC
call cannot retrieve a verification token" test performs this exact attack
over raw HTTP against a real signed-up account. This section is the DB-level
equivalent, useful to re-run by hand after applying the migration.

1. Sign in as a plain user (not service-role) — e.g. via the Supabase JS
   client with the publishable/anon key and a real email+password, exactly
   as the app's browser client would.
2. As that plain authenticated client, call
   `sender_email_add(p_email => 'victim@example.com')` (note: omitting
   `p_user_id` — the old signature). Assert this fails at the **grant**
   level (Postgres `insufficient_privilege`, `42501`; PostgREST surfaces
   this as HTTP 403) — the call never reaches the function body, and
   critically, no token is ever generated or returned.
3. Repeat for `sender_email_resend(p_id => '<any uuid>')` and
   `primary_email_request_verification()`. Same result: `42501`/403, no
   token.
4. Confirm via `pg_proc`/`information_schema.routine_privileges` that
   `authenticated` and `anon` have **no** `EXECUTE` privilege on
   `sender_email_add(uuid, text)`, `sender_email_resend(uuid, uuid)`, or
   `primary_email_request_verification(uuid)` — only `service_role` does.
5. Confirm the *reverse* still works: `primary_email_verify(text)` and
   `sender_email_verify(text)` remain callable by `anon` and `authenticated`
   (these consume a token the caller must already possess — a 256-bit
   random value no one can feasibly guess — so granting them broadly is
   correct and is what makes the emailed link usable by someone who isn't
   even signed in).
6. **Data minimization regression**: as User A, `select * from
   user_sender_emails where user_id = '<A's uuid>'` via their own
   authenticated client (RLS-permitted — it's their own row) and confirm
   the row *does* include `verification_token_hash` at the database level
   (RLS doesn't hide columns). Then confirm `src/app/app/settings/page.tsx`
   only ever queries `select("id, email, status, created_at")` — never
   `select("*")` — so that hash is never actually serialized into the
   Settings page's props even though RLS would technically allow reading it.

## 8. Pre-migration safety (run this against a database *without* the
   migration applied, before applying it)

1. Send the exact same `email.received` webhook payload this app already
   receives in production today (`to` pointing at the real legacy address,
   `from` a known user's primary email, no personal alias anywhere in
   play). Assert it behaves identically to the pre-migration code: a
   capture is inserted via the from-header match, and the response is 200.
   This confirms deploying the application code ahead of running the
   migration does not interrupt the currently-working integration —
   `resolveUserByAlias`/`isApprovedSender`'s schema-not-ready guards must
   make every new code path a silent no-op until the migration lands, and
   `recipientsIncludeLegacyAddress()` has no database dependency at all (it
   only reads `getLegacyInboundAddresses()`, an env-var/constant), so it
   behaves identically before and after the migration.

## Catalog check

After applying, confirm:
- `pg_type` has `sender_email_status` with labels `pending`, `verified`.
- `user_sender_emails` has `rowsecurity = true`, exactly one policy
  (`user_sender_emails_select_own`, `cmd = 'r'`) — no insert/update/delete
  policy exists for `authenticated` or `anon`.
- Every RPC in this migration has `prosecdef = true` and empty `proconfig`
  search_path.
- `inbound_alias_regenerate()` and `sender_email_remove(uuid)` grant execute
  to `authenticated` only — `anon`/`public`/`service_role`-exclusive have
  none beyond the standard role (neither returns a token, both still
  identify the caller via `auth.uid()`).
- `primary_email_request_verification(uuid)`, `sender_email_add(uuid, text)`,
  and `sender_email_resend(uuid, uuid)` grant execute to **`service_role`
  only** — `authenticated` and `anon` have none. This is the fix from this
  round of review: these three mint and return a raw token, so they must
  never be reachable by a plain authenticated client (see Section 7).
- `primary_email_verify(text)` and `sender_email_verify(text)` have
  `prosecdef = true` and grant execute to **both** `anon` and
  `authenticated` (intentional and unchanged — see the migration's comments
  on why the token itself is the authorization for these two).
- `profiles.inbound_alias` is `not null` with a unique index; no two
  profiles rows share one.
- `authenticated`'s table-level `UPDATE` privilege on `public.profiles` is
  gone (`has_table_privilege('authenticated', 'public.profiles', 'UPDATE')`
  is `false`); its column-level grant covers exactly `full_name, timezone`
  (`has_column_privilege` true for those two, false for every
  `primary_email_verified_*`/`primary_email_verification_*`/`inbound_alias`
  column).
- `auth.users` has a trigger `email_to_dreamcatcher_clear_primary_verification`
  (`after update of email`) calling
  `public._clear_stale_primary_email_verification()`, which is
  `prosecdef = true` with no execute grant to `anon`/`authenticated`.
- `profiles.sender_email_add_last_at` / `sender_email_add_count_1h` exist
  and default to `null` / `0`.
