begin;

create or replace function public.workspace_clear_processed_captures(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin']::public.workspace_role[]
  ) then
    raise exception 'Only workspace owners and admins can clear processed captures'
      using errcode = '42501';
  end if;

  with deleted as (
    delete from public.captures
     where workspace_id = p_workspace_id
       and status = 'processed'
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

create or replace function public.workspace_delete_all_tasks(
  p_workspace_id uuid,
  p_today date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin']::public.workspace_role[]
  ) then
    raise exception 'Only workspace owners and admins can delete workspace tasks'
      using errcode = '42501';
  end if;

  with deleted as (
    delete from public.tasks
     where workspace_id = p_workspace_id
    returning 1
  )
  select count(*) into v_deleted from deleted;

  delete from public.daily_plans
   where workspace_id = p_workspace_id
     and user_id = v_uid
     and plan_date = p_today;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.workspace_clear_processed_captures(uuid)
  from public, anon, authenticated;
grant execute on function public.workspace_clear_processed_captures(uuid)
  to authenticated;

revoke all on function public.workspace_delete_all_tasks(uuid, date)
  from public, anon, authenticated;
grant execute on function public.workspace_delete_all_tasks(uuid, date)
  to authenticated;

commit;
