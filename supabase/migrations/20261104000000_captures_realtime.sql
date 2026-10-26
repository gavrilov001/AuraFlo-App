-- ============================================================================
-- AuraFlo — Dream Catcher: enable Realtime on captures (live Inbox updates)
--
-- Adds public.captures to the supabase_realtime publication so the Dream
-- Catcher Inbox (src/app/app/capture/CaptureBoard.tsx) can subscribe to
-- postgres_changes INSERT events and pick up new email captures without a
-- manual page refresh.
--
-- WORKSPACE ISOLATION — no new RLS policy is added here, deliberately:
-- postgres_changes subscriptions are authorized using the EXISTING
-- captures_select_member policy from supabase_initial_schema.sql:
--     on public.captures for select
--     to authenticated
--     using (public.is_workspace_member(workspace_id));
-- Supabase Realtime evaluates this policy using the subscribing client's own
-- JWT (the browser client from src/lib/supabase/client.ts carries the signed-
-- in user's session via @supabase/ssr), so a client only ever receives
-- change events for rows in a workspace it belongs to — the same guarantee
-- the existing non-realtime list query already relies on. Adding a separate
-- realtime-only policy would duplicate this logic and risk drifting out of
-- sync with it; reusing the one SELECT policy keeps a single source of truth
-- for who can see a capture.
--
-- Replica identity is left at its default (primary key). INSERT events always
-- carry the full new row regardless of replica identity — that default is
-- sufficient here because the Inbox subscription only reacts to INSERT and
-- uses the event purely as a signal to refetch (via the server component,
-- which already applies the category/task joins); it never reads joined
-- columns off the realtime payload itself.
--
-- Safe to re-run: guarded so applying this twice does not error.
--
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'captures'
  ) then
    alter publication supabase_realtime add table public.captures;
  end if;
end $$;
