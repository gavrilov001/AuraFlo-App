-- ============================================================================
-- AuraFlo — Dream Catcher capture lifecycle
--
-- ADDITIVE migration. Does NOT modify or drop any table and does NOT touch the
-- capture_status enum. Apply once: Supabase Dashboard -> SQL Editor -> paste.
--
--   1. captures.archived_at / captures.discarded_at (nullable timestamps)
--   2. sync_capture_processed_at trigger fn re-created to also manage the two
--      new timestamps + clear session tracking when a capture returns to inbox
--   3. partial indexes for the Processed / Archived / Discarded tab ordering
--   4. reset_current_daily_plan: only restore captures still in
--      'processed' / 'discarded' (an archived source stays archived through a
--      Reset Today)
--   5. capture_restore(uuid): secure, race-safe restore for Archived / Discarded
--      — archived-with-task -> 'processed', otherwise -> 'inbox';
--      discarded-with-task is refused.
--
-- No capture is ever deleted here. No cron. No cascade changes.
-- tasks.source_capture_id already uses ON DELETE SET NULL (verified in
-- supabase_initial_schema.sql line 134) so deleting a capture never removes its
-- task.
-- ============================================================================

begin;

-- 1. columns --------------------------------------------------------------
alter table public.captures
  add column if not exists archived_at timestamptz,
  add column if not exists discarded_at timestamptz;

-- 2. status-sync trigger function --------------------------------------
create or replace function public.sync_capture_processed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- processed_at: stamped the first time a capture leaves the inbox,
  -- cleared when it returns. Preserved across processed <-> archived/discarded.
  if new.status <> 'inbox'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.processed_at = coalesce(new.processed_at, now());
  elsif new.status = 'inbox' then
    new.processed_at = null;
    new.processed_in_daily_plan_id = null;
  end if;

  -- archived_at / discarded_at: stamped on entry, cleared on any other status.
  if new.status = 'archived' then
    new.archived_at = coalesce(new.archived_at, now());
  else
    new.archived_at = null;
  end if;

  if new.status = 'discarded' then
    new.discarded_at = coalesce(new.discarded_at, now());
  else
    new.discarded_at = null;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_capture_processed_at()
  from public, anon, authenticated;

-- 3. indexes ------------------------------------------------------------
-- Processed / Archived / Discarded tabs order newest-first by their own stamp.
create index if not exists captures_workspace_status_processed_idx
  on public.captures(workspace_id, status, processed_at desc)
  where processed_at is not null;

create index if not exists captures_workspace_archived_at_idx
  on public.captures(workspace_id, archived_at desc)
  where archived_at is not null;

create index if not exists captures_workspace_discarded_at_idx
  on public.captures(workspace_id, discarded_at desc)
  where discarded_at is not null;

-- 4. Reset Today: don't drag an archived source back to the inbox ------
create or replace function public.reset_current_daily_plan(
  p_reopen_completed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_today date;
  v_plan public.daily_plans;
  v_items integer := 0;
  v_tasks integer := 0;
  v_caps integer := 0;
  v_reopened integer := 0;
  v_tracked_tasks integer := 0;
  v_tracked_caps integer := 0;
  v_legacy boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select coalesce(nullif(btrim(p.timezone), ''), 'UTC')
    into v_tz from public.profiles p where p.id = v_uid;
  if v_tz is null then v_tz := 'UTC'; end if;
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_today := (now() at time zone 'UTC')::date;
  end;

  select * into v_plan
    from public.daily_plans
   where user_id = v_uid and plan_date = v_today
   order by created_at desc limit 1 for update;

  if not found then
    return jsonb_build_object(
      'status', 'no_plan', 'deleted_plan_items', 0, 'deleted_session_tasks', 0,
      'restored_captures', 0, 'reopened_tasks', 0, 'legacy_untracked', false
    );
  end if;

  if v_plan.user_id <> v_uid then
    raise exception 'You do not own this daily plan' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_plan.workspace_id and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  select count(*) into v_tracked_tasks
    from public.tasks
   where origin_daily_plan_id = v_plan.id and workspace_id = v_plan.workspace_id;
  select count(*) into v_tracked_caps
    from public.captures
   where processed_in_daily_plan_id = v_plan.id
     and workspace_id = v_plan.workspace_id;
  select count(*) into v_items
    from public.daily_plan_items where daily_plan_id = v_plan.id;

  v_legacy := (v_items > 0 and v_tracked_tasks = 0 and v_tracked_caps = 0);

  if coalesce(p_reopen_completed, true) then
    with reopened as (
      update public.tasks t
         set status = case
               when t.bucket = 'delegated' then 'waiting'::public.task_status
               else 'open'::public.task_status end
       where t.id in (
               select dpi.task_id from public.daily_plan_items dpi
                where dpi.daily_plan_id = v_plan.id)
         and t.workspace_id = v_plan.workspace_id
         and t.status = 'completed'
         and (t.origin_daily_plan_id is distinct from v_plan.id)
      returning 1
    )
    select count(*) into v_reopened from reopened;
  end if;

  with di as (
    delete from public.daily_plan_items where daily_plan_id = v_plan.id returning 1
  )
  select count(*) into v_items from di;

  with dt as (
    delete from public.tasks
     where origin_daily_plan_id = v_plan.id and workspace_id = v_plan.workspace_id
    returning 1
  )
  select count(*) into v_tasks from dt;

  -- Only captures still in 'processed' / 'discarded' come back — an archived
  -- source that belonged to this session stays archived.
  with rc as (
    update public.captures
       set status = 'inbox', processed_at = null, processed_in_daily_plan_id = null
     where processed_in_daily_plan_id = v_plan.id
       and workspace_id = v_plan.workspace_id
       and status in ('processed', 'discarded')
    returning 1
  )
  select count(*) into v_caps from rc;

  delete from public.daily_plans where id = v_plan.id;

  return jsonb_build_object(
    'status', 'reset',
    'deleted_plan_items', v_items,
    'deleted_session_tasks', v_tasks,
    'restored_captures', v_caps,
    'reopened_tasks', v_reopened,
    'legacy_untracked', v_legacy
  );
end;
$$;

-- 5. capture_restore --------------------------------------------------
create or replace function public.capture_restore(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cap public.captures;
  v_task_id uuid;
  v_new public.capture_status;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_cap from public.captures where id = p_capture_id for update;
  if not found then
    raise exception 'Capture not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_cap.workspace_id and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if v_cap.status not in ('archived', 'discarded') then
    raise exception 'Only archived or discarded thoughts can be restored'
      using errcode = 'P0001';
  end if;

  select id into v_task_id
    from public.tasks
   where source_capture_id = p_capture_id
     and workspace_id = v_cap.workspace_id;

  if v_cap.status = 'discarded' and v_task_id is not null then
    -- A discarded capture must never have created a task. Refuse rather than
    -- risk a duplicate.
    raise exception 'discarded_has_task' using errcode = 'P0001';
  end if;

  v_new := case when v_task_id is not null then 'processed'::public.capture_status
                else 'inbox'::public.capture_status end;

  update public.captures set status = v_new where id = p_capture_id;

  return jsonb_build_object('status', v_new, 'has_task', v_task_id is not null);
end;
$$;

revoke all on function public.capture_restore(uuid) from public, anon, authenticated;
grant execute on function public.capture_restore(uuid) to authenticated;

commit;
