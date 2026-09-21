# Supabase setup

Project: [`yypmahjztkhpqgolsnio`](https://supabase.com/dashboard/project/yypmahjztkhpqgolsnio).

All dashboard viewers and administrators sign in. Administrators can publish an Excel workbook as a complete replacement dataset and restore older versions. Previous snapshots remain available to administrators. A viewer can read only the current snapshot. Publishing and restoring update the active pointer atomically; another administrator's intervening change causes a conflict instead of silently replacing it.

## 1. Apply the database migration

Open the project's **SQL Editor**, paste the complete contents of [`migrations/202609180001_material_dashboard.sql`](migrations/202609180001_material_dashboard.sql), and run it as the project owner. It creates the protected tables, RPC functions, and Realtime publication entry. Re-running this migration preserves existing snapshots and the active version.

Alternatively, with the Supabase CLI installed and this directory as your project root:

```sh
supabase login
supabase link --project-ref yypmahjztkhpqgolsnio
supabase db push --dry-run
supabase db push
```

Do not run a remote database reset. Commit migration files to GitHub so production changes remain reproducible.

## 2. Configure authentication

In **Authentication → Providers**, enable email/password sign-in. Keep email confirmation enabled for public sign-ups. If access should be limited to invited colleagues, disable new user sign-ups and add or invite users from **Authentication → Users**; existing accounts can still sign in.

Under **Authentication → URL Configuration**, set the Site URL to the deployed Vercel domain and allow the app's exact callback URLs, including `http://localhost:5173` for local development. Add your chosen Vercel preview URLs if you intend to test email confirmation or recovery on previews. Configure a production email sender/SMTP provider before relying on production confirmation and recovery emails.

Administrators use the same sign-in flow as viewers. Admin access comes exclusively from the database membership table, never from signup fields or browser state.

## 3. Assign the first administrator

Create the intended user's Auth account first, then confirm that email (or confirm it in the SQL below). Replace `your-login-email@example.com` with the **exact email you use to sign in** — not the placeholder. The previous `INTO STRICT` error (`P0002`) means no confirmed `auth.users` row matched that email.

Check who exists:

```sql
select id, email, email_confirmed_at is not null as confirmed, created_at
from auth.users
order by created_at desc;
```

Then assign admin access. If the account exists but is unconfirmed, this confirms it and grants admin:

```sql
do $$
declare
  admin_email text := lower('your-login-email@example.com');
  admin_id uuid;
  confirmed_at timestamptz;
begin
  select id, email_confirmed_at
    into admin_id, confirmed_at
  from auth.users
  where lower(email) = admin_email;

  if admin_id is null then
    raise exception 'No Auth user found for %. Sign up in the app first, then run this again with that email.', admin_email;
  end if;

  if confirmed_at is null then
    update auth.users
    set email_confirmed_at = now()
    where id = admin_id;
  end if;

  insert into public.dashboard_admins (user_id)
  values (admin_id)
  on conflict (user_id) do nothing;
end;
$$;
```

Refresh the website after assigning access. Repeat only for trusted administrators. To remove admin rights while preserving the user's viewer account and uploaded snapshots:

```sql
delete from public.dashboard_admins
where user_id = (
  select id from auth.users where lower(email) = lower('admin@example.com')
);
```

Do not add a client-side self-promotion flow or policies that let users write `dashboard_admins`.

## 4. Configure the website

Set these environment variables locally and in your Vercel project's environment settings, then build/redeploy:

```dotenv
VITE_SUPABASE_URL=https://yypmahjztkhpqgolsnio.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Find the publishable key in the Supabase project's API settings. The publishable key is intended for browser use and relies on the migration's grants and row-level security. Never put a service-role key, secret API key, database password, or access token in any `VITE_` variable, frontend file, or GitHub commit.

The workbook is parsed in the browser. Only the reviewed, normalized dataset is published to the database; the original Excel file is not stored in Supabase Storage. The initial database has no snapshot. Sign in as the administrator and import the workbook to publish the first live version.

## Client contract

| Resource | Access and purpose |
| --- | --- |
| `dashboard_admins` | No browser table access. Membership is managed through the SQL Editor. |
| `dataset_versions` | Authenticated viewers read the active row; administrators read all versions. Clients cannot insert, update, or delete directly. |
| `dashboard_state` | Authenticated users read the singleton `id = 1`. Its `active_version_id` may be null before the first import. |
| `is_admin()` | Returns whether the authenticated caller is an administrator. |
| `publish_dataset(p_filename, p_sheet_name, p_payload, p_expected_version)` | Validates and inserts a new snapshot, then atomically activates it. Returns the new UUID. |
| `restore_dataset(p_version_id, p_expected_version)` | Activates an existing immutable snapshot and returns its UUID. |

Pass the `active_version_id` that the administrator reviewed as `p_expected_version`, including `null` for a first import. Treat SQLSTATE `40001` as a publish/restore conflict: refetch the current state and require a fresh review. Do not silently retry against a new active version. `42501` means administrator access is required; `22023` means payload validation failed; `P0002` means the target snapshot or singleton state is missing.

Each snapshot payload contains exactly:

```json
{
  "series": [
    {
      "id": "copper",
      "name": "Copper",
      "category": "Metals",
      "currency": "USD",
      "unit": "tonne",
      "sourceColumn": "D"
    }
  ],
  "rows": [
    { "month": "2026-01-01", "values": { "copper": 9400.5 } },
    { "month": "2026-02-01", "values": { "copper": null } }
  ]
}
```

The server enforces 1–100 unique series, 1–1,200 unique monthly dates in 1900–2199, a 5 MiB normalized payload limit, valid categories (`Metals`, `Polymers`, `Energy`, `Other`, `FX`), Excel column labels, bounded metadata, and finite numeric prices with absolute value at most `1e12`. Every row must contain every series ID; missing prices use `null`, never zero or a text placeholder. At least one numeric price must exist. Uploaded snapshots cannot be edited or removed through the browser API.

Subscribe to `UPDATE` Postgres Changes on `public.dashboard_state`, with filter `id=eq.1`, using the signed-in Supabase client. On an event, refetch the current pointer and its snapshot; check that the pointer has not changed again before accepting the result. Refresh on reconnection or tab focus as well, because a disconnected client can miss events. The large payload table is deliberately excluded from the publication. For history lists, select metadata columns rather than `payload`.

## Verify before launch

Run these checks against a development or staging Supabase project with a viewer and administrator account:

1. A signed-out client cannot read any of the three tables or execute the RPCs.
2. A signed-in viewer reads the active snapshot, cannot read older snapshot payloads, and gets `42501` when calling either mutation RPC. Direct insert, update, and delete requests fail for both viewers and administrators.
3. An administrator publishes a valid workbook. The saved counts match the preview, the previous version remains in history, and a second signed-in browser updates without reloading.
4. Missing fields, extra series keys, unknown categories, duplicate months/IDs, impossible months, text prices, oversized values, and all-null datasets cause `22023` without changing the active pointer or inserting a snapshot.
5. Two administrator windows start from the same active version. After one publishes, the second must receive `40001` and preserve the first result. Repeat for restore and for two initial uploads when the expected UUID is null.
6. Restoring an earlier version changes the viewer's dataset while retaining both snapshots. Refreshing and reconnecting still load the current version.

Useful read-only SQL checks in the SQL Editor:

```sql
select id, active_version_id, updated_at from public.dashboard_state;

select id, filename, created_at, row_count, series_count
from public.dataset_versions order by created_at desc;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('dashboard_admins', 'dataset_versions', 'dashboard_state');

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'dashboard_state';
```

SQL Editor requests run with owner privileges and do not test viewer access. Use actual signed-out, viewer, and admin sessions for permission checks. Local SQL validation cannot substitute for a hosted Realtime and Auth test.

References: [database functions and privileges](https://supabase.com/docs/guides/database/functions), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
