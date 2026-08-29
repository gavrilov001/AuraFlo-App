-- AuraFlo productivity MVP: initial Supabase schema
-- Paste this entire file into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- It is wrapped in a transaction: if any statement fails, the schema is rolled back.

begin;

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member', 'assistant');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.focus_horizon as enum ('short', 'medium', 'long');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.focus_status as enum ('active', 'paused', 'completed', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.capture_source as enum ('manual', 'voice', 'quo', 'import');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.capture_status as enum ('inbox', 'processed', 'discarded', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('open', 'in_progress', 'waiting', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_bucket as enum ('today', 'scheduled', 'delegated', 'someday');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.daily_plan_status as enum ('draft', 'active', 'completed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.daily_workflow_step as enum ('capture_review', 'prioritize', 'ready');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(btrim(name)) > 0),
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.focus_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  horizon public.focus_horizon not null,
  status public.focus_status not null default 'active',
  target_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  content text not null check (char_length(btrim(content)) > 0),
  notes text,
  source public.capture_source not null default 'manual',
  source_external_id text,
  status public.capture_status not null default 'inbox',
  category_id uuid references public.categories(id) on delete set null,
  captured_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  source_capture_id uuid unique references public.captures(id) on delete set null,
  focus_item_id uuid references public.focus_items(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  title text not null check (char_length(btrim(title)) > 0),
  notes text,
  status public.task_status not null default 'open',
  bucket public.task_bucket not null,
  priority smallint not null default 2 check (priority between 1 and 4),
  scheduled_for date,
  due_at timestamptz,
  assignee_user_id uuid references public.profiles(id) on delete set null,
  delegate_name text,
  delegate_email text,
  delegated_at timestamptz,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delegated_task_has_delegate check (
    bucket <> 'delegated'
    or assignee_user_id is not null
    or nullif(btrim(delegate_name), '') is not null
    or nullif(btrim(delegate_email), '') is not null
  )
);

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_date date not null,
  status public.daily_plan_status not null default 'draft',
  workflow_step public.daily_workflow_step not null default 'capture_review',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, plan_date)
);

create table if not exists public.daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  sort_order integer not null default 0,
  is_top_three boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (daily_plan_id, task_id)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

create index if not exists workspaces_owner_id_idx
  on public.workspaces(owner_id);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members(user_id);

create index if not exists categories_workspace_sort_idx
  on public.categories(workspace_id, sort_order);

create index if not exists focus_items_workspace_horizon_status_idx
  on public.focus_items(workspace_id, horizon, status, sort_order);

create index if not exists captures_workspace_status_captured_idx
  on public.captures(workspace_id, status, captured_at desc);

create index if not exists captures_category_id_idx
  on public.captures(category_id);

create unique index if not exists captures_external_source_unique_idx
  on public.captures(workspace_id, source, source_external_id)
  where source_external_id is not null;

create index if not exists tasks_workspace_bucket_status_idx
  on public.tasks(workspace_id, bucket, status, sort_order);

create index if not exists tasks_workspace_scheduled_for_idx
  on public.tasks(workspace_id, scheduled_for)
  where scheduled_for is not null;

create index if not exists tasks_workspace_due_at_idx
  on public.tasks(workspace_id, due_at)
  where due_at is not null;

create index if not exists tasks_focus_item_id_idx
  on public.tasks(focus_item_id);

create index if not exists tasks_category_id_idx
  on public.tasks(category_id);

create index if not exists tasks_assignee_user_id_idx
  on public.tasks(assignee_user_id);

create index if not exists daily_plans_workspace_user_date_idx
  on public.daily_plans(workspace_id, user_id, plan_date desc);

create index if not exists daily_plan_items_plan_sort_idx
  on public.daily_plan_items(daily_plan_id, is_top_three desc, sort_order);

create index if not exists daily_plan_items_task_id_idx
  on public.daily_plan_items(task_id);

-- -----------------------------------------------------------------------------
-- Reusable trigger functions
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_workspace_record_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.protect_workspace_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Workspace ownership transfer is not enabled yet';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_owner_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actual_owner_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.workspace_id is distinct from old.workspace_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Workspace membership identity cannot be changed';
  end if;

  select w.owner_id
    into actual_owner_id
    from public.workspaces w
   where w.id = new.workspace_id;

  if actual_owner_id is null then
    raise exception 'Workspace does not exist';
  end if;

  if new.user_id = actual_owner_id and new.role <> 'owner' then
    raise exception 'The workspace owner must keep the owner role';
  end if;

  if new.user_id <> actual_owner_id and new.role = 'owner' then
    raise exception 'Only the workspace owner can have the owner role';
  end if;

  return new;
end;
$$;

create or replace function public.sync_capture_processed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('processed', 'discarded', 'archived')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.processed_at = coalesce(new.processed_at, now());
  elsif new.status = 'inbox' then
    new.processed_at = null;
  end if;

  return new;
end;
$$;

create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at = coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

create or replace function public.protect_daily_plan_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id
     or new.plan_date is distinct from old.plan_date then
    raise exception 'The workspace, user, and date of a daily plan cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.validate_daily_plan_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_workspace_id uuid;
  task_workspace_id uuid;
  top_three_count integer;
begin
  -- Lock the plan so two concurrent requests cannot both create a fourth Top 3 item.
  perform 1
    from public.daily_plans dp
   where dp.id = new.daily_plan_id
   for update;

  select dp.workspace_id
    into plan_workspace_id
    from public.daily_plans dp
   where dp.id = new.daily_plan_id;

  if plan_workspace_id is null then
    raise exception 'Daily plan does not exist';
  end if;

  select t.workspace_id
    into task_workspace_id
    from public.tasks t
   where t.id = new.task_id;

  if task_workspace_id is null then
    raise exception 'Task does not exist';
  end if;

  if plan_workspace_id <> task_workspace_id then
    raise exception 'The task and daily plan must belong to the same workspace';
  end if;

  if new.is_top_three then
    select count(*)
      into top_three_count
      from public.daily_plan_items dpi
     where dpi.daily_plan_id = new.daily_plan_id
       and dpi.is_top_three = true
       and dpi.id <> new.id;

    if top_three_count >= 3 then
      raise exception 'A daily plan can have no more than three Top Priorities';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists set_focus_items_updated_at on public.focus_items;
create trigger set_focus_items_updated_at
before update on public.focus_items
for each row execute function public.set_updated_at();

drop trigger if exists set_captures_updated_at on public.captures;
create trigger set_captures_updated_at
before update on public.captures
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_plans_updated_at on public.daily_plans;
create trigger set_daily_plans_updated_at
before update on public.daily_plans
for each row execute function public.set_updated_at();

drop trigger if exists protect_workspaces_owner on public.workspaces;
create trigger protect_workspaces_owner
before update on public.workspaces
for each row execute function public.protect_workspace_owner();

drop trigger if exists enforce_workspace_members_owner_role on public.workspace_members;
create trigger enforce_workspace_members_owner_role
before insert or update on public.workspace_members
for each row execute function public.enforce_workspace_owner_role();

drop trigger if exists protect_categories_identity on public.categories;
create trigger protect_categories_identity
before update on public.categories
for each row execute function public.protect_workspace_record_identity();

drop trigger if exists protect_focus_items_identity on public.focus_items;
create trigger protect_focus_items_identity
before update on public.focus_items
for each row execute function public.protect_workspace_record_identity();

drop trigger if exists protect_captures_identity on public.captures;
create trigger protect_captures_identity
before update on public.captures
for each row execute function public.protect_workspace_record_identity();

drop trigger if exists protect_tasks_identity on public.tasks;
create trigger protect_tasks_identity
before update on public.tasks
for each row execute function public.protect_workspace_record_identity();

drop trigger if exists sync_captures_processed_at on public.captures;
create trigger sync_captures_processed_at
before insert or update of status on public.captures
for each row execute function public.sync_capture_processed_at();

drop trigger if exists sync_tasks_completed_at on public.tasks;
create trigger sync_tasks_completed_at
before insert or update of status on public.tasks
for each row execute function public.sync_task_completed_at();

drop trigger if exists protect_daily_plans_identity on public.daily_plans;
create trigger protect_daily_plans_identity
before update on public.daily_plans
for each row execute function public.protect_daily_plan_identity();

drop trigger if exists validate_daily_plan_items on public.daily_plan_items;
create trigger validate_daily_plan_items
before insert or update on public.daily_plan_items
for each row execute function public.validate_daily_plan_item();

-- -----------------------------------------------------------------------------
-- Automatically create a profile and personal workspace after sign-up
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  new_full_name text;
  new_timezone text;
begin
  new_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  new_timezone := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'timezone'), ''), 'UTC');

  insert into public.profiles (id, full_name, avatar_url, timezone)
  values (
    new.id,
    new_full_name,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
    new_timezone
  )
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  if not exists (
    select 1
      from public.workspace_members wm
     where wm.user_id = new.id
  ) then
    insert into public.workspaces (name, owner_id)
    values (
      case
        when new_full_name is null then 'Personal Workspace'
        else new_full_name || '''s Workspace'
      end,
      new.id
    )
    returning id into new_workspace_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner');

    insert into public.categories (workspace_id, created_by, name, color, sort_order)
    values
      (new_workspace_id, new.id, 'Work', '#2F6A55', 10),
      (new_workspace_id, new.id, 'Personal', '#E8B86D', 20),
      (new_workspace_id, new.id, 'Calls', '#6B7FA3', 30),
      (new_workspace_id, new.id, 'Errands', '#B8785B', 40)
    on conflict (workspace_id, name) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles and personal workspaces for users created before this script.
insert into public.profiles (id, full_name, avatar_url, timezone)
select
  u.id,
  nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
  nullif(btrim(coalesce(u.raw_user_meta_data ->> 'avatar_url', '')), ''),
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'timezone'), ''), 'UTC')
from auth.users u
on conflict (id) do nothing;

do $$
declare
  user_record record;
  new_workspace_id uuid;
begin
  for user_record in
    select p.id, p.full_name
      from public.profiles p
     where not exists (
       select 1
         from public.workspace_members wm
        where wm.user_id = p.id
     )
  loop
    insert into public.workspaces (name, owner_id)
    values (
      case
        when user_record.full_name is null then 'Personal Workspace'
        else user_record.full_name || '''s Workspace'
      end,
      user_record.id
    )
    returning id into new_workspace_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (new_workspace_id, user_record.id, 'owner');

    insert into public.categories (workspace_id, created_by, name, color, sort_order)
    values
      (new_workspace_id, user_record.id, 'Work', '#2F6A55', 10),
      (new_workspace_id, user_record.id, 'Personal', '#E8B86D', 20),
      (new_workspace_id, user_record.id, 'Calls', '#6B7FA3', 30),
      (new_workspace_id, user_record.id, 'Errands', '#B8785B', 40)
    on conflict (workspace_id, name) do nothing;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Authorization helper functions used by RLS
-- -----------------------------------------------------------------------------

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = target_workspace_id
       and wm.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = target_workspace_id
       and wm.user_id = (select auth.uid())
       and wm.role = any(allowed_roles)
  );
$$;

create or replace function public.is_workspace_owner(
  target_workspace_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workspaces w
     where w.id = target_workspace_id
       and w.owner_id = target_user_id
  );
$$;

create or replace function public.can_access_daily_plan(target_daily_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.daily_plans dp
      join public.workspace_members wm
        on wm.workspace_id = dp.workspace_id
     where dp.id = target_daily_plan_id
       and wm.user_id = (select auth.uid())
  );
$$;

create or replace function public.owns_daily_plan(target_daily_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.daily_plans dp
     where dp.id = target_daily_plan_id
       and dp.user_id = (select auth.uid())
       and public.is_workspace_member(dp.workspace_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.categories enable row level security;
alter table public.focus_items enable row level security;
alter table public.captures enable row level security;
alter table public.tasks enable row level security;
alter table public.daily_plans enable row level security;
alter table public.daily_plan_items enable row level security;

-- Profiles: users manage only their own profile in the MVP.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Workspaces.
drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin
on public.workspaces for update
to authenticated
using (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner
on public.workspaces for delete
to authenticated
using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- Workspace memberships.
drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert_admin on public.workspace_members;
create policy workspace_members_insert_admin
on public.workspace_members for insert
to authenticated
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists workspace_members_update_admin on public.workspace_members;
create policy workspace_members_update_admin
on public.workspace_members for update
to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists workspace_members_delete_admin_or_self on public.workspace_members;
create policy workspace_members_delete_admin_or_self
on public.workspace_members for delete
to authenticated
using (
  not public.is_workspace_owner(workspace_id, user_id)
  and (
    user_id = (select auth.uid())
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  )
);

-- Categories.
drop policy if exists categories_select_member on public.categories;
create policy categories_select_member
on public.categories for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists categories_insert_member on public.categories;
create policy categories_insert_member
on public.categories for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = (select auth.uid())
);

drop policy if exists categories_update_member on public.categories;
create policy categories_update_member
on public.categories for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists categories_delete_member on public.categories;
create policy categories_delete_member
on public.categories for delete
to authenticated
using (public.is_workspace_member(workspace_id));

-- Focus items.
drop policy if exists focus_items_select_member on public.focus_items;
create policy focus_items_select_member
on public.focus_items for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists focus_items_insert_member on public.focus_items;
create policy focus_items_insert_member
on public.focus_items for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = (select auth.uid())
);

drop policy if exists focus_items_update_member on public.focus_items;
create policy focus_items_update_member
on public.focus_items for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists focus_items_delete_member on public.focus_items;
create policy focus_items_delete_member
on public.focus_items for delete
to authenticated
using (public.is_workspace_member(workspace_id));

-- Dream Catcher captures.
drop policy if exists captures_select_member on public.captures;
create policy captures_select_member
on public.captures for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists captures_insert_member on public.captures;
create policy captures_insert_member
on public.captures for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = (select auth.uid())
);

drop policy if exists captures_update_member on public.captures;
create policy captures_update_member
on public.captures for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists captures_delete_member on public.captures;
create policy captures_delete_member
on public.captures for delete
to authenticated
using (public.is_workspace_member(workspace_id));

-- Tasks.
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
on public.tasks for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
on public.tasks for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = (select auth.uid())
);

drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
on public.tasks for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists tasks_delete_member on public.tasks;
create policy tasks_delete_member
on public.tasks for delete
to authenticated
using (public.is_workspace_member(workspace_id));

-- Daily plans: workspace members can read, but each user edits their own plan.
drop policy if exists daily_plans_select_member on public.daily_plans;
create policy daily_plans_select_member
on public.daily_plans for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists daily_plans_insert_own on public.daily_plans;
create policy daily_plans_insert_own
on public.daily_plans for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

drop policy if exists daily_plans_update_own on public.daily_plans;
create policy daily_plans_update_own
on public.daily_plans for update
to authenticated
using (
  user_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
)
with check (
  user_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

drop policy if exists daily_plans_delete_own on public.daily_plans;
create policy daily_plans_delete_own
on public.daily_plans for delete
to authenticated
using (
  user_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

-- Daily plan items inherit access from their parent plan.
drop policy if exists daily_plan_items_select_member on public.daily_plan_items;
create policy daily_plan_items_select_member
on public.daily_plan_items for select
to authenticated
using (public.can_access_daily_plan(daily_plan_id));

drop policy if exists daily_plan_items_insert_own on public.daily_plan_items;
create policy daily_plan_items_insert_own
on public.daily_plan_items for insert
to authenticated
with check (public.owns_daily_plan(daily_plan_id));

drop policy if exists daily_plan_items_update_own on public.daily_plan_items;
create policy daily_plan_items_update_own
on public.daily_plan_items for update
to authenticated
using (public.owns_daily_plan(daily_plan_id))
with check (public.owns_daily_plan(daily_plan_id));

drop policy if exists daily_plan_items_delete_own on public.daily_plan_items;
create policy daily_plan_items_delete_own
on public.daily_plan_items for delete
to authenticated
using (public.owns_daily_plan(daily_plan_id));

-- -----------------------------------------------------------------------------
-- Explicit API grants
-- -----------------------------------------------------------------------------

revoke all on table public.profiles from anon;
revoke all on table public.workspaces from anon;
revoke all on table public.workspace_members from anon;
revoke all on table public.categories from anon;
revoke all on table public.focus_items from anon;
revoke all on table public.captures from anon;
revoke all on table public.tasks from anon;
revoke all on table public.daily_plans from anon;
revoke all on table public.daily_plan_items from anon;

grant select, insert, update on table public.profiles to authenticated;
grant select, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.focus_items to authenticated;
grant select, insert, update, delete on table public.captures to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.daily_plans to authenticated;
grant select, insert, update, delete on table public.daily_plan_items to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_workspace_record_identity() from public, anon, authenticated;
revoke all on function public.protect_workspace_owner() from public, anon, authenticated;
revoke all on function public.enforce_workspace_owner_role() from public, anon, authenticated;
revoke all on function public.sync_capture_processed_at() from public, anon, authenticated;
revoke all on function public.sync_task_completed_at() from public, anon, authenticated;
revoke all on function public.protect_daily_plan_identity() from public, anon, authenticated;
revoke all on function public.validate_daily_plan_item() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke all on function public.is_workspace_owner(uuid, uuid) from public, anon;
revoke all on function public.can_access_daily_plan(uuid) from public, anon;
revoke all on function public.owns_daily_plan(uuid) from public, anon;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function public.is_workspace_owner(uuid, uuid) to authenticated;
grant execute on function public.can_access_daily_plan(uuid) to authenticated;
grant execute on function public.owns_daily_plan(uuid) to authenticated;

commit;

-- After this succeeds:
-- 1. Open Authentication -> URL Configuration in Supabase.
-- 2. Set the Site URL and permitted redirect URLs for localhost and production.
-- 3. Create a test user through the app.
-- 4. Confirm that profiles, workspaces, workspace_members, and categories are
--    created automatically for that user.
