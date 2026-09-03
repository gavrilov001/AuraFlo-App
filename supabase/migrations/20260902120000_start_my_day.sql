-- ============================================================================
-- AuraFlo — Start My Day: transactional capture processing
--
-- ADDITIVE migration. Does NOT modify supabase_initial_schema.sql objects.
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Adds two SECURITY DEFINER RPCs used by the Start My Day workflow so that
-- converting an inbox capture into a task (and optionally a daily-plan item)
-- and marking the capture processed happen in a single locked transaction.
--
-- The application also has a sequential fallback that relies on the existing
-- unique constraint tasks.source_capture_id, so Start My Day works before this
-- migration is applied — but this RPC is the preferred, race-proof path.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- start_my_day_process_capture
--   p_decision: 'do_now' | 'schedule' | 'delegate' | 'later'
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

  -- Lock the plan for the whole operation.
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

  -- Lock the capture and re-check it is still an unprocessed inbox item.
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
    workspace_id, created_by, source_capture_id, focus_item_id, category_id,
    title, notes, status, bucket, priority, scheduled_for, due_at,
    delegate_name, delegate_email, delegated_at
  ) values (
    v_plan.workspace_id, v_uid, v_cap.id, p_focus_item_id, v_cap.category_id,
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

  update public.captures set status = 'processed' where id = v_cap.id;

  return jsonb_build_object(
    'task_id', v_task_id,
    'plan_item_id', v_item_id,
    'decision', p_decision,
    'in_plan', v_include_in_plan
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- start_my_day_undo_capture
--   Reverses a process decision: deletes the task + its plan item and returns
--   the capture to the inbox. Refuses (needs_confirmation) when the task looks
--   completed / cancelled / renamed / edited, unless p_force is true.
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

  update public.captures set status = 'inbox' where id = v_cap.id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: authenticated only.
-- ----------------------------------------------------------------------------
revoke all on function public.start_my_day_process_capture(
  uuid, uuid, text, date, timestamptz, text, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_my_day_process_capture(
  uuid, uuid, text, date, timestamptz, text, uuid, text, text, boolean
) to authenticated;

revoke all on function public.start_my_day_undo_capture(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.start_my_day_undo_capture(uuid, uuid, boolean)
  to authenticated;

commit;
