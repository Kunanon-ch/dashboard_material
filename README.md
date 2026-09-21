# Forma material dashboard

A React dashboard for monthly material prices, with Excel import, indexed comparisons, CSV export, and Supabase authentication and version history.

## Run locally

Use Node.js 22.12 or later (`.nvmrc` selects Node 24):

```sh
nvm use
npm install
npm run dev
```

Open the local URL printed by Vite. On the sign-in page, **Preview with sample data** opens a development-only workspace without a database connection. In **Import**, choose the material workbook and apply it to the preview. Parsing happens locally; preview uploads are not sent to Supabase and reset when you exit or reload.

If `npm run dev` still reports an older Node version after `nvm use`, check for a `node` executable in an ancestor folder's `node_modules/.bin`. npm adds these folders to the script PATH. Start Vite with `node node_modules/vite/bin/vite.js --host 0.0.0.0` to use the Node version selected by your shell.

To test from a phone, connect the phone and computer to the same Wi-Fi or hotspot, run the development server, and open the **Network** URL printed by Vite. Do not open `localhost` or `127.0.0.1` on the phone because those addresses refer to the phone itself. macOS may ask whether Node can accept incoming connections; choose **Allow**.

The comparison supports up to four primary quotes at once. **Show all series** exposes every primary quote, and **Show all prices** expands the latest-month table. Blank observations remain missing; monthly changes compare consecutive calendar months. **Export CSV** includes all original series and months.

## Connect the live workspace

Follow [Supabase setup](supabase/README.md) to apply the migration, configure authentication, assign an administrator, and test permissions. Create a local `.env.local` using `.env.example`, and set the same public browser configuration in your hosting environment:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Restart the dev server after changing environment variables. The production build requires this configuration and sign-in; the local preview entry is only available in development.

Administrators publish complete dataset snapshots and can restore an earlier version. Other signed-in users see the active snapshot. An intervening publication requires the administrator to review the workbook again.

## Verify and build

```sh
npm test
npm run build
```

Tests cover workbook parsing and validation, calendar-based analytics, and client session/import behavior using a simulated Supabase client. They do not replace hosted authentication, permission, or Realtime checks; the live checklist is in the [Supabase guide](supabase/README.md#verify-before-launch).

`npm run preview` serves the production output locally after building. Browser-check screenshots are kept in `output/playwright/`.

See [the latest handoff](HANDOFF.md) for completed verification, local environment notes, and remaining hosted checks.
