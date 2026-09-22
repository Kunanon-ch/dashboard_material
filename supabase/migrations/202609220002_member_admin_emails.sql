-- Keep member and administrator directory records self-contained with email.
begin;

alter table public.dashboard_members
  add column if not exists email text;

alter table public.dashboard_admins
  add column if not exists email text;

-- Backfill existing rows from the protected Auth source.
update public.dashboard_members m
set email = u.email
from auth.users u
where m.user_id = u.id
  and (m.email is null or btrim(m.email) = '');

update public.dashboard_admins a
set email = u.email
from auth.users u
where a.user_id = u.id
  and (a.email is null or btrim(a.email) = '');

-- Extend the signup/profile trigger so email is stored and kept current.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.dashboard_members (user_id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 100),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 100)
  )
  on conflict (user_id) do update
    set email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = clock_timestamp();

  update public.dashboard_admins
  set email = new.email
  where user_id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- Owner-managed admin inserts can continue to provide only user_id; this
-- trigger fills the stored email without exposing a client write path.
create or replace function public.set_dashboard_admin_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    select u.email into new.email
    from auth.users u
    where u.id = new.user_id;
  end if;
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  return new;
end;
$$;

drop trigger if exists dashboard_admin_email on public.dashboard_admins;
create trigger dashboard_admin_email
  before insert or update of user_id, email on public.dashboard_admins
  for each row execute function public.set_dashboard_admin_email();

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
    coalesce(m.email, u.email)::text,
    coalesce(m.first_name, ''),
    coalesce(m.last_name, ''),
    u.created_at,
    exists (select 1 from public.dashboard_admins a where a.user_id = u.id)
  from auth.users u
  left join public.dashboard_members m on m.user_id = u.id
  order by lower(coalesce(nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), coalesce(m.email, u.email)::text));
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_dashboard_admin_email() from public, anon, authenticated;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

comment on column public.dashboard_members.email is 'Email copied from auth.users for the member directory.';
comment on column public.dashboard_admins.email is 'Email copied from auth.users for the administrator membership record.';

commit;
