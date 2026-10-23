-- ============================================================================
-- AuraFlo — All Tasks module: transactional task mutations
--
-- ADDITIVE migration. Does NOT modify or drop any existing object.
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Adds SECURITY DEFINER RPCs used by /app/tasks so that operations touching
-- both `tasks` and `daily_plan_items` (and, for "Today", `daily_plans`) happen
-- in one locked transaction:
--
--   * tasks_create              — create a task with a destination
--   * tasks_move_to_destination — move a task between Today / Scheduled /
--                                 Delegated / Later
--   * tasks_set_status          — complete / reopen / cancel (syncs plan items)
--   * tasks_set_top_three       — toggle daily_plan_items.is_top_three (<= 3)
--   * tasks_reorder             — rewrite tasks.sort_order for one group
--
-- All verify auth.uid(), workspace membership, and (for Today) daily-plan
-- ownership. The app has sequential fallbacks so All Tasks works before this is
-- applied, but these RPCs are the atomic, race-proof path.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- helper: the caller's daily plan for their local "today" (creates a draft
-- plan if none; reopens a completed plan only when p_allow_reopen is true).
-- ---------------------------------------------------------------------------
create or replace function public._tasks_today_plan(
  p_workspace_id uuid,
  p_allow_reopen boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_today date;
  v_plan public.daily_plans;
begin
  select coalesce(nullif(btrim(p.timezone), ''), 'UTC') into v_tz
    from public.profiles p where p.id = v_uid;
  if v_tz is null then v_tz := 'UTC'; end if;
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_today := (now() at time zone 'UTC')::date;
  end;

  select * into v_plan
    from public.daily_plans
   where workspace_id = p_workspace_id and user_id = v_uid and plan_date = v_today
   for update;

  if not found then
    insert into public.daily_plans (workspace_id, user_id, plan_date, status, workflow_step)
    values (p_workspace_id, v_uid, v_today, 'draft', 'capture_review')
    on conflict (workspace_id, user_id, plan_date) do nothing;
    select * into v_plan
      from public.daily_plans
     where workspace_id = p_workspace_id and user_id = v_uid and plan_date = v_today
     for update;
  end if;

  if v_plan.status = 'completed' then
    if not coalesce(p_allow_reopen, false) then
      raise exception 'plan_completed' using errcode = 'P0001';
    end if;
    update public.daily_plans
       set status = 'active', completed_at = null
     where id = v_plan.id;
  end if;

  return v_plan.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- helper: assert the task belongs to a workspace the caller is a member of;
-- returns the task row.
-- ---------------------------------------------------------------------------
create or replace function public._tasks_owned(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_task.workspace_id and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks_create
-- ---------------------------------------------------------------------------
create or replace function public.tasks_create(
  p_workspace_id uuid,
  p_title text,
  p_bucket text,
  p_notes text default null,
  p_category_id uuid default null,
  p_focus_item_id uuid default null,
  p_scheduled_for date default null,
  p_due_at timestamptz default null,
  p_delegate_name text default null,
  p_delegate_email text default null,
  p_priority smallint default 2,
  p_reopen_plan boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_bucket public.task_bucket;
  v_status public.task_status;
  v_scheduled date;
  v_task_id uuid;
  v_plan_id uuid;
  v_next_sort integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_bucket not in ('today', 'scheduled', 'delegated', 'someday') then
    raise exception 'Unknown destination' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'A title is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c
     where c.id = p_category_id and c.workspace_id = p_workspace_id
  ) then
    raise exception 'That category is not in your workspace' using errcode = '42501';
  end if;
  if p_focus_item_id is not null and not exists (
    select 1 from public.focus_items f
     where f.id = p_focus_item_id and f.workspace_id = p_workspace_id
  ) then
    raise exception 'That focus item is not in your workspace' using errcode = '42501';
  end if;

  if p_bucket = 'today' then
    v_bucket := 'today'; v_status := 'open';
    v_plan_id := public._tasks_today_plan(p_workspace_id, p_reopen_plan);
    v_scheduled := (select plan_date from public.daily_plans where id = v_plan_id);
  elsif p_bucket = 'scheduled' then
    if p_scheduled_for is null then
      raise exception 'A date is required' using errcode = '22023';
    end if;
    v_bucket := 'scheduled'; v_status := 'open'; v_scheduled := p_scheduled_for;
  elsif p_bucket = 'delegated' then
    if nullif(btrim(coalesce(p_delegate_name, '')), '') is null then
      raise exception 'A delegate name is required' using errcode = '22023';
    end if;
    v_bucket := 'delegated'; v_status := 'waiting'; v_scheduled := null;
  else
    v_bucket := 'someday'; v_status := 'open'; v_scheduled := null;
  end if;

  insert into public.tasks (
    workspace_id, created_by, category_id, focus_item_id, title, notes,
    status, bucket, priority, scheduled_for, due_at,
    delegate_name, delegate_email, delegated_at
  ) values (
    p_workspace_id, v_uid, p_category_id, p_focus_item_id,
    btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''),
    v_status, v_bucket, coalesce(p_priority, 2), v_scheduled, p_due_at,
    case when v_bucket = 'delegated' then nullif(btrim(p_delegate_name), '') end,
    case when v_bucket = 'delegated' then nullif(btrim(coalesce(p_delegate_email, '')), '') end,
    case when v_bucket = 'delegated' then now() end
  )
  returning id into v_task_id;

  if v_bucket = 'today' then
    select coalesce(max(sort_order), 0) + 10 into v_next_sort
      from public.daily_plan_items where daily_plan_id = v_plan_id;
    insert into public.daily_plan_items (daily_plan_id, task_id, sort_order, is_top_three)
    values (v_plan_id, v_task_id, v_next_sort, false)
    on conflict (daily_plan_id, task_id) do nothing;
  end if;

  return jsonb_build_object(
    'task', (select to_jsonb(t) from public.tasks t where t.id = v_task_id),
    'plan_id', v_plan_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks_move_to_destination
-- ---------------------------------------------------------------------------
create or replace function public.tasks_move_to_destination(
  p_task_id uuid,
  p_bucket text,
  p_scheduled_for date default null,
  p_due_at timestamptz default null,
  p_delegate_name text default null,
  p_delegate_email text default null,
  p_reopen_plan boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_plan_id uuid;
  v_next_sort integer;
  v_scheduled date;
begin
  if p_bucket not in ('today', 'scheduled', 'delegated', 'someday') then
    raise exception 'Unknown destination' using errcode = '22023';
  end if;
  v_task := public._tasks_owned(p_task_id);
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'That task is not active' using errcode = 'P0001';
  end if;

  -- Detach from every one of the caller's daily plans (clears is_top_three).
  delete from public.daily_plan_items
   where task_id = p_task_id
     and daily_plan_id in (
       select id from public.daily_plans where user_id = v_uid
     );

  if p_bucket = 'today' then
    v_plan_id := public._tasks_today_plan(v_task.workspace_id, p_reopen_plan);
    v_scheduled := (select plan_date from public.daily_plans where id = v_plan_id);
    update public.tasks
       set bucket = 'today', status = 'open', scheduled_for = v_scheduled
     where id = p_task_id;
    select coalesce(max(sort_order), 0) + 10 into v_next_sort
      from public.daily_plan_items where daily_plan_id = v_plan_id;
    insert into public.daily_plan_items (daily_plan_id, task_id, sort_order, is_top_three)
    values (v_plan_id, p_task_id, v_next_sort, false)
    on conflict (daily_plan_id, task_id) do nothing;

  elsif p_bucket = 'scheduled' then
    if p_scheduled_for is null then
      raise exception 'A date is required' using errcode = '22023';
    end if;
    update public.tasks
       set bucket = 'scheduled', status = 'open', scheduled_for = p_scheduled_for,
           due_at = coalesce(p_due_at, due_at),
           delegate_name = null, delegate_email = null, delegated_at = null
     where id = p_task_id;

  elsif p_bucket = 'delegated' then
    if nullif(btrim(coalesce(p_delegate_name, '')), '') is null then
      raise exception 'A delegate name is required' using errcode = '22023';
    end if;
    update public.tasks
       set bucket = 'delegated', status = 'waiting', scheduled_for = null,
           due_at = coalesce(p_due_at, due_at),
           delegate_name = btrim(p_delegate_name),
           delegate_email = nullif(btrim(coalesce(p_delegate_email, '')), ''),
           delegated_at = now()
     where id = p_task_id;

  else
    update public.tasks
       set bucket = 'someday', status = 'open', scheduled_for = null,
           delegate_name = null, delegate_email = null, delegated_at = null
     where id = p_task_id;
  end if;

  return (select to_jsonb(t) from public.tasks t where t.id = p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks_set_status  (p_op: 'complete' | 'reopen' | 'cancel')
-- ---------------------------------------------------------------------------
create or replace function public.tasks_set_status(
  p_task_id uuid,
  p_op text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_new public.task_status;
begin
  if p_op not in ('complete', 'reopen', 'cancel') then
    raise exception 'Unknown operation' using errcode = '22023';
  end if;
  v_task := public._tasks_owned(p_task_id);

  if p_op = 'complete' then
    v_new := 'completed';
  elsif p_op = 'cancel' then
    v_new := 'cancelled';
  else
    v_new := case when v_task.bucket = 'delegated' then 'waiting'::public.task_status
                  else 'open'::public.task_status end;
  end if;

  update public.tasks set status = v_new where id = p_task_id;

  if p_op = 'cancel' then
    delete from public.daily_plan_items
     where task_id = p_task_id
       and daily_plan_id in (select id from public.daily_plans where user_id = v_uid);
  else
    update public.daily_plan_items
       set completed_at = case when p_op = 'complete' then now() else null end
     where task_id = p_task_id
       and daily_plan_id in (select id from public.daily_plans where user_id = v_uid);
  end if;

  return (select to_jsonb(t) from public.tasks t where t.id = p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks_set_top_three
-- ---------------------------------------------------------------------------
create or replace function public.tasks_set_top_three(
  p_task_id uuid,
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_plan_id uuid;
  v_item_id uuid;
  v_count integer;
begin
  v_task := public._tasks_owned(p_task_id);

  select dpi.id, dpi.daily_plan_id into v_item_id, v_plan_id
    from public.daily_plan_items dpi
    join public.daily_plans dp on dp.id = dpi.daily_plan_id
   where dpi.task_id = p_task_id
     and dp.user_id = v_uid
     and dp.workspace_id = v_task.workspace_id
   order by dp.plan_date desc
   limit 1;

  if v_item_id is null then
    raise exception 'That task is not on a daily plan' using errcode = 'P0002';
  end if;

  if p_value then
    select count(*) into v_count
      from public.daily_plan_items
     where daily_plan_id = v_plan_id and is_top_three = true and id <> v_item_id;
    if v_count >= 3 then
      raise exception 'You can choose up to three top priorities' using errcode = 'P0001';
    end if;
  end if;

  update public.daily_plan_items set is_top_three = p_value where id = v_item_id;

  return jsonb_build_object('task_id', p_task_id, 'is_top_three', p_value, 'plan_id', v_plan_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks_reorder  (one bucket / group only; rewrites sort_order)
-- ---------------------------------------------------------------------------
create or replace function public.tasks_reorder(
  p_task_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_ws uuid;
  v_id uuid;
  v_pos integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_task_ids, '{}'::uuid[])) as x;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Nothing to reorder' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) <> array_length(p_task_ids, 1) then
    raise exception 'Duplicate task ids' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 500 then
    raise exception 'Too many tasks' using errcode = '22023';
  end if;

  -- Every id must exist and the whole set must be one workspace + one bucket.
  if (select count(distinct workspace_id) from public.tasks where id = any(v_ids)) <> 1
     or (select count(distinct bucket) from public.tasks where id = any(v_ids)) <> 1
     or (select count(*) from public.tasks where id = any(v_ids)) <> array_length(v_ids, 1)
  then
    raise exception 'Tasks must be one group' using errcode = 'P0001';
  end if;

  select workspace_id into v_ws from public.tasks where id = v_ids[1];
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_ws and wm.user_id = v_uid
  ) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  foreach v_id in array v_ids loop
    v_pos := v_pos + 10;
    update public.tasks set sort_order = v_pos where id = v_id;
  end loop;

  return jsonb_build_object('reordered', array_length(v_ids, 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only. Helpers are internal (no direct grant).
-- ---------------------------------------------------------------------------
revoke all on function public._tasks_today_plan(uuid, boolean) from public, anon, authenticated;
revoke all on function public._tasks_owned(uuid) from public, anon, authenticated;

revoke all on function public.tasks_create(
  uuid, text, text, text, uuid, uuid, date, timestamptz, text, text, smallint, boolean
) from public, anon, authenticated;
grant execute on function public.tasks_create(
  uuid, text, text, text, uuid, uuid, date, timestamptz, text, text, smallint, boolean
) to authenticated;

revoke all on function public.tasks_move_to_destination(
  uuid, text, date, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.tasks_move_to_destination(
  uuid, text, date, timestamptz, text, text, boolean
) to authenticated;

revoke all on function public.tasks_set_status(uuid, text) from public, anon, authenticated;
grant execute on function public.tasks_set_status(uuid, text) to authenticated;

revoke all on function public.tasks_set_top_three(uuid, boolean) from public, anon, authenticated;
grant execute on function public.tasks_set_top_three(uuid, boolean) to authenticated;

revoke all on function public.tasks_reorder(uuid[]) from public, anon, authenticated;
grant execute on function public.tasks_reorder(uuid[]) to authenticated;

commit;
