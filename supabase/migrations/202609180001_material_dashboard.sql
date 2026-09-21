-- Material dashboard: authenticated reads, administrator-only snapshot publishing.
-- Apply as the database owner through the Supabase SQL editor or migration CLI.
begin;

create table if not exists public.dashboard_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  filename text not null check (char_length(filename) between 1 and 255),
  sheet_name text not null check (char_length(sheet_name) between 1 and 128),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  row_count integer not null check (row_count between 1 and 1200),
  series_count integer not null check (series_count between 1 and 100)
);

create index if not exists dataset_versions_created_at_idx
  on public.dataset_versions (created_at desc);

create table if not exists public.dashboard_state (
  id integer primary key default 1 check (id = 1),
  active_version_id uuid references public.dataset_versions(id) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into public.dashboard_state (id) values (1) on conflict (id) do nothing;

alter table public.dashboard_admins enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.dashboard_state enable row level security;

-- Membership is managed only by a project owner, never by user-editable metadata.
-- The definer may inspect the protected membership table; callers receive only a boolean.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.dashboard_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on public.dashboard_admins from public, anon, authenticated;
revoke all on public.dataset_versions from public, anon, authenticated;
revoke all on public.dashboard_state from public, anon, authenticated;
grant select on public.dataset_versions, public.dashboard_state to authenticated;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists dashboard_state_read on public.dashboard_state;
create policy dashboard_state_read on public.dashboard_state
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists dataset_versions_read on public.dataset_versions;
create policy dataset_versions_read on public.dataset_versions
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (select public.is_admin())
      or id = (select s.active_version_id from public.dashboard_state s where s.id = 1)
    )
  );

-- There are intentionally no INSERT/UPDATE/DELETE policies or grants for clients.
-- SECURITY DEFINER is necessary for the two narrow, explicitly authorized write paths.
create or replace function public.publish_dataset(
  p_filename text,
  p_sheet_name text,
  p_payload jsonb,
  p_expected_version uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series jsonb;
  v_row jsonb;
  v_values jsonb;
  v_value jsonb;
  v_key text;
  v_id text;
  v_month text;
  v_ids text[] := array[]::text[];
  v_months text[] := array[]::text[];
  v_series_count integer;
  v_row_count integer;
  v_numeric_count integer := 0;
  v_key_count integer;
  v_active uuid;
  v_new_version uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only an administrator can publish a dataset.';
  end if;

  if p_filename is null or char_length(btrim(p_filename)) not between 1 and 255
     or p_sheet_name is null or char_length(btrim(p_sheet_name)) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'A valid filename and worksheet name are required.';
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Dataset must be a JSON object.';
  end if;

  if pg_catalog.octet_length(p_payload::text) > 5242880 then
    raise exception using errcode = '22023', message = 'Dataset exceeds the 5 MiB publication limit.';
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'series') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_payload -> 'rows') is distinct from 'array'
     or (p_payload - array['series', 'rows']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Dataset must contain only series and rows arrays.';
  end if;

  v_series_count := pg_catalog.jsonb_array_length(p_payload -> 'series');
  v_row_count := pg_catalog.jsonb_array_length(p_payload -> 'rows');
  if v_series_count not between 1 and 100 or v_row_count not between 1 and 1200 then
    raise exception using errcode = '22023', message = 'Dataset must contain 1–100 series and 1–1,200 monthly rows.';
  end if;

  for v_series in select value from pg_catalog.jsonb_array_elements(p_payload -> 'series') loop
    if pg_catalog.jsonb_typeof(v_series) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Each series must be an object.';
    end if;

    if (v_series - array['id', 'name', 'category', 'currency', 'unit', 'sourceColumn']::text[]) <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(v_series -> 'id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_series -> 'name') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_series -> 'category') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_series -> 'currency') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_series -> 'unit') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_series -> 'sourceColumn') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Series fields must be id, name, category, currency, unit, and sourceColumn strings.';
    end if;

    v_id := v_series ->> 'id';
    if v_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' or v_id = any(v_ids) then
      raise exception using errcode = '22023', message = 'Series IDs must be unique and contain 1–80 letters, numbers, underscores, or hyphens.';
    end if;

    if char_length(btrim(v_series ->> 'name')) not between 1 and 200
       or (v_series ->> 'category') not in ('Metals', 'Polymers', 'Energy', 'Other', 'FX')
       or char_length(v_series ->> 'currency') > 16
       or char_length(v_series ->> 'unit') > 80
       or (v_series ->> 'sourceColumn') !~ '^[A-Z]{1,3}$' then
      raise exception using errcode = '22023', message = 'Series name, category, currency, unit, or Excel source column is invalid.';
    end if;

    v_ids := pg_catalog.array_append(v_ids, v_id);
  end loop;

  for v_row in select value from pg_catalog.jsonb_array_elements(p_payload -> 'rows') loop
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Each monthly row must be an object.';
    end if;

    if pg_catalog.jsonb_typeof(v_row -> 'month') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_row -> 'values') is distinct from 'object'
       or (v_row - array['month', 'values']::text[]) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'Monthly rows must contain only a month string and values object.';
    end if;

    v_month := v_row ->> 'month';
    if v_month !~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])-01$' or v_month = any(v_months) then
      raise exception using errcode = '22023', message = 'Months must be unique YYYY-MM-01 dates between 1900 and 2199.';
    end if;
    v_months := pg_catalog.array_append(v_months, v_month);

    v_values := v_row -> 'values';
    select count(*) into v_key_count from pg_catalog.jsonb_object_keys(v_values);
    if v_key_count <> v_series_count or not (v_values ?& v_ids) then
      raise exception using errcode = '22023', message = 'Every monthly row must contain exactly one value for every series ID; use null for missing prices.';
    end if;

    for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_values) loop
      if pg_catalog.jsonb_typeof(v_value) = 'number' then
        -- JSONB numeric values cannot be NaN/Infinity; bounds also reject extreme exponents.
        if abs(v_value::text::numeric) > 1000000000000 then
          raise exception using errcode = '22023', message = 'Price values must be finite numbers between -1,000,000,000,000 and 1,000,000,000,000.';
        end if;
        v_numeric_count := v_numeric_count + 1;
      elsif pg_catalog.jsonb_typeof(v_value) <> 'null' then
        raise exception using errcode = '22023', message = 'Price values must be numbers or null, never text or nested objects.';
      end if;
    end loop;
  end loop;

  if v_numeric_count = 0 then
    raise exception using errcode = '22023', message = 'Dataset must contain at least one numeric price.';
  end if;

  -- Serialize all publishes/restores. Compare null safely for the first import, too.
  select active_version_id into v_active from public.dashboard_state where id = 1 for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dashboard state is missing. Apply the database migration.';
  end if;
  if v_active is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'The active dataset changed. Refresh, review the latest version, and try again.';
  end if;

  insert into public.dataset_versions (filename, sheet_name, payload, created_by, row_count, series_count)
  values (btrim(p_filename), btrim(p_sheet_name), p_payload, auth.uid(), v_row_count, v_series_count)
  returning id into v_new_version;

  update public.dashboard_state
    set active_version_id = v_new_version, updated_at = clock_timestamp()
    where id = 1;

  return v_new_version;
end;
$$;

create or replace function public.restore_dataset(p_version_id uuid, p_expected_version uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only an administrator can restore a dataset.';
  end if;

  select active_version_id into v_active from public.dashboard_state where id = 1 for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dashboard state is missing. Apply the database migration.';
  end if;
  if v_active is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'The active dataset changed. Refresh, review the latest version, and try again.';
  end if;
  if p_version_id is null or not exists (select 1 from public.dataset_versions where id = p_version_id) then
    raise exception using errcode = 'P0002', message = 'The requested dataset version does not exist.';
  end if;

  update public.dashboard_state
    set active_version_id = p_version_id, updated_at = clock_timestamp()
    where id = 1;

  return p_version_id;
end;
$$;

revoke all on function public.publish_dataset(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.restore_dataset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_dataset(text, text, jsonb, uuid) to authenticated;
grant execute on function public.restore_dataset(uuid, uuid) to authenticated;

-- Publish only the small active-version pointer. Clients refetch the snapshot after a change.
-- Preserve other tables already configured for Realtime in this project.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dashboard_state'
  ) then
    alter publication supabase_realtime add table public.dashboard_state;
  end if;
end;
$$;

comment on table public.dataset_versions is 'Immutable published workbook snapshots. Only publish_dataset inserts; restore_dataset switches the active pointer.';
comment on table public.dashboard_admins is 'Project-owner-managed administrators. Never grant client writes or derive this role from user metadata.';
comment on table public.dashboard_state is 'Singleton active snapshot pointer; UPDATE events notify authenticated dashboard clients.';

commit;
