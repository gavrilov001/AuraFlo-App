-- ============================================================================
-- AuraFlo — Step 2 drag-and-drop: transactional plan-item reorder
--
-- ADDITIVE migration. Does NOT modify or drop any existing object.
-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Adds public.reorder_daily_plan_items(p_daily_plan_id uuid, p_item_ids uuid[])
-- which rewrites sort_order for every item of one daily plan in a single locked
-- transaction. The client sends the full ordered id list once, on drop.
--
-- The app also has a sequential fallback (two paired sort_order swaps), so the
-- Move up / Move down controls keep working before this migration is applied —
-- but the RPC is the preferred atomic path for a full drag reorder.
-- ============================================================================

begin;

create or replace function public.reorder_daily_plan_items(
  p_daily_plan_id uuid,
  p_item_ids uuid[]
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
  v_distinct integer;
  v_existing integer;
  v_id uuid;
  v_pos integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_ids := coalesce(p_item_ids, '{}'::uuid[]);
  if array_length(v_ids, 1) is null then
    raise exception 'No items supplied' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 200 then
    raise exception 'Too many items' using errcode = '22023';
  end if;

  -- Reject duplicate ids in the payload.
  select count(distinct x) into v_distinct from unnest(v_ids) as x;
  if v_distinct <> array_length(v_ids, 1) then
    raise exception 'Duplicate item ids' using errcode = '22023';
  end if;

  -- Lock the plan for the whole operation and verify ownership.
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

  -- Every submitted id must belong to this plan, and the payload must cover
  -- every item of the plan exactly once (no missing / foreign ids).
  select count(*) into v_existing
    from public.daily_plan_items
   where daily_plan_id = p_daily_plan_id;

  if v_existing <> array_length(v_ids, 1) then
    raise exception 'Item set does not match the plan' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from unnest(v_ids) as sub(id)
     where not exists (
       select 1 from public.daily_plan_items dpi
        where dpi.id = sub.id and dpi.daily_plan_id = p_daily_plan_id
     )
  ) then
    raise exception 'An item does not belong to this plan' using errcode = '42501';
  end if;

  foreach v_id in array v_ids loop
    v_pos := v_pos + 10;
    update public.daily_plan_items
       set sort_order = v_pos
     where id = v_id
       and daily_plan_id = p_daily_plan_id;
  end loop;

  return jsonb_build_object('reordered', array_length(v_ids, 1));
end;
$$;

revoke all on function public.reorder_daily_plan_items(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_daily_plan_items(uuid, uuid[])
  to authenticated;

commit;
