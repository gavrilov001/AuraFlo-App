-- ============================================================================
-- AuraFlo — Start My Day (batch) + Today: transactional helpers
--
-- ADDITIVE migration. Does NOT modify supabase_initial_schema.sql objects.
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Adds SECURITY DEFINER RPCs:
--   * start_my_day_batch_later    — move up to 50 inbox captures to "Later"
--                                   (one task per capture) in one transaction
--   * start_my_day_batch_discard  — discard up to 50 inbox captures at once
--   * start_my_day_batch_undo     — reverse a batch (delete untouched tasks,
--                                   return captures to the inbox) or un-discard
--   * today_set_task_done         — atomically complete / reopen a task and its
--                                   daily_plan_items row
--
-- The application has sequential fallbacks (guarded by the existing
-- tasks.source_capture_id unique constraint), so these features work before the
-- migration is applied — but these RPCs are the preferred race-proof path.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- start_my_day_batch_later
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
      update public.captures set status = 'processed' where id = v_cap.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.tasks (
      workspace_id, created_by, source_capture_id, category_id,
      title, notes, status, bucket, priority
    ) values (
      v_plan.workspace_id, v_uid, v_cap.id, v_cap.category_id,
      v_cap.content, v_cap.notes, 'open', 'someday', 2
    )
    returning id into v_task_id;

    update public.captures set status = 'processed' where id = v_cap.id;
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
-- start_my_day_batch_discard
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
       set status = 'discarded'
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
-- start_my_day_batch_undo
--   p_kind: 'later' (delete created tasks, captures -> inbox)
--           'discard' (captures -> inbox)
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
        update public.captures set status = 'inbox' where id = v_cap.id;
        v_restored := v_restored + 1;
      end if;
      continue;
    end if;

    -- kind = 'later'
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
      update public.captures set status = 'inbox' where id = v_cap.id;
      v_restored := v_restored + 1;
    end if;
  end loop;

  return jsonb_build_object('restored', v_restored, 'kept', v_kept);
end;
$$;

-- ----------------------------------------------------------------------------
-- today_set_task_done
--   Atomically complete / reopen a task and sync its daily_plan_items row.
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
-- Grants: authenticated only.
-- ----------------------------------------------------------------------------
revoke all on function public.start_my_day_batch_later(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.start_my_day_batch_later(uuid, uuid[])
  to authenticated;

revoke all on function public.start_my_day_batch_discard(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.start_my_day_batch_discard(uuid, uuid[])
  to authenticated;

revoke all on function public.start_my_day_batch_undo(uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.start_my_day_batch_undo(uuid, uuid[], text)
  to authenticated;

revoke all on function public.today_set_task_done(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.today_set_task_done(uuid, uuid, boolean)
  to authenticated;

commit;
