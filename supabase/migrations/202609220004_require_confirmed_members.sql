-- A user becomes a workspace member only after Supabase email confirmation.
begin;

-- Remove provisional profiles created by the earlier signup trigger. The Auth
-- user remains and can create its profile again after confirming the email.
delete from public.dashboard_members m
using auth.users u
where m.user_id = u.id
  and u.email_confirmed_at is null;

create or replace function public.is_confirmed_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    delete from public.dashboard_members where user_id = new.id;
    return new;
  end if;

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

  update public.dashboard_owners
  set email = new.email
  where user_id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.dashboard_owners o
    join auth.users u on u.id = o.user_id
    where o.user_id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.dashboard_admins a
      join auth.users u on u.id = a.user_id
      where a.user_id = auth.uid()
        and u.email_confirmed_at is not null
    )
    or exists (
      select 1
      from public.dashboard_owners o
      join auth.users u on u.id = o.user_id
      where o.user_id = auth.uid()
        and u.email_confirmed_at is not null
    )
  );
$$;

drop function if exists public.list_members();
create function public.list_members()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz,
  is_admin boolean,
  is_owner boolean
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
    coalesce(m.email, o.email, u.email)::text,
    coalesce(m.first_name, ''),
    coalesce(m.last_name, ''),
    u.created_at,
    (exists (select 1 from public.dashboard_admins a where a.user_id = u.id)
      or exists (select 1 from public.dashboard_owners owner_row where owner_row.user_id = u.id)),
    exists (select 1 from public.dashboard_owners owner_row where owner_row.user_id = u.id)
  from auth.users u
  left join public.dashboard_members m on m.user_id = u.id
  left join public.dashboard_owners o on o.user_id = u.id
  where u.email_confirmed_at is not null
  order by lower(coalesce(nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), coalesce(m.email, o.email, u.email)::text));
end;
$$;

create or replace function public.set_member_admin(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'Only an owner can manage administrator access.';
  end if;

  if p_user_id is null or not exists (
    select 1 from auth.users
    where id = p_user_id and email_confirmed_at is not null
  ) then
    raise exception using errcode = '22023', message = 'The member must confirm their email before receiving workspace access.';
  end if;

  if exists (select 1 from public.dashboard_owners where user_id = p_user_id) then
    raise exception using errcode = '22023', message = 'Owner access cannot be changed here.';
  end if;

  if p_is_admin then
    insert into public.dashboard_admins (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;
  else
    delete from public.dashboard_admins where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.is_owner() from public, anon, authenticated;
grant execute on function public.is_owner() to authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.is_confirmed_user() from public, anon, authenticated;
grant execute on function public.is_confirmed_user() to authenticated;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;
revoke all on function public.set_member_admin(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_member_admin(uuid, boolean) to authenticated;

drop policy if exists dashboard_state_read on public.dashboard_state;
create policy dashboard_state_read on public.dashboard_state
  for select to authenticated
  using ((select public.is_confirmed_user()));

drop policy if exists dataset_versions_read on public.dataset_versions;
create policy dataset_versions_read on public.dataset_versions
  for select to authenticated
  using (
    (select public.is_confirmed_user())
    and (
      (select public.is_admin())
      or id = (select s.active_version_id from public.dashboard_state s where s.id = 1)
    )
  );

comment on table public.dashboard_members is 'Confirmed workspace member profiles populated after Supabase email confirmation.';

commit;
