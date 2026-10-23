-- ============================================================================
-- AuraFlo — Reset Today: session tracking + transactional reset
--
-- ADDITIVE migration. Does NOT modify or drop any table from
-- supabase_initial_schema.sql. Apply once:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- 1. Adds session-tracking columns so a Start My Day session's tasks and
--    captures can be identified exactly (never by timestamp guessing):
--      captures.processed_in_daily_plan_id -> daily_plans(id) on delete set null
--      tasks.origin_daily_plan_id          -> daily_plans(id) on delete set null
-- 2. Re-creates the Start My Day RPCs so they populate those columns.
-- 3. Adds public.reset_current_daily_plan(boolean): one locked transaction that
--    tears down today's plan, deletes only the tasks that session created, and
--    returns the session's captures to the Dream Catcher inbox.
--
-- The application also has sequential fallbacks, so these features work before
-- this migration is applied — but the RPC is the preferred atomic path.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Session-tracking columns + indexes
-- ----------------------------------------------------------------------------
alter table public.captures
  add column if not exists processed_in_daily_plan_id uuid
    references public.daily_plans(id) on delete set null;

alter table public.tasks
  add column if not exists origin_daily_plan_id uuid
    references public.daily_plans(id) on delete set null;

create index if not exists captures_processed_in_daily_plan_id_idx
  on public.captures(processed_in_daily_plan_id)
  where processed_in_daily_plan_id is not null;

create index if not exists tasks_origin_daily_plan_id_idx
  on public.tasks(origin_daily_plan_id)
  where origin_daily_plan_id is not null;

-- ----------------------------------------------------------------------------
-- 2a. start_my_day_process_capture (now stamps session tracking)
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_process_capture(
  p_capture_id uuid,
  p_daily_plan_id uuid,
  p_decision text,
  p_scheduled_for date default null,
  p_due_at timestamptz default null,
  p_notes text default null,
  p_focus_item_id uuid default null,
  p_delegate_name text default null,
  p_delegate_email text default null,
  p_add_to_today boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_cap public.captures;
  v_bucket public.task_bucket;
  v_status public.task_status;
  v_task_scheduled_for date;
  v_include_in_plan boolean := false;
  v_task_id uuid;
  v_item_id uuid;
  v_next_sort integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('do_now', 'schedule', 'delegate', 'later') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;

  select * into v_plan
    from public.daily_plans
   where id = p_daily_plan_id
   for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
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

  select * into v_cap
    from public.captures
   where id = p_capture_id
   for update;
  if not found then
    raise exception 'Capture not found' using errcode = 'P0002';
  end if;
  if v_cap.workspace_id <> v_plan.workspace_id then
    raise exception 'Capture and plan belong to different workspaces'
      using errcode = '42501';
  end if;
  if v_cap.status <> 'inbox' then
    raise exception 'This thought has already been handled' using errcode = 'P0001';
  end if;

  if p_focus_item_id is not null then
    if not exists (
      select 1 from public.focus_items fi
       where fi.id = p_focus_item_id and fi.workspace_id = v_plan.workspace_id
    ) then
      raise exception 'That focus item no longer exists' using errcode = 'P0002';
    end if;
  end if;

  if p_decision = 'do_now' then
    v_bucket := 'today';
    v_status := 'open';
    v_task_scheduled_for := v_plan.plan_date;
    v_include_in_plan := true;
  elsif p_decision = 'schedule' then
    if p_scheduled_for is null then
      raise exception 'A scheduled date is required' using errcode = '22023';
    end if;
    v_bucket := 'scheduled';
    v_status := 'open';
    v_task_scheduled_for := p_scheduled_for;
    v_include_in_plan :=
      (p_scheduled_for = v_plan.plan_date and coalesce(p_add_to_today, false));
  elsif p_decision = 'delegate' then
    if nullif(btrim(coalesce(p_delegate_name, '')), '') is null then
      raise exception 'A delegate name is required' using errcode = '22023';
    end if;
    v_bucket := 'delegated';
    v_status := 'waiting';
    v_task_scheduled_for := null;
    v_include_in_plan := false;
  else
    v_bucket := 'someday';
    v_status := 'open';
    v_task_scheduled_for := null;
    v_include_in_plan := false;
  end if;

  insert into public.tasks (
    workspace_id, created_by, source_capture_id, origin_daily_plan_id,
    focus_item_id, category_id,
    title, notes, status, bucket, priority, scheduled_for, due_at,
    delegate_name, delegate_email, delegated_at
  ) values (
    v_plan.workspace_id, v_uid, v_cap.id, v_plan.id,
    p_focus_item_id, v_cap.category_id,
    v_cap.content,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), v_cap.notes),
    v_status, v_bucket, 2, v_task_scheduled_for, p_due_at,
    case when p_decision = 'delegate'
      then nullif(btrim(p_delegate_name), '') end,
    case when p_decision = 'delegate'
      then nullif(btrim(coalesce(p_delegate_email, '')), '') end,
    case when p_decision = 'delegate' then now() end
  )
  returning id into v_task_id;

  if v_include_in_plan then
    select coalesce(max(sort_order), 0) + 10 into v_next_sort
      from public.daily_plan_items
     where daily_plan_id = p_daily_plan_id;

    insert into public.daily_plan_items
      (daily_plan_id, task_id, sort_order, is_top_three)
    values (p_daily_plan_id, v_task_id, v_next_sort, false)
    on conflict (daily_plan_id, task_id) do nothing
    returning id into v_item_id;
  end if;

  update public.captures
     set status = 'processed',
         processed_in_daily_plan_id = v_plan.id
   where id = v_cap.id;

  return jsonb_build_object(
    'task_id', v_task_id,
    'plan_item_id', v_item_id,
    'decision', p_decision,
    'in_plan', v_include_in_plan
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2b. start_my_day_undo_capture (clears session tracking on the capture)
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_undo_capture(
  p_capture_id uuid,
  p_daily_plan_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_cap public.captures;
  v_task public.tasks;
  v_found_task boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_plan
    from public.daily_plans where id = p_daily_plan_id for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
  end if;
  if v_plan.user_id <> v_uid then
    raise exception 'You do not own this daily plan' using errcode = '42501';
  end if;

  select * into v_cap
    from public.captures where id = p_capture_id for update;
  if not found then
    raise exception 'Capture not found' using errcode = 'P0002';
  end if;
  if v_cap.workspace_id <> v_plan.workspace_id then
    raise exception 'Capture and plan belong to different workspaces'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_cap.workspace_id and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if v_cap.status <> 'processed' then
    raise exception 'This thought is not in an undoable state'
      using errcode = 'P0001';
  end if;

  select * into v_task
    from public.tasks
   where source_capture_id = p_capture_id
     and workspace_id = v_cap.workspace_id
   for update;
  v_found_task := found;

  if v_found_task and not coalesce(p_force, false) then
    if v_task.status in ('completed', 'cancelled')
       or v_task.title is distinct from v_cap.content
       or v_task.updated_at > v_task.created_at + interval '3 seconds' then
      return jsonb_build_object('status', 'needs_confirmation');
    end if;
  end if;

  if v_found_task then
    delete from public.daily_plan_items where task_id = v_task.id;
    delete from public.tasks where id = v_task.id;
  end if;

  update public.captures
     set status = 'inbox',
         processed_in_daily_plan_id = null
   where id = v_cap.id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ----------------------------------------------------------------------------
-- 2c. start_my_day_batch_later
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_batch_later(
  p_daily_plan_id uuid,
  p_capture_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_ids uuid[];
  v_cap public.captures;
  v_task_id uuid;
  v_created uuid[] := '{}';
  v_skipped integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_capture_ids, '{}'::uuid[])) as x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No thoughts selected' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 50 then
    raise exception 'Select at most 50 thoughts at a time' using errcode = '22023';
  end if;

  select * into v_plan
    from public.daily_plans where id = p_daily_plan_id for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
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

  for v_cap in
    select * from public.captures
     where id = any(v_ids)
     order by id
     for update
  loop
    if v_cap.workspace_id <> v_plan.workspace_id then
      raise exception 'A selected thought belongs to another workspace'
        using errcode = '42501';
    end if;
    if v_cap.status <> 'inbox' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if exists (
      select 1 from public.tasks t where t.source_capture_id = v_cap.id
    ) then
      update public.captures
         set status = 'processed', processed_in_daily_plan_id = v_plan.id
       where id = v_cap.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.tasks (
      workspace_id, created_by, source_capture_id, origin_daily_plan_id,
      category_id, title, notes, status, bucket, priority
    ) values (
      v_plan.workspace_id, v_uid, v_cap.id, v_plan.id,
      v_cap.category_id, v_cap.content, v_cap.notes, 'open', 'someday', 2
    )
    returning id into v_task_id;

    update public.captures
       set status = 'processed', processed_in_daily_plan_id = v_plan.id
     where id = v_cap.id;
    v_created := v_created || v_task_id;
  end loop;

  return jsonb_build_object(
    'task_ids', to_jsonb(v_created),
    'moved', coalesce(array_length(v_created, 1), 0),
    'skipped', v_skipped
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2d. start_my_day_batch_discard
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_batch_discard(
  p_daily_plan_id uuid,
  p_capture_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_ids uuid[];
  v_discarded integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_capture_ids, '{}'::uuid[])) as x;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No thoughts selected' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 50 then
    raise exception 'Select at most 50 thoughts at a time' using errcode = '22023';
  end if;

  select * into v_plan
    from public.daily_plans where id = p_daily_plan_id for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
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

  if exists (
    select 1 from public.captures
     where id = any(v_ids) and workspace_id <> v_plan.workspace_id
  ) then
    raise exception 'A selected thought belongs to another workspace'
      using errcode = '42501';
  end if;

  with upd as (
    update public.captures
       set status = 'discarded',
           processed_in_daily_plan_id = v_plan.id
     where id = any(v_ids)
       and workspace_id = v_plan.workspace_id
       and status = 'inbox'
    returning 1
  )
  select count(*) into v_discarded from upd;

  return jsonb_build_object('discarded', v_discarded);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2e. start_my_day_batch_undo
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_batch_undo(
  p_daily_plan_id uuid,
  p_capture_ids uuid[],
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_ids uuid[];
  v_cap public.captures;
  v_task public.tasks;
  v_restored integer := 0;
  v_kept integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_kind not in ('later', 'discard') then
    raise exception 'Unknown undo kind' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_capture_ids, '{}'::uuid[])) as x;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Nothing to undo' using errcode = '22023';
  end if;

  select * into v_plan
    from public.daily_plans where id = p_daily_plan_id for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
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

  for v_cap in
    select * from public.captures
     where id = any(v_ids) and workspace_id = v_plan.workspace_id
     for update
  loop
    if p_kind = 'discard' then
      if v_cap.status = 'discarded' then
        update public.captures
           set status = 'inbox', processed_in_daily_plan_id = null
         where id = v_cap.id;
        v_restored := v_restored + 1;
      end if;
      continue;
    end if;

    select * into v_task
      from public.tasks
     where source_capture_id = v_cap.id
       and workspace_id = v_plan.workspace_id
     for update;

    if found then
      if v_task.status in ('completed', 'cancelled')
         or v_task.bucket <> 'someday'
         or v_task.title is distinct from v_cap.content
         or v_task.updated_at > v_task.created_at + interval '3 seconds' then
        v_kept := v_kept + 1;
        continue;
      end if;
      delete from public.daily_plan_items where task_id = v_task.id;
      delete from public.tasks where id = v_task.id;
    end if;

    if v_cap.status = 'processed' then
      update public.captures
         set status = 'inbox', processed_in_daily_plan_id = null
       where id = v_cap.id;
      v_restored := v_restored + 1;
    end if;
  end loop;

  return jsonb_build_object('restored', v_restored, 'kept', v_kept);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2f. today_set_task_done (unchanged body, redeclared for completeness)
-- ----------------------------------------------------------------------------
create or replace function public.today_set_task_done(
  p_daily_plan_id uuid,
  p_task_id uuid,
  p_done boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.daily_plans;
  v_task public.tasks;
  v_new_status public.task_status;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_plan
    from public.daily_plans where id = p_daily_plan_id for update;
  if not found then
    raise exception 'Daily plan not found' using errcode = 'P0002';
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

  select * into v_task
    from public.tasks where id = p_task_id for update;
  if not found or v_task.workspace_id <> v_plan.workspace_id then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if p_done then
    v_new_status := 'completed';
  elsif v_task.bucket = 'delegated' then
    v_new_status := 'waiting';
  else
    v_new_status := 'open';
  end if;

  update public.tasks set status = v_new_status where id = v_task.id;

  update public.daily_plan_items
     set completed_at = case when p_done then now() else null end
   where daily_plan_id = p_daily_plan_id
     and task_id = p_task_id;

  return jsonb_build_object('task_id', p_task_id, 'status', v_new_status);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. reset_current_daily_plan
--    Destructive teardown of the caller's daily plan for their local "today".
--    One locked transaction. Idempotent: a second call after a successful
--    reset simply reports that no plan was found.
-- ----------------------------------------------------------------------------
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
    into v_tz
    from public.profiles p
   where p.id = v_uid;
  if v_tz is null then
    v_tz := 'UTC';
  end if;

  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_today := (now() at time zone 'UTC')::date;
  end;

  -- Lock the plan for the whole operation; guards against double submissions.
  select * into v_plan
    from public.daily_plans
   where user_id = v_uid
     and plan_date = v_today
   order by created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'no_plan',
      'deleted_plan_items', 0,
      'deleted_session_tasks', 0,
      'restored_captures', 0,
      'reopened_tasks', 0,
      'legacy_untracked', false
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
   where origin_daily_plan_id = v_plan.id
     and workspace_id = v_plan.workspace_id;

  select count(*) into v_tracked_caps
    from public.captures
   where processed_in_daily_plan_id = v_plan.id
     and workspace_id = v_plan.workspace_id;

  select count(*) into v_items
    from public.daily_plan_items
   where daily_plan_id = v_plan.id;

  v_legacy := (v_items > 0 and v_tracked_tasks = 0 and v_tracked_caps = 0);

  -- Reopen pre-existing tasks that were completed inside this plan.
  if coalesce(p_reopen_completed, true) then
    with reopened as (
      update public.tasks t
         set status = case
               when t.bucket = 'delegated' then 'waiting'::public.task_status
               else 'open'::public.task_status
             end
       where t.id in (
               select dpi.task_id
                 from public.daily_plan_items dpi
                where dpi.daily_plan_id = v_plan.id
             )
         and t.workspace_id = v_plan.workspace_id
         and t.status = 'completed'
         and (t.origin_daily_plan_id is distinct from v_plan.id)
      returning 1
    )
    select count(*) into v_reopened from reopened;
  end if;

  -- Delete the plan items.
  with di as (
    delete from public.daily_plan_items
     where daily_plan_id = v_plan.id
    returning 1
  )
  select count(*) into v_items from di;

  -- Delete ONLY the tasks this session created.
  with dt as (
    delete from public.tasks
     where origin_daily_plan_id = v_plan.id
       and workspace_id = v_plan.workspace_id
    returning 1
  )
  select count(*) into v_tasks from dt;

  -- Return this session's captures to the inbox, untouched otherwise.
  with rc as (
    update public.captures
       set status = 'inbox',
           processed_at = null,
           processed_in_daily_plan_id = null
     where processed_in_daily_plan_id = v_plan.id
       and workspace_id = v_plan.workspace_id
    returning 1
  )
  select count(*) into v_caps from rc;

  -- Delete today's plan row.
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

-- ----------------------------------------------------------------------------
-- Grants: authenticated only.
-- ----------------------------------------------------------------------------
revoke all on function public.reset_current_daily_plan(boolean)
  from public, anon, authenticated;
grant execute on function public.reset_current_daily_plan(boolean)
  to authenticated;

commit;
