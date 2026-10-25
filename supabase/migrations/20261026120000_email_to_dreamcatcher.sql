-- ============================================================================
-- AuraFlo — Email to Dream Catcher: verified additional sender addresses
--
-- Additive (new enum, new table, new columns, new functions) with two
-- deliberate exceptions, both required to close a real hole found in
-- security review and neither touching any existing data or behavior other
-- users rely on:
--   1. A column-level UPDATE privilege change on public.profiles (see the
--      "Column-level privilege lockdown" section below) — without it, the
--      pre-existing profiles_update_own RLS policy (row-level, not
--      column-level) would let any user directly UPDATE their own
--      primary_email_verified_at / inbound_alias / verification-token
--      columns via a raw PostgREST call, bypassing every RPC below.
--   2. A new AFTER UPDATE trigger on auth.users (see "Invalidate stale
--      primary-email verification on email change") — the same elevated
--      privilege the project's existing handle_new_user trigger on
--      auth.users already uses; adds a trigger, does not alter the table.
-- Does NOT touch the `capture_source` enum (already has 'email' live).
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- What this adds:
--   * public.sender_email_status enum ('pending', 'verified')
--   * public.user_sender_emails   — up to 2 additional verified sender
--                                   addresses per user
--   * profiles.inbound_alias and five primary_email_verification_* columns
--     — the primary account email must go through the same one-time
--     verification as additional addresses before it counts as "approved"
--     for inbound routing (Supabase email confirmation is disabled for this
--     project, so auth.users.email is not provably owned by the signer-upper)
--   * SECURITY DEFINER RPCs for every mutation (add/resend/remove/verify an
--     address, request/verify primary-email ownership, regenerate the
--     inbound alias). RLS on user_sender_emails only exposes `select` for the
--     owning row — every write goes through one of these RPCs so the
--     verification-token lifecycle, the per-user cap, and the
--     cross-account-collision check can't be bypassed by a direct table
--     write even if a future change grants broader table privileges.
--
-- Security notes (see the architecture audit in conversation history):
--   * Resend's email.received webhook/API does not expose SPF/DKIM/DMARC
--     verdicts (confirmed against current docs) — this schema does not
--     attempt to rely on any such field.
--   * auth.users.email_confirmed_at is NOT a trust signal here: with
--     Supabase email confirmations disabled, it is set at signup regardless
--     of whether the address was ever actually controlled by the signer-up.
--     Hence the separate primary_email_verified_* columns/flow below.
--   * inbound_alias is a 16-random-byte (128-bit) capability, not a secret
--     that's ever meant to stay hidden from the account owner — it's shown
--     and copied in Settings. Its security property is unguessability by
--     anyone else, not confidentiality from its own owner. It can be
--     regenerated (public.inbound_alias_regenerate()) to revoke the old one
--     instantly if ever leaked/shared.
-- ============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Enum + columns
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.sender_email_status as enum ('pending', 'verified');
exception when duplicate_object then null;
end $$;

alter table public.profiles
  -- DEFAULT (not just a one-time backfill) is required here: handle_new_user()
  -- (supabase_initial_schema.sql) inserts into profiles with an explicit
  -- column list — "insert into public.profiles (id, full_name, avatar_url,
  -- timezone) values (...)" — that does not mention inbound_alias. Without a
  -- column default, every signup after this migration would hit a NOT NULL
  -- violation on insert and fail outright. This default also means
  -- handle_new_user never needs to be touched.
  add column if not exists inbound_alias text default encode(extensions.gen_random_bytes(16), 'hex'),
  add column if not exists primary_email_verified_email text,
  add column if not exists primary_email_verified_at timestamptz,
  add column if not exists primary_email_verification_token_hash text,
  add column if not exists primary_email_verification_expires_at timestamptz,
  add column if not exists primary_email_verification_last_sent_at timestamptz,
  add column if not exists primary_email_verification_send_count_24h integer not null default 0,
  -- Per-user throttle on sender_email_add itself (not per-row, unlike the
  -- resend/primary cooldowns above): without this, a user could spam an
  -- arbitrary third party's inbox with verification emails by repeating
  -- add -> remove -> add, since each add() creates a brand-new row whose
  -- own cooldown counters start fresh at 1/now(). This column persists
  -- across that delete/recreate cycle, closing that bypass.
  add column if not exists sender_email_add_last_at timestamptz,
  add column if not exists sender_email_add_count_1h integer not null default 0;

-- Belt-and-suspenders backfill: a volatile-function column DEFAULT added via
-- ALTER TABLE ADD COLUMN is evaluated per existing row by Postgres rather
-- than taking the metadata-only fast-default path (that optimization only
-- applies to constant defaults), so every pre-existing row should already
-- have a unique value from the DEFAULT clause above. This explicit backfill
-- is kept anyway so the NOT NULL constraint below never depends on that
-- optimizer behavior being exactly right.
update public.profiles
   set inbound_alias = encode(extensions.gen_random_bytes(16), 'hex')
 where inbound_alias is null;

alter table public.profiles
  alter column inbound_alias set not null;

create unique index if not exists profiles_inbound_alias_unique_idx
  on public.profiles (inbound_alias);

create unique index if not exists profiles_primary_email_verification_token_hash_idx
  on public.profiles (primary_email_verification_token_hash)
  where primary_email_verification_token_hash is not null;

create table if not exists public.user_sender_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(btrim(email)) > 0 and char_length(email) <= 320),
  email_normalized text generated always as (lower(btrim(email))) stored,
  status public.sender_email_status not null default 'pending',
  verification_token_hash text,
  verification_expires_at timestamptz,
  verification_last_sent_at timestamptz,
  verification_send_count_24h integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_sender_emails_email_normalized_unique unique (email_normalized)
);

create index if not exists user_sender_emails_user_id_idx
  on public.user_sender_emails (user_id);

create unique index if not exists user_sender_emails_verification_token_hash_idx
  on public.user_sender_emails (verification_token_hash)
  where verification_token_hash is not null;

-- -----------------------------------------------------------------------------
-- RLS — select-only for the owning user; every write goes through an RPC.
-- -----------------------------------------------------------------------------

alter table public.user_sender_emails enable row level security;

drop policy if exists user_sender_emails_select_own on public.user_sender_emails;
create policy user_sender_emails_select_own
on public.user_sender_emails for select
to authenticated
using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table-level invariants (defense in depth — the RPCs below already enforce
-- these; these triggers hold even if a future change grants a broader table
-- privilege or adds another insert/update path).
-- -----------------------------------------------------------------------------

create or replace function public._user_sender_emails_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select count(*) into v_count
    from public.user_sender_emails
   where user_id = new.user_id;
  if v_count >= 2 then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists user_sender_emails_enforce_limit on public.user_sender_emails;
create trigger user_sender_emails_enforce_limit
before insert on public.user_sender_emails
for each row execute function public._user_sender_emails_enforce_limit();

create or replace function public._user_sender_emails_prevent_primary_collision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from auth.users where lower(email) = new.email_normalized
  ) then
    raise exception 'email_in_use' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists user_sender_emails_prevent_primary_collision on public.user_sender_emails;
create trigger user_sender_emails_prevent_primary_collision
before insert or update of email on public.user_sender_emails
for each row execute function public._user_sender_emails_prevent_primary_collision();

revoke all on function public._user_sender_emails_enforce_limit() from public, anon, authenticated;
revoke all on function public._user_sender_emails_prevent_primary_collision() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Token hashing helper. Only sha256 hashes are ever persisted — raw tokens
-- exist only in memory for the single request that mints them and the
-- outbound email sent immediately after (app code must never log them).
-- -----------------------------------------------------------------------------

create or replace function public._hash_verification_token(p_token text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke all on function public._hash_verification_token(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- inbound_alias_regenerate — revoke/rotate the caller's inbound alias.
-- -----------------------------------------------------------------------------

create or replace function public.inbound_alias_regenerate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_alias text;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_alias := encode(extensions.gen_random_bytes(16), 'hex');
    begin
      update public.profiles set inbound_alias = v_alias where id = v_uid;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'Could not generate a unique address, please try again.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  return jsonb_build_object('inbound_alias', v_alias);
end;
$$;

revoke all on function public.inbound_alias_regenerate() from public, anon, authenticated;
grant execute on function public.inbound_alias_regenerate() to authenticated;

-- -----------------------------------------------------------------------------
-- primary_email_request_verification / primary_email_verify
--
-- SECURITY: primary_email_request_verification mints and returns a raw
-- verification token. It must NEVER be callable by `authenticated` —
-- PostgREST exposes every granted RPC identically to any caller holding a
-- valid session, regardless of which application code "meant" to call it.
-- If this were granted to `authenticated`, any signed-in user could call it
-- directly via the Supabase REST API (bypassing the Next.js Server Action
-- entirely), receive the token in the response, and self-verify — the
-- Server Action calling the *same* RPC as the *same* role is not a
-- distinguishable, privileged channel. Only `service_role` (never exposed
-- to the browser, held only by the Next.js server process) may call it.
-- Identity is therefore passed explicitly as p_user_id rather than read via
-- auth.uid() — a service-role call carries no end-user JWT/claims at all —
-- and the caller (src/app/app/settings/sender-emails-actions.ts) sources
-- that id from requireUser()'s independently-verified session, never from
-- client-supplied input, before calling this function with the admin
-- client. Once minted, the token is used in that same server request to
-- send the verification email and is never returned to the browser.
-- -----------------------------------------------------------------------------

create or replace function public.primary_email_request_verification(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_profile public.profiles;
  v_token text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'No account email on file.' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;

  if v_profile.primary_email_verified_at is not null
     and v_profile.primary_email_verified_email = lower(btrim(v_email)) then
    raise exception 'already_verified' using errcode = 'P0001';
  end if;

  if v_profile.primary_email_verification_last_sent_at is not null
     and v_profile.primary_email_verification_last_sent_at > now() - interval '60 seconds' then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_profile.primary_email_verification_last_sent_at is not null
     and v_profile.primary_email_verification_last_sent_at > now() - interval '24 hours'
     and v_profile.primary_email_verification_send_count_24h >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.profiles
     set primary_email_verification_token_hash = public._hash_verification_token(v_token),
         primary_email_verification_expires_at = now() + interval '30 minutes',
         primary_email_verification_send_count_24h =
           case
             when primary_email_verification_last_sent_at is null
                  or primary_email_verification_last_sent_at < now() - interval '24 hours'
             then 1
             else primary_email_verification_send_count_24h + 1
           end,
         primary_email_verification_last_sent_at = now()
   where id = p_user_id;

  return jsonb_build_object('token', v_token, 'email', v_email);
end;
$$;

revoke all on function public.primary_email_request_verification(uuid) from public, anon, authenticated;
grant execute on function public.primary_email_request_verification(uuid) to service_role;

create or replace function public.primary_email_verify(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_current_email text;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select * into v_profile
    from public.profiles
   where primary_email_verification_token_hash = public._hash_verification_token(p_token)
   for update;

  if not found then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  if v_profile.primary_email_verification_expires_at is null
     or v_profile.primary_email_verification_expires_at < now() then
    raise exception 'expired_token' using errcode = 'P0001';
  end if;

  select email into v_current_email from auth.users where id = v_profile.id;

  update public.profiles
     set primary_email_verified_email = lower(btrim(v_current_email)),
         primary_email_verified_at = now(),
         primary_email_verification_token_hash = null,
         primary_email_verification_expires_at = null
   where id = v_profile.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.primary_email_verify(text) from public, anon, authenticated;
-- Callable without a session: the link is clicked from a mail client. The
-- unguessable token IS the authorization — anon execute is intentional and
-- safe, since the function itself never trusts auth.uid().
grant execute on function public.primary_email_verify(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- sender_email_add / sender_email_resend / sender_email_remove / sender_email_verify
--
-- SECURITY: sender_email_add and sender_email_resend both mint and return a
-- raw verification token, so — same reasoning as
-- primary_email_request_verification above — neither may be granted to
-- `authenticated`. Both take an explicit p_user_id, called only via the
-- service-role admin client from sender-emails-actions.ts, with that id
-- sourced from requireUser()'s verified session. sender_email_remove below
-- returns no token (just ok/not_found) and stays on the original
-- auth.uid()-scoped, `authenticated`-callable design — there is nothing in
-- its response for a direct caller to extract.
-- -----------------------------------------------------------------------------

create or replace function public.sender_email_add(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_token text;
  v_count integer;
  v_profile public.profiles;
begin
  if p_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_email = '' or char_length(v_email) > 320
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_profile from public.profiles where id = p_user_id for update;

  -- Per-user throttle: survives a delete/recreate cycle, unlike the per-row
  -- cooldowns on resend/primary verification — see the column comment on
  -- profiles.sender_email_add_last_at.
  if v_profile.sender_email_add_last_at is not null
     and v_profile.sender_email_add_last_at > now() - interval '60 seconds' then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_profile.sender_email_add_last_at is not null
     and v_profile.sender_email_add_last_at > now() - interval '1 hour'
     and v_profile.sender_email_add_count_1h >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.user_sender_emails where user_id = p_user_id;
  if v_count >= 2 then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'email_in_use' using errcode = '23505';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.user_sender_emails (
      user_id, email, status,
      verification_token_hash, verification_expires_at,
      verification_last_sent_at, verification_send_count_24h
    ) values (
      p_user_id, v_email, 'pending',
      public._hash_verification_token(v_token), now() + interval '30 minutes',
      now(), 1
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'email_in_use' using errcode = '23505';
  end;

  update public.profiles
     set sender_email_add_last_at = now(),
         sender_email_add_count_1h =
           case
             when sender_email_add_last_at is null
                  or sender_email_add_last_at < now() - interval '1 hour'
             then 1
             else sender_email_add_count_1h + 1
           end
   where id = p_user_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email);
end;
$$;

revoke all on function public.sender_email_add(uuid, text) from public, anon, authenticated;
grant execute on function public.sender_email_add(uuid, text) to service_role;

create or replace function public.sender_email_resend(p_user_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_sender_emails;
  v_token text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row
    from public.user_sender_emails
   where id = p_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'verified' then
    raise exception 'already_verified' using errcode = 'P0001';
  end if;

  if v_row.verification_last_sent_at is not null
     and v_row.verification_last_sent_at > now() - interval '60 seconds' then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_row.verification_last_sent_at is not null
     and v_row.verification_last_sent_at > now() - interval '24 hours'
     and v_row.verification_send_count_24h >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.user_sender_emails
     set verification_token_hash = public._hash_verification_token(v_token),
         verification_expires_at = now() + interval '30 minutes',
         verification_send_count_24h =
           case
             when verification_last_sent_at is null
                  or verification_last_sent_at < now() - interval '24 hours'
             then 1
             else verification_send_count_24h + 1
           end,
         verification_last_sent_at = now()
   where id = p_id;

  return jsonb_build_object('token', v_token, 'email', v_row.email);
end;
$$;

revoke all on function public.sender_email_resend(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sender_email_resend(uuid, uuid) to service_role;

create or replace function public.sender_email_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.user_sender_emails where id = p_id and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sender_email_remove(uuid) from public, anon, authenticated;
grant execute on function public.sender_email_remove(uuid) to authenticated;

create or replace function public.sender_email_verify(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_sender_emails;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.user_sender_emails
   where verification_token_hash = public._hash_verification_token(p_token)
   for update;
  if not found then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  if v_row.verification_expires_at is null or v_row.verification_expires_at < now() then
    raise exception 'expired_token' using errcode = 'P0001';
  end if;

  update public.user_sender_emails
     set status = 'verified',
         verified_at = now(),
         verification_token_hash = null,
         verification_expires_at = null
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'email', v_row.email);
end;
$$;

revoke all on function public.sender_email_verify(text) from public, anon, authenticated;
-- Same rationale as primary_email_verify: the token is the authorization.
grant execute on function public.sender_email_verify(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Column-level privilege lockdown on profiles.
--
-- profiles_update_own (existing RLS policy, supabase_initial_schema.sql) lets
-- an authenticated user UPDATE their own profiles row — used today by
-- updateProfileAction for full_name/timezone. RLS is row-level, not
-- column-level: without this, that same policy would also let a user
-- directly UPDATE their own primary_email_verified_at, primary_email_verified_email,
-- inbound_alias, or any verification-token column via a raw PostgREST call —
-- e.g. supabase.from('profiles').update({ primary_email_verified_at: 'now()' })
-- — completely bypassing every RPC above and self-certifying their own email
-- as verified. Revoking the blanket table-level UPDATE grant and re-granting
-- only the two columns the app actually writes directly closes this
-- regardless of RLS. (user_sender_emails needs no equivalent fix: it has no
-- insert/update policy for authenticated/anon at all, so RLS alone already
-- blocks every direct write to it — see this migration's RLS section above.)
-- -----------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
grant update (full_name, timezone) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Invalidate stale primary-email verification when auth.users.email changes.
--
-- primary_email_verified_email is a snapshot of the exact address that was
-- proven at verification time. If the user's Supabase Auth email later
-- changes (e.g. via a future account-settings feature, or supabase.auth.
-- updateUser() called directly), that snapshot would otherwise keep
-- approving the OLD address forever — including for whoever controls that
-- mailbox after the user stops using it. This trigger clears the
-- verification the instant the underlying email changes, forcing a fresh
-- verification cycle for the new address. Requires the same elevated
-- privilege the project's existing handle_new_user trigger on auth.users
-- already uses (adds a trigger; does not alter the auth.users table itself).
-- src/app/api/webhooks/resend/route.ts's isApprovedSender() additionally
-- re-checks the current auth email at read time, as defense in depth for
-- any row that predates this trigger.
-- -----------------------------------------------------------------------------

create or replace function public._clear_stale_primary_email_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is distinct from new.email then
    update public.profiles
       set primary_email_verified_email = null,
           primary_email_verified_at = null,
           primary_email_verification_token_hash = null,
           primary_email_verification_expires_at = null
     where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public._clear_stale_primary_email_verification() from public, anon, authenticated;

drop trigger if exists email_to_dreamcatcher_clear_primary_verification on auth.users;
create trigger email_to_dreamcatcher_clear_primary_verification
after update of email on auth.users
for each row execute function public._clear_stale_primary_email_verification();

commit;
