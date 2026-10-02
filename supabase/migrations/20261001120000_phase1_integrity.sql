begin;

create or replace function public.reset_workspace_daily_plan(
  p_workspace_id uuid,
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

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
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

  select * into v_plan
    from public.daily_plans
   where workspace_id = p_workspace_id
     and user_id = v_uid
     and plan_date = v_today
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'no_plan', 'deleted_plan_items', 0,
      'deleted_session_tasks', 0, 'restored_captures', 0,
      'reopened_tasks', 0, 'legacy_untracked', false
    );
  end if;

  select count(*) into v_tracked_tasks
    from public.tasks
   where origin_daily_plan_id = v_plan.id
     and workspace_id = p_workspace_id;

  select count(*) into v_tracked_caps
    from public.captures
   where processed_in_daily_plan_id = v_plan.id
     and workspace_id = p_workspace_id;

  select count(*) into v_items
    from public.daily_plan_items
   where daily_plan_id = v_plan.id;

  v_legacy := (v_items > 0 and v_tracked_tasks = 0 and v_tracked_caps = 0);

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
         and t.workspace_id = p_workspace_id
         and t.status = 'completed'
         and (t.origin_daily_plan_id is distinct from v_plan.id)
      returning 1
    )
    select count(*) into v_reopened from reopened;
  end if;

  with deleted as (
    delete from public.daily_plan_items
     where daily_plan_id = v_plan.id
    returning 1
  )
  select count(*) into v_items from deleted;

  with deleted as (
    delete from public.tasks
     where origin_daily_plan_id = v_plan.id
       and workspace_id = p_workspace_id
    returning 1
  )
  select count(*) into v_tasks from deleted;

  with restored as (
    update public.captures
       set status = 'inbox', processed_at = null,
           processed_in_daily_plan_id = null
     where processed_in_daily_plan_id = v_plan.id
       and workspace_id = p_workspace_id
       and status in ('processed', 'discarded')
    returning 1
  )
  select count(*) into v_caps from restored;

  delete from public.daily_plans
   where id = v_plan.id
     and workspace_id = p_workspace_id;

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
  v_workspace_id uuid;
  v_plan_count integer;
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

  select count(*)
    into v_plan_count
    from public.daily_plans
   where user_id = v_uid
     and plan_date = v_today;

  if v_plan_count = 0 then
    return jsonb_build_object(
      'status', 'no_plan', 'deleted_plan_items', 0,
      'deleted_session_tasks', 0, 'restored_captures', 0,
      'reopened_tasks', 0, 'legacy_untracked', false
    );
  end if;

  if v_plan_count > 1 then
    raise exception 'workspace_required' using errcode = 'P0001';
  end if;

  select workspace_id
    into v_workspace_id
    from public.daily_plans
   where user_id = v_uid
     and plan_date = v_today
   limit 1;

  return public.reset_workspace_daily_plan(
    v_workspace_id,
    p_reopen_completed
  );
end;
$$;

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

  delete from public.daily_plan_items
   where task_id = p_task_id
     and daily_plan_id in (
       select id from public.daily_plans
        where user_id = v_uid
          and workspace_id = v_task.workspace_id
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
           due_at = coalesce(p_due_at, due_at), delegate_name = null,
           delegate_email = null, delegated_at = null
     where id = p_task_id;
  elsif p_bucket = 'delegated' then
    if nullif(btrim(coalesce(p_delegate_name, '')), '') is null then
      raise exception 'A delegate name is required' using errcode = '22023';
    end if;
    update public.tasks
       set bucket = 'delegated', status = 'waiting', scheduled_for = null,
           due_at = coalesce(p_due_at, due_at), delegate_name = btrim(p_delegate_name),
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
       and daily_plan_id in (
         select id from public.daily_plans
          where user_id = v_uid
            and workspace_id = v_task.workspace_id
       );
  else
    update public.daily_plan_items
       set completed_at = case when p_op = 'complete' then now() else null end
     where task_id = p_task_id
       and daily_plan_id in (
         select id from public.daily_plans
          where user_id = v_uid
            and workspace_id = v_task.workspace_id
       );
  end if;

  return (select to_jsonb(t) from public.tasks t where t.id = p_task_id);
end;
$$;

revoke all on function public.reset_workspace_daily_plan(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.reset_workspace_daily_plan(uuid, boolean)
  to authenticated;

revoke all on function public.reset_current_daily_plan(boolean)
  from public, anon, authenticated;
grant execute on function public.reset_current_daily_plan(boolean)
  to authenticated;

revoke all on function public.tasks_move_to_destination(
  uuid, text, date, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.tasks_move_to_destination(
  uuid, text, date, timestamptz, text, text, boolean
) to authenticated;

revoke all on function public.tasks_set_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.tasks_set_status(uuid, text)
  to authenticated;

commit;
