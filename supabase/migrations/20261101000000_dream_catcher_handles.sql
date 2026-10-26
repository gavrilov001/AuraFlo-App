-- ============================================================================
-- AuraFlo — Dream Catcher: readable @dream.auraflo.com addresses
--
-- Adds a second, human-readable personal address per user
-- (<handle>@dream.auraflo.com, e.g. vlatko@dream.auraflo.com) alongside
-- the existing random-hex inbound_alias (profiles.inbound_alias,
-- 20261026120000_email_to_dreamcatcher.sql). That address stays fully
-- intact — this migration never touches it, inbound_alias_regenerate(), or
-- the legacy dream@inbound.auraflo.com from-header path.
--
-- Security context (see the architecture review in conversation history —
-- also already noted in 20261026120000_email_to_dreamcatcher.sql's header):
-- Resend's receiving API does not expose a documented/trustworthy
-- SPF/DKIM/DMARC verdict for a received message (verified directly against
-- Resend's published OpenAPI spec — no such field exists). That's fine for
-- inbound_alias, which is a 128-bit unguessable capability: sender-address
-- matching alone is an adequate trust boundary when the recipient address
-- itself can't be guessed. It is NOT fine for this new handle, which is
-- deliberately short and guessable (first name, +digit on collision) — an
-- attacker who guesses vlatko@dream.auraflo.com and spoofs
-- `From: vlatko.gavrilov@auraflo.com` would otherwise pass the exact same
-- sender-match check that protects inbound_alias today.
--
-- The added safeguard is a first-use sender confirmation handshake, scoped
-- ONLY to this new handle route (inbound_alias and the legacy address are
-- unaffected): the first email from a given (user, sender) pair arriving at
-- the handle address is held in pending_dream_captures rather than inserted
-- into captures, and a one-time confirmation link is emailed to the user's
-- VERIFIED PRIMARY address only (profiles.primary_email_verified_email —
-- never the live, possibly-unverified auth.users.email). Confirming inserts
-- the capture and adds the pair to dream_confirmed_senders, so every
-- subsequent email from that sender captures immediately with no further
-- friction.
--
-- ============================================================================
-- REMAINING RISK — read before relying on this as "sender authentication".
-- ============================================================================
-- The handshake stops a stranger's FIRST message: an attacker who guesses
-- the handle and spoofs an approved sender's address cannot complete it,
-- because they don't control the real mailbox the confirm link goes to, and
-- a user who didn't send the message won't click confirm.
--
-- It does NOT stop spoofing of a sender who has already been confirmed.
-- Once a (user, sender) pair is in dream_confirmed_senders, every later
-- message claiming that From address auto-captures with NO further check —
-- forever, with no expiry. An attacker who later learns or guesses that
-- exact address (most likely candidate: the account's own primary email,
-- which is frequently derivable from the handle itself) can spoof it at any
-- time after the real sender's first legitimate message, and this schema
-- cannot distinguish that from the real sender. This is not a bug to be
-- patched by more code here — it is a hard ceiling imposed by what Resend's
-- receiving API exposes: no SPF/DKIM/DMARC verdict, no raw envelope/Received
-- chain, nothing that distinguishes a genuine SMTP delivery from a forged
-- From header (verified directly against Resend's published OpenAPI spec).
--
-- A time-boxed ("sliding window") expiry on dream_confirmed_senders was
-- considered and deliberately rejected: a forged message that successfully
-- auto-captures during an active window would renew the window exactly as a
-- genuine one does, so it bounds nothing an attacker couldn't already get
-- by sending one real-looking message per window — no benefit independent
-- of message activity, for real complexity cost. If this residual risk ever
-- needs to be closed further, the fix has to come from an actually
-- authenticated signal (a provider-verified SPF/DKIM/DMARC result, if
-- Resend ever exposes one) or from dropping guessable addresses back to
-- inbound_alias-style unguessable ones — not from more logic layered on top
-- of From-header matching.
-- ============================================================================
--
-- What this adds:
--   * public.reserved_dream_handles     — system names no user may be assigned
--   * profiles.dream_handle             — the readable handle; immutable by
--                                         users (same column-privilege
--                                         lockdown pattern as inbound_alias),
--                                         assigned once at signup, never
--                                         recomputed on email change
--   * public._generate_dream_handle / public._pick_dream_handle_candidate /
--     public._assign_dream_handle — normalization + collision-safe
--     assignment, shared by signup (via a new BEFORE INSERT trigger on
--     profiles, since dream_handle is NOT NULL and must be populated by
--     the time the row is actually inserted) and the one-off backfill below
--   * public.dream_handle_admin_reassign  — service-role-only support/recovery
--     path, no Server Action or UI exposes it
--   * public.pending_dream_captures / public.dream_confirmed_senders /
--     public.dream_capture_submit / public.dream_capture_confirm — the
--     confirmation handshake described above, with:
--       - per-user (profiles columns) and per-(user, sender)
--         (dream_sender_handshake_throttle, a durable fixed-window counter
--         independent of pending_dream_captures' own lifecycle — those
--         rows are deleted on confirm/expiry, so counting them would not
--         be a real 24h window) rate limiting on new handshakes, both
--         advisory-lock serialized, so a stranger can't mail-bomb a user's
--         real inbox with confirmation emails
--       - reliable expiry cleanup, done as an unconditional first statement
--         in both RPCs rather than delete-then-raise (a delete immediately
--         followed by a raised exception in the same transaction is rolled
--         back along with it — every status this pair of functions can
--         produce is a return value, never a raised exception, so a
--         cleanup delete can never be undone by a later error path)
--       - confirmation emails sent only to primary_email_verified_email,
--         never the live auth.users.email
--       - sender_email_remove() and the primary-email-change trigger both
--         revoke any matching dream_confirmed_senders row immediately
--       - dream_capture_confirm() re-checks the sender is STILL approved
--         (via the new _is_dream_sender_approved()) before honoring a click
--       - pending_dream_captures snapshots workspace_id at submission time;
--         dream_capture_confirm() validates that membership still holds
--         before inserting the capture, rather than trusting the snapshot
--       - dream_capture_submit() re-checks _is_dream_sender_approved() for
--         itself before ever consulting dream_confirmed_senders, so being
--         on that allow-list is always an ADDITIONAL requirement stacked on
--         top of current sender approval, never a substitute for it
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- ============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Reserved handles — system names no generated/assigned handle may ever be.
-- Plain table so the list can grow later without a code change.
-- -----------------------------------------------------------------------------

create table if not exists public.reserved_dream_handles (
  handle text primary key
);

insert into public.reserved_dream_handles (handle) values
  ('dream'), ('admin'), ('support'), ('security'), ('postmaster'),
  ('webmaster'), ('abuse'), ('noreply'), ('no-reply'), ('mail'),
  ('mailer-daemon'), ('help'), ('info'), ('contact'), ('billing'),
  ('sales'), ('root'), ('hostmaster'), ('dreamcatcher'), ('api'), ('www')
on conflict (handle) do nothing;

alter table public.reserved_dream_handles enable row level security;
-- No policies: not exposed to authenticated/anon at all, same as
-- pending_dream_captures/dream_handle_admin_changes/
-- dream_sender_handshake_throttle below. Read only by SECURITY DEFINER
-- functions (_pick_dream_handle_candidate, dream_handle_admin_reassign),
-- which run as the function owner and so are unaffected by RLS regardless
-- — there is no legitimate reason for a direct PostgREST call to read or
-- write this table at all.

-- -----------------------------------------------------------------------------
-- profiles.dream_handle — nullable until backfilled below, then NOT NULL.
-- The unique index is created now (before any value is ever assigned) so
-- that both the backfill and all future assignment calls below are
-- protected by it from the start — multiple NULLs are allowed in a unique
-- index, so this is safe to create before the column is populated.
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists dream_handle text,
  -- Per-user throttle on *new* dream-handle handshakes (pending_dream_captures
  -- creation + the confirmation email that goes with it) — see
  -- dream_capture_submit(). Same pattern as sender_email_add_last_at/
  -- sender_email_add_count_1h above.
  add column if not exists dream_capture_pending_last_at timestamptz,
  add column if not exists dream_capture_pending_count_1h integer not null default 0;

create unique index if not exists profiles_dream_handle_unique_idx
  on public.profiles (dream_handle);

-- -----------------------------------------------------------------------------
-- Normalization + collision-safe assignment.
-- -----------------------------------------------------------------------------

create or replace function public._generate_dream_handle(p_local_part text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_base text;
begin
  -- First segment before the first '.', lowercased, then anything outside
  -- [a-z0-9_-] stripped, then leading/trailing separators trimmed. Falls
  -- back to a fixed, non-reserved default rather than ever returning ''.
  v_base := lower(split_part(coalesce(p_local_part, ''), '.', 1));
  v_base := regexp_replace(v_base, '[^a-z0-9_-]+', '', 'g');
  v_base := regexp_replace(v_base, '^[-_]+|[-_]+$', '', 'g');
  if v_base = '' then
    v_base := 'user';
  end if;
  return v_base;
end;
$$;

revoke all on function public._generate_dream_handle(text) from public, anon, authenticated;

-- Picks a free, non-reserved candidate handle for p_email, holding an
-- advisory lock on the candidate base name for the rest of the current
-- transaction. Read-only with respect to profiles (no write) — callers
-- decide how/whether to persist it. The lock is what makes this safe
-- against races despite being check-then-act: a concurrent caller wanting
-- the SAME base name blocks on the same lock key until this transaction
-- commits or aborts, so by the time it runs its own existence check, any
-- name this transaction actually committed is already visible to it (and
-- if this transaction aborted instead, nothing was committed, so the name
-- is correctly still free). profiles_dream_handle_unique_idx remains the
-- actual backstop if that discipline is ever violated by future code.
create or replace function public._pick_dream_handle_candidate(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local text;
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
  v_attempt integer := 0;
begin
  v_local := split_part(lower(btrim(coalesce(p_email, ''))), '@', 1);
  v_base := public._generate_dream_handle(v_local);

  perform pg_advisory_xact_lock(hashtextextended(v_base, 0));

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 1000 then
      raise exception 'Could not assign a Dream Catcher address.' using errcode = 'P0001';
    end if;

    v_candidate := case when v_suffix = 1 then v_base else v_base || v_suffix::text end;
    v_suffix := v_suffix + 1;

    if exists (select 1 from public.reserved_dream_handles where handle = v_candidate) then
      continue;
    end if;
    if exists (select 1 from public.profiles where dream_handle = v_candidate) then
      continue;
    end if;

    return v_candidate;
  end loop;
end;
$$;

revoke all on function public._pick_dream_handle_candidate(text) from public, anon, authenticated;

-- Backfill-only entry point: ensures an EXISTING profile row has a
-- dream_handle, assigning one if missing, via UPDATE ... WHERE dream_handle
-- IS NULL — calling it again for an already-assigned user is a safe no-op
-- that returns the existing handle, never a reassignment. (Signups go
-- through the BEFORE INSERT trigger below instead, since dream_handle is
-- NOT NULL and must already be set by the time the INSERT itself runs —
-- a separate UPDATE after the fact, as an earlier version of this
-- migration did, is too late: the NOT NULL violation fires on the INSERT
-- before that UPDATE statement ever executes.) unique_violation is still
-- caught and retried here as a backstop, exactly like
-- inbound_alias_regenerate() already does for inbound_alias.
create or replace function public._assign_dream_handle(p_user_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate text;
  v_updated integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  loop
    v_candidate := public._pick_dream_handle_candidate(p_email);
    begin
      update public.profiles
         set dream_handle = v_candidate
       where id = p_user_id
         and dream_handle is null;
      get diagnostics v_updated = row_count;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  if v_updated = 1 then
    return v_candidate;
  end if;

  -- dream_handle was already set (e.g. this function was called again for
  -- the same user) — never overwrite an existing assignment.
  return (select dream_handle from public.profiles where id = p_user_id);
end;
$$;

revoke all on function public._assign_dream_handle(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Signup path: dream_handle is NOT NULL, so it must be populated by the
-- time the INSERT into profiles actually runs, not after. A BEFORE INSERT
-- trigger on profiles (rather than touching handle_new_user() itself)
-- keeps that insert statement untouched, so the existing on-conflict/
-- workspace-creation logic can't regress.
-- -----------------------------------------------------------------------------

create or replace function public._profiles_assign_dream_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if new.dream_handle is not null then
    return new; -- already provided; never overwrite
  end if;
  select email into v_email from auth.users where id = new.id;
  new.dream_handle := public._pick_dream_handle_candidate(v_email);
  return new;
end;
$$;

revoke all on function public._profiles_assign_dream_handle() from public, anon, authenticated;

drop trigger if exists profiles_assign_dream_handle on public.profiles;
create trigger profiles_assign_dream_handle
before insert on public.profiles
for each row execute function public._profiles_assign_dream_handle();

-- Deliberately does NOT redefine handle_new_user() itself. An earlier
-- version of this migration did (with a one-line addition, later replaced
-- by the trigger above) — that meant `create or replace function
-- public.handle_new_user()` had to reproduce its body exactly, which is
-- only safe if that body is known to match what's actually live. This
-- repo's migration history is not fully trustworthy for that: the
-- capture_source enum, for example, has a value ('email') that's live on
-- the real dev database per 20261026120000_email_to_dreamcatcher.sql's own
-- header comment but was never added by any committed migration — i.e. an
-- undocumented dashboard edit already happened once. The BEFORE INSERT
-- trigger above hooks in at the table level and needs nothing from
-- handle_new_user()'s body beyond "it inserts a row into profiles for the
-- new auth.users row," which is unconditionally true today — so this
-- migration simply has no reason to touch that function at all, and can't
-- silently clobber whatever its live definition actually is.

-- -----------------------------------------------------------------------------
-- Backfill existing users. Reuses _assign_dream_handle exactly as signup
-- does, so there is no separate collision/reservation logic to get wrong.
-- Safe to re-run if interrupted (only touches rows still dream_handle is
-- null) and safe to run concurrently with a live signup landing mid-backfill
-- (both contend for the same advisory lock / unique index per base name,
-- not separate ones).
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.id, u.email
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.dream_handle is null
     order by p.created_at
  loop
    perform public._assign_dream_handle(r.id, r.email);
  end loop;
end
$$;

alter table public.profiles
  alter column dream_handle set not null;

-- -----------------------------------------------------------------------------
-- Column-level privilege lockdown — dream_handle is deliberately NOT added
-- to the existing `grant update (full_name, timezone) on public.profiles to
-- authenticated` allowlist from 20261026120000_email_to_dreamcatcher.sql.
-- That grant (plus the revoke it pairs with) is what already makes
-- inbound_alias immutable by users despite the row-level profiles_update_own
-- policy; leaving dream_handle off the column list means it inherits the
-- exact same protection with no new statement required here.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Admin recovery — not user-facing. Granted only to service_role; no Server
-- Action or UI wraps it. Exists purely for a support playbook invoked
-- directly with the service-role key (e.g. Supabase SQL editor).
-- -----------------------------------------------------------------------------

create table if not exists public.dream_handle_admin_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  old_handle text,
  new_handle text not null,
  changed_at timestamptz not null default now()
);

alter table public.dream_handle_admin_changes enable row level security;
-- No policies: not exposed to authenticated/anon at all. Written only by
-- dream_handle_admin_reassign (security definer), read only via service role.

create or replace function public.dream_handle_admin_reassign(p_user_id uuid, p_new_handle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text := lower(btrim(coalesce(p_new_handle, '')));
begin
  if p_user_id is null or v_new = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_new !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;
  if exists (select 1 from public.reserved_dream_handles where handle = v_new) then
    raise exception 'reserved_handle' using errcode = 'P0001';
  end if;

  select dream_handle into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  begin
    update public.profiles set dream_handle = v_new where id = p_user_id;
  exception when unique_violation then
    raise exception 'handle_in_use' using errcode = '23505';
  end;

  insert into public.dream_handle_admin_changes (user_id, old_handle, new_handle)
  values (p_user_id, v_old, v_new);
end;
$$;

revoke all on function public.dream_handle_admin_reassign(uuid, text) from public, anon, authenticated;
grant execute on function public.dream_handle_admin_reassign(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- First-use sender confirmation handshake (see header comment for why this
-- exists — Resend exposes no authenticated sender verdict, so a guessable
-- address can't rely on sender-match alone the way inbound_alias safely
-- does).
-- -----------------------------------------------------------------------------

create table if not exists public.pending_dream_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Snapshotted at submission time (dream_capture_submit) rather than
  -- re-resolved at confirm time, so the eventual capture goes to the exact
  -- workspace that was true when the email arrived. dream_capture_confirm()
  -- validates this is still a workspace the user belongs to before trusting
  -- it, rather than using it blindly.
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sender_email_normalized text not null,
  source_external_id text,
  content text not null,
  confirmation_token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_dream_captures_user_id_idx
  on public.pending_dream_captures (user_id);

create unique index if not exists pending_dream_captures_token_hash_idx
  on public.pending_dream_captures (confirmation_token_hash);

-- Supports the unconditional "delete from pending_dream_captures where
-- expires_at < now()" cleanup that runs first in both dream_capture_submit
-- and dream_capture_confirm.
create index if not exists pending_dream_captures_expires_at_idx
  on public.pending_dream_captures (expires_at);

-- Dedupes a webhook retry for the same source email while it's still
-- pending confirmation — without this, a retried delivery would otherwise
-- create a second pending row and send the user a second confirmation email
-- for the same message.
create unique index if not exists pending_dream_captures_user_source_unique_idx
  on public.pending_dream_captures (user_id, source_external_id)
  where source_external_id is not null;

alter table public.pending_dream_captures enable row level security;
-- No policies: service-role/RPC only, same as user_sender_emails.

create table if not exists public.dream_confirmed_senders (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_email_normalized text not null,
  confirmed_at timestamptz not null default now(),
  primary key (user_id, sender_email_normalized)
);

alter table public.dream_confirmed_senders enable row level security;

drop policy if exists dream_confirmed_senders_select_own on public.dream_confirmed_senders;
create policy dream_confirmed_senders_select_own
on public.dream_confirmed_senders for select
to authenticated
using (user_id = (select auth.uid()));

-- Durable per-(user, sender) handshake counter — deliberately NOT derived
-- from counting pending_dream_captures rows. Those rows are deleted on
-- confirm and on expiry cleanup, so a count-based check against that table
-- is not a real 24h window: confirm a few, or just wait past the 24h
-- expiry, and the "count" resets to zero regardless of how many attempts
-- actually happened. This table is the fixed-window counter instead (same
-- idiom as profiles.sender_email_add_last_at/count_1h above), independent
-- of pending_dream_captures' lifecycle — it is never deleted by confirming
-- or by that table's expiry cleanup, only by its own cleanup below.
create table if not exists public.dream_sender_handshake_throttle (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_email_normalized text not null,
  count_24h integer not null default 0,
  window_start timestamptz not null default now(),
  primary key (user_id, sender_email_normalized)
);

alter table public.dream_sender_handshake_throttle enable row level security;
-- No policies: service-role/RPC only, same as pending_dream_captures.

-- Shared by dream_capture_submit and dream_capture_confirm: true only if
-- p_sender_email_normalized is CURRENTLY an approved address for this user
-- (primary-verified-match, or a presently-verified user_sender_emails row —
-- the same two conditions isApprovedSender() checks in the webhook).
-- Factored out so both RPCs re-check it independently rather than trusting
-- a point-in-time decision made elsewhere — being in dream_confirmed_senders
-- is always an ADDITIONAL requirement stacked on top of this, never a
-- substitute for it.
create or replace function public._is_dream_sender_approved(
  p_user_id uuid,
  p_sender_email_normalized text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.profiles p
     where p.id = p_user_id
       and p.primary_email_verified_at is not null
       and p.primary_email_verified_email = p_sender_email_normalized
  ) or exists (
    select 1 from public.user_sender_emails
     where user_id = p_user_id
       and email_normalized = p_sender_email_normalized
       and status = 'verified'
  );
end;
$$;

revoke all on function public._is_dream_sender_approved(uuid, text) from public, anon, authenticated;

-- dream_capture_submit is the webhook's write path for the dream_handle
-- route only (inbound_alias and the legacy address keep inserting into
-- captures directly). SECURITY: like sender_email_add, this is called from
-- server-side webhook code with the service-role admin client — it accepts
-- an arbitrary p_user_id/p_sender_email because the webhook, not a signed-in
-- user, is the caller, so it must never be granted to authenticated/anon.
create or replace function public.dream_capture_submit(
  p_user_id uuid,
  p_sender_email text,
  p_source_external_id text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text := lower(btrim(coalesce(p_sender_email, '')));
  v_workspace_id uuid;
  v_token text;
  v_profile public.profiles;
  v_throttle public.dream_sender_handshake_throttle;
begin
  if p_user_id is null or v_sender = '' or coalesce(p_content, '') = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Unconditional, standalone cleanup, deliberately the FIRST statement and
  -- not followed by any `raise` in this function — see dream_capture_confirm
  -- below for why a delete immediately followed by a raised exception in
  -- the same transaction is rolled back along with it. Every branch in both
  -- of these RPCs returns a status instead of raising for exactly this
  -- reason.
  delete from public.pending_dream_captures where expires_at < now();
  -- Bounds dream_sender_handshake_throttle's growth — a row this stale is
  -- well outside any 24h decision window (kept for a week, not 24h, purely
  -- as slack against this delete not running for a while on a quiet row;
  -- it plays no role in the rate-limit decision itself).
  delete from public.dream_sender_handshake_throttle where window_start < now() - interval '7 days';

  select wm.workspace_id into v_workspace_id
    from public.workspace_members wm
   where wm.user_id = p_user_id
   order by wm.joined_at asc
   limit 1;
  if v_workspace_id is null then
    -- Matches insertCapture()'s existing "no workspace found" behavior on
    -- the inbound_alias path: logged and dropped by the webhook, never a
    -- 500 — the webhook distinguishes this from a real error by status,
    -- not by exception.
    return jsonb_build_object('status', 'no_workspace');
  end if;

  -- Defense in depth: this function is granted only to service_role and is
  -- only ever called by the webhook after isApprovedSender() already
  -- passed for this exact message, but that must hold on this function's
  -- own terms too, not merely by convention of its current caller.
  if not public._is_dream_sender_approved(p_user_id, v_sender) then
    return jsonb_build_object('status', 'not_approved');
  end if;

  if exists (
    select 1 from public.dream_confirmed_senders
     where user_id = p_user_id and sender_email_normalized = v_sender
  ) then
    begin
      insert into public.captures (workspace_id, created_by, content, source, source_external_id, status)
      values (v_workspace_id, p_user_id, p_content, 'email', p_source_external_id, 'inbox');
    exception when unique_violation then
      null; -- already captured by a prior delivery of this webhook event
    end;

    return jsonb_build_object('status', 'captured');
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;

  if v_profile.primary_email_verified_at is null or v_profile.primary_email_verified_email is null then
    -- No proven-owned destination to send a confirmation to — never send
    -- one to the live, possibly-unverified auth.users.email. Drop rather
    -- than create a pending row that could never legitimately be
    -- confirmed by anyone.
    return jsonb_build_object('status', 'no_verified_destination');
  end if;

  -- Per-user and per-(user, sender) rate limiting on *new* handshakes only
  -- — an already-confirmed sender's messages capture directly above and
  -- are never throttled. What's bounded here is how many confirmation
  -- emails a stranger (or a guessed/spoofed address) can push into the
  -- user's real inbox. The advisory locks make both checks
  -- concurrency-safe: two webhook deliveries racing for the same user (or
  -- the same user+sender) are serialized rather than both reading a stale
  -- count and both passing it.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  if v_profile.dream_capture_pending_last_at is not null
     and v_profile.dream_capture_pending_last_at > now() - interval '1 hour'
     and v_profile.dream_capture_pending_count_1h >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_sender, 2));

  -- Durable fixed-window counter — see dream_sender_handshake_throttle's
  -- comment for why this can't be a count(*) over pending_dream_captures
  -- (those rows don't survive confirmation or expiry, so that count isn't
  -- a real 24h window at all).
  select * into v_throttle
    from public.dream_sender_handshake_throttle
   where user_id = p_user_id and sender_email_normalized = v_sender
   for update;

  if found
     and v_throttle.window_start > now() - interval '24 hours'
     and v_throttle.count_24h >= 3 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.pending_dream_captures (
      user_id, workspace_id, sender_email_normalized, source_external_id, content,
      confirmation_token_hash, expires_at
    ) values (
      p_user_id, v_workspace_id, v_sender, p_source_external_id, p_content,
      public._hash_verification_token(v_token), now() + interval '24 hours'
    );
  exception when unique_violation then
    -- Already pending from a prior delivery of this same webhook event —
    -- don't create a second pending row or send a second confirm email,
    -- and deliberately don't count this toward the rate limit below either:
    -- a retried delivery of a message already accounted for is not a new
    -- attempt, and counting it would let a flaky/retrying sender exhaust a
    -- user's budget without ever sending more than one real message.
    return jsonb_build_object('status', 'duplicate_pending');
  end;

  -- Only reached once a genuinely NEW pending row was just created —
  -- counting here, after the insert succeeds, is what keeps a deduped
  -- retry (returned above) from consuming rate-limit budget it shouldn't.
  update public.profiles
     set dream_capture_pending_count_1h =
           case
             when dream_capture_pending_last_at is null
                  or dream_capture_pending_last_at < now() - interval '1 hour'
             then 1
             else dream_capture_pending_count_1h + 1
           end,
         dream_capture_pending_last_at = now()
   where id = p_user_id;

  insert into public.dream_sender_handshake_throttle (user_id, sender_email_normalized, count_24h, window_start)
  values (p_user_id, v_sender, 1, now())
  on conflict (user_id, sender_email_normalized) do update
     set count_24h =
           case
             when public.dream_sender_handshake_throttle.window_start < now() - interval '24 hours'
             then 1
             else public.dream_sender_handshake_throttle.count_24h + 1
           end,
         window_start =
           case
             when public.dream_sender_handshake_throttle.window_start < now() - interval '24 hours'
             then now()
             else public.dream_sender_handshake_throttle.window_start
           end;

  return jsonb_build_object(
    'status', 'pending',
    'token', v_token,
    'confirm_to', v_profile.primary_email_verified_email
  );
end;
$$;

revoke all on function public.dream_capture_submit(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.dream_capture_submit(uuid, text, text, text) to service_role;

create or replace function public.dream_capture_confirm(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
  v_row public.pending_dream_captures;
  v_has_access boolean;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_token_hash := public._hash_verification_token(p_token);

  -- Unconditional, standalone cleanup, deliberately the FIRST statement and
  -- not followed by any `raise`. An earlier version of this function did
  -- `delete ...; raise exception 'expired_token' ...;` for the target row
  -- — but raising later in the same transaction rolls back EVERYTHING
  -- since the transaction began, including that delete, so the row was
  -- never actually removed despite the apparent error. Every branch below
  -- returns a status instead of raising for the same reason, so no delete
  -- in this function can ever be undone by a later error path.
  delete from public.pending_dream_captures where expires_at < now();

  select * into v_row
    from public.pending_dream_captures
   where confirmation_token_hash = v_token_hash
   for update;

  if not found then
    -- Covers "token never existed" and "was just expired and removed by
    -- the cleanup above" alike — both mean "this link no longer works."
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Re-check the sender is STILL approved. It may have been removed
  -- (sender_email_remove) or the primary email may have changed between
  -- submission and the user clicking confirm — honoring a stale handshake
  -- here would re-grant trust to an address that isn't approved at all
  -- anymore.
  if not public._is_dream_sender_approved(v_row.user_id, v_row.sender_email_normalized) then
    delete from public.pending_dream_captures where id = v_row.id;
    return jsonb_build_object('status', 'not_approved');
  end if;

  -- Validate the snapshotted workspace is still one this user actually
  -- belongs to, rather than trusting it blindly — membership could have
  -- changed between submission and confirmation.
  select exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_row.workspace_id
       and wm.user_id = v_row.user_id
  ) into v_has_access;

  if not v_has_access then
    delete from public.pending_dream_captures where id = v_row.id;
    return jsonb_build_object('status', 'no_access');
  end if;

  begin
    insert into public.captures (workspace_id, created_by, content, source, source_external_id, status)
    values (v_row.workspace_id, v_row.user_id, v_row.content, 'email', v_row.source_external_id, 'inbox');
  exception when unique_violation then
    null; -- already captured by a prior confirm or webhook delivery
  end;

  insert into public.dream_confirmed_senders (user_id, sender_email_normalized)
  values (v_row.user_id, v_row.sender_email_normalized)
  on conflict (user_id, sender_email_normalized) do nothing;

  delete from public.pending_dream_captures where id = v_row.id;

  return jsonb_build_object('status', 'confirmed');
end;
$$;

revoke all on function public.dream_capture_confirm(text) from public, anon, authenticated;
-- Callable without a session: the link is clicked from a mail client. The
-- unguessable token IS the authorization, same as primary_email_verify /
-- sender_email_verify.
grant execute on function public.dream_capture_confirm(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Revocation: a dream_confirmed_senders row is a standing grant of trust
-- justified by a sender being approved at confirmation time. It must not
-- outlive that approval. Both existing functions below are redefined
-- (identical signatures) purely to add that side effect — neither one's
-- original behavior, verification flow, or error handling changes.
-- -----------------------------------------------------------------------------

create or replace function public.sender_email_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer;
  v_email_normalized text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.user_sender_emails
   where id = p_id and user_id = v_uid
  returning email_normalized into v_email_normalized;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Added by 20261101000000_dream_catcher_handles.sql: revoke any standing
  -- dream_handle-route trust granted on the strength of this now-removed
  -- sender — see this migration's header for why that trust must not
  -- survive removal.
  delete from public.dream_confirmed_senders
   where user_id = v_uid and sender_email_normalized = v_email_normalized;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sender_email_remove(uuid) from public, anon, authenticated;
grant execute on function public.sender_email_remove(uuid) to authenticated;

create or replace function public._clear_stale_primary_email_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_verified_email text;
begin
  if old.email is distinct from new.email then
    select primary_email_verified_email into v_old_verified_email
      from public.profiles where id = new.id;

    update public.profiles
       set primary_email_verified_email = null,
           primary_email_verified_at = null,
           primary_email_verification_token_hash = null,
           primary_email_verification_expires_at = null
     where id = new.id;

    -- Added by 20261101000000_dream_catcher_handles.sql: the dream_handle
    -- route's standing trust in this sender was granted on the strength of
    -- the verification just cleared above — it must not outlive it.
    if v_old_verified_email is not null then
      delete from public.dream_confirmed_senders
       where user_id = new.id and sender_email_normalized = v_old_verified_email;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._clear_stale_primary_email_verification() from public, anon, authenticated;

commit;
