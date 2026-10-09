-- External health checks create real database read activity without exposing
-- material prices, snapshots, membership, or administrator credentials.
begin;

create or replace function public.dashboard_keepalive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dashboard_state where id = 1
  );
$$;

revoke all on function public.dashboard_keepalive() from public, anon, authenticated;
grant execute on function public.dashboard_keepalive() to anon, authenticated;

comment on function public.dashboard_keepalive() is
  'Read-only health check returning only whether the dashboard singleton exists. No dataset or member data is returned.';

notify pgrst, 'reload schema';
commit;
