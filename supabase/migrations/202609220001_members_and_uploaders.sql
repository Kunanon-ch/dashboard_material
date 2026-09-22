-- Workspace members, signup names, and uploader names for published snapshots.
begin;

alter table public.dataset_versions
  add column if not exists created_by_name text;

create table if not exists public.dashboard_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 100),
  last_name text not null default '' check (char_length(last_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_members enable row level security;
revoke all on public.dashboard_members from public, anon, authenticated;

-- Store the names submitted during signup without granting browser write access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.dashboard_members (user_id, first_name, last_name)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 100),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 100)
  )
  on conflict (user_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for accounts that existed before this migration.
insert into public.dashboard_members (user_id, first_name, last_name, created_at, updated_at)
select
  u.id,
  left(btrim(coalesce(u.raw_user_meta_data ->> 'first_name', '')), 100),
  left(btrim(coalesce(u.raw_user_meta_data ->> 'last_name', '')), 100),
  u.created_at,
  clock_timestamp()
from auth.users u
on conflict (user_id) do nothing;

-- Capture a stable display name at publish time. Historical rows keep the name
-- that was current when they were published, even if the profile changes later.
create or replace function public.set_dataset_version_uploader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by_name is null or btrim(new.created_by_name) = '' then
    select nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), '')
      into new.created_by_name
    from public.dashboard_members m
    where m.user_id = new.created_by;

    if new.created_by_name is null then
      select nullif(btrim(u.email), '')
        into new.created_by_name
      from auth.users u
      where u.id = new.created_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dataset_version_uploader on public.dataset_versions;
create trigger dataset_version_uploader
  before insert on public.dataset_versions
  for each row execute function public.set_dataset_version_uploader();

-- Give older snapshots the best available display name.
update public.dataset_versions d
set created_by_name = coalesce(
  nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''),
  nullif(btrim(u.email), ''),
  'Administrator'
)
from auth.users u
left join public.dashboard_members m on m.user_id = u.id
where d.created_by = u.id
  and (d.created_by_name is null or btrim(d.created_by_name) = '');

create or replace function public.list_members()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only an administrator can view workspace members.';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(m.first_name, ''),
    coalesce(m.last_name, ''),
    u.created_at,
    exists (select 1 from public.dashboard_admins a where a.user_id = u.id)
  from auth.users u
  left join public.dashboard_members m on m.user_id = u.id
  order by lower(coalesce(nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), u.email::text));
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_dataset_version_uploader() from public, anon, authenticated;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

comment on table public.dashboard_members is 'Private member profiles populated from auth signup metadata; clients use list_members for admin-only directory access.';
comment on column public.dataset_versions.created_by_name is 'Stable uploader display name captured when the snapshot was published.';

commit;
