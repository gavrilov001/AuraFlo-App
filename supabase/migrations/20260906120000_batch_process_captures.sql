-- ============================================================================
-- AuraFlo — Start My Day: one shared decision layer for 1..N captures
--
-- ADDITIVE migration. Does NOT modify or drop any existing object.
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Adds:
--   * start_my_day_process_captures(...)  — apply ONE decision
--       (do_now | schedule | delegate | later | discard) to an array of inbox
--       captures in a single locked transaction. One task per capture; discard
--       creates no task. Used by both "One at a time" (array of 1) and
--       "Batch organize" (array of N).
--   * start_my_day_undo_captures(...)     — reverse that decision for the same
--       array (delete untouched session tasks + plan items, return captures to
--       the inbox; for discard just return captures to the inbox).
--
-- Mirrors the per-capture rules of start_my_day_process_capture exactly, incl.
-- the session-tracking columns origin_daily_plan_id / processed_in_daily_plan_id.
-- The app has a sequential fallback, so batch decisions work before this is
-- applied — but this RPC is the atomic, race-proof path.
-- ============================================================================

begin;

create or replace function public.start_my_day_process_captures(
  p_daily_plan_id uuid,
  p_capture_ids uuid[],
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
  v_ids uuid[];
  v_cap public.captures;
  v_bucket public.task_bucket;
  v_status public.task_status;
  v_task_scheduled_for date;
  v_include_in_plan boolean := false;
  v_task_id uuid;
  v_next_sort integer;
  v_created uuid[] := '{}';
  v_in_plan integer := 0;
  v_skipped integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('do_now', 'schedule', 'delegate', 'later', 'discard') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;

  -- Dedupe the payload (rejects duplicate capture ids implicitly).
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_capture_ids, '{}'::uuid[])) as x;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No thoughts selected' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 50 then
    raise exception 'Select at most 50 thoughts at a time' using errcode = '22023';
  end if;

  -- Lock the plan; verify ownership + workspace membership.
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

  -- Decision-level validation (once for the whole batch).
  if p_decision = 'schedule' and p_scheduled_for is null then
    raise exception 'A scheduled date is required' using errcode = '22023';
  end if;
  if p_decision = 'delegate'
     and nullif(btrim(coalesce(p_delegate_name, '')), '') is null then
    raise exception 'A delegate name is required' using errcode = '22023';
  end if;
  if p_focus_item_id is not null and not exists (
    select 1 from public.focus_items fi
     where fi.id = p_focus_item_id and fi.workspace_id = v_plan.workspace_id
  ) then
    raise exception 'That focus item no longer exists' using errcode = 'P0002';
  end if;

  if p_decision = 'do_now' then
    v_bucket := 'today'; v_status := 'open';
    v_task_scheduled_for := v_plan.plan_date; v_include_in_plan := true;
  elsif p_decision = 'schedule' then
    v_bucket := 'scheduled'; v_status := 'open';
    v_task_scheduled_for := p_scheduled_for;
    v_include_in_plan :=
      (p_scheduled_for = v_plan.plan_date and coalesce(p_add_to_today, false));
  elsif p_decision = 'delegate' then
    v_bucket := 'delegated'; v_status := 'waiting';
    v_task_scheduled_for := null; v_include_in_plan := false;
  elsif p_decision = 'later' then
    v_bucket := 'someday'; v_status := 'open';
    v_task_scheduled_for := null; v_include_in_plan := false;
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

    if p_decision = 'discard' then
      update public.captures
         set status = 'discarded',
             processed_in_daily_plan_id = v_plan.id
       where id = v_cap.id;
      v_created := v_created || v_cap.id;   -- track affected capture ids
      continue;
    end if;

    -- The same capture cannot create two tasks.
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
      focus_item_id, category_id, title, notes, status, bucket, priority,
      scheduled_for, due_at, delegate_name, delegate_email, delegated_at
    ) values (
      v_plan.workspace_id, v_uid, v_cap.id, v_plan.id,
      p_focus_item_id, v_cap.category_id, v_cap.content,
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
        from public.daily_plan_items where daily_plan_id = p_daily_plan_id;
      insert into public.daily_plan_items
        (daily_plan_id, task_id, sort_order, is_top_three)
      values (p_daily_plan_id, v_task_id, v_next_sort, false)
      on conflict (daily_plan_id, task_id) do nothing;
      v_in_plan := v_in_plan + 1;
    end if;

    update public.captures
       set status = 'processed', processed_in_daily_plan_id = v_plan.id
     where id = v_cap.id;
    v_created := v_created || v_task_id;
  end loop;

  return jsonb_build_object(
    'decision', p_decision,
    'processed', coalesce(array_length(v_created, 1), 0),
    'skipped', v_skipped,
    'in_plan', v_in_plan,
    'task_ids', to_jsonb(v_created)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- start_my_day_undo_captures
-- ----------------------------------------------------------------------------
create or replace function public.start_my_day_undo_captures(
  p_daily_plan_id uuid,
  p_capture_ids uuid[],
  p_decision text
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
  if p_decision not in ('do_now', 'schedule', 'delegate', 'later', 'discard') then
    raise exception 'Unknown decision' using errcode = '22023';
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
    if p_decision = 'discard' then
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
      -- Keep a task the user has since edited / completed / moved.
      if v_task.status in ('completed', 'cancelled')
         or v_task.origin_daily_plan_id is distinct from v_plan.id
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
-- Grants: authenticated only.
-- ----------------------------------------------------------------------------
revoke all on function public.start_my_day_process_captures(
  uuid, uuid[], text, date, timestamptz, text, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_my_day_process_captures(
  uuid, uuid[], text, date, timestamptz, text, uuid, text, text, boolean
) to authenticated;

revoke all on function public.start_my_day_undo_captures(uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.start_my_day_undo_captures(uuid, uuid[], text)
  to authenticated;

commit;
