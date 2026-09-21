# Latest handoff — 21 September 2026

## Current state

The Forma dashboard is implemented locally with React, TypeScript, Vite, SheetJS, ECharts, and Supabase. The latest interrupted work was verification of the session/import fixes and the real-workbook preview flow. That local verification is now complete.

This continuation added the missing `.env.example`, documented the local Node executable conflict, and changed the chart's value axis from `min: 'dataMin'` to `scale: true`. ECharts now chooses readable axis bounds instead of displaying a long decimal minimum that squeezed the mobile chart. Source prices and index calculations are unchanged.

The Vite development and preview servers now bind to `0.0.0.0`, so another device on the same local network can open the Network URL printed at startup. `localhost` remains valid only on the computer running Vite.

The Import workspace now has a dedicated mobile layout: the workbook preview and live version history switch from wide tables to stacked cards, the upload area is shorter, the heading is more compact, and the narrow navigation no longer creates horizontal overflow. It was checked at 320 px and 390 px widths, then rechecked at 1280 px to preserve the desktop table layout.

## Verified

- All 73 existing tests pass; TypeScript and the production build pass using Node 24.19.0.
- The supplied workbook (`/Users/beam/Downloads/รวมราคาวัสดุของแต่ละเดือน.xlsx`) imports through the browser worker: worksheet `all`, 33 months, 39 series, January 2024–September 2026.
- Preview import preserves four missing prices and reads 462 cached formula results. NGV and Pool Gas show missing observations instead of zero in the latest month.
- All 25 primary quotes are selectable and can be displayed in the latest-price table. A selected quote from the expanded list remains visible when the list is collapsed.
- CSV downloaded through the UI contains 34 rows including its header and 40 columns including Month. All 1,360 cells match the parsed workbook, including blanks and numeric precision. Results: `output/playwright/handoff-csv-verification.json`.
- Price and Index views and the 6M, 1Y, and All controls work. Mobile viewport 390 × 844 has no page-level horizontal overflow. The final axis adjustment was checked again with the real workbook after the development hot reload.
- Browser error checks returned no errors.
- The production build redirects signed-out `/import` visits to `/login`. Sign-in renders and the development-only Preview entry is absent.
- Live Supabase Auth settings respond successfully: email sign-in and signup enabled; email confirmation required.
- Anonymous reads of `dashboard_state`, `dataset_versions`, and `dashboard_admins` all return HTTP 401 / SQLSTATE `42501`. These are read-only checks; they do not prove signed-in viewer/admin permissions or Realtime delivery.

Screenshots are in `output/playwright/`, including `handoff-mobile-chart.png`, `handoff-mobile-prices.png`, and `handoff-production-login.png`. The exported workbook data in that folder is local verification material, not a production dataset publication.

## Remaining hosted work

1. Use actual administrator and viewer test sessions to complete [the hosted checklist](supabase/README.md#verify-before-launch): publish, immutable history, restore, conflict handling, signed-in permissions, and Realtime updates in a second browser. No credentials or authenticated test sessions were supplied in this continuation. No users were created, roles granted, or datasets published to Supabase.
2. Confirm migration history against the linked Supabase project before applying any migrations; the live tables already exist. Never reset the remote database to repeat a test.
3. Prepare the intended GitHub repository and Vercel deployment, configure public environment variables, Auth callback URLs, and production email delivery. No GitHub push or Vercel deployment was performed. The intended repository from the original request is `https://github.com/Kunanon-ch/dashboard_material.git`.

## Local environment notes

- `.env` now exists and successfully connects to the intended Supabase project. Keep real values out of version control; `.env.example` contains placeholders only.
- This folder is not a standalone Git checkout. Git discovers an ancestor worktree under the user's home directory. Avoid repo-wide status/add/commit operations against that ancestor; establish the intended project checkout before publishing code.
- Node 24.19.0 is installed at `/Users/beam/.nvm/versions/node/v24.19.0/bin/node`. An ancestor `/Users/beam/node_modules/.bin/node` can make npm scripts run Node 20.13.1 despite a newer shell PATH. The final checks explicitly invoked Node 24:

  ```sh
  /Users/beam/.nvm/versions/node/v24.19.0/bin/node node_modules/vitest/vitest.mjs run
  /Users/beam/.nvm/versions/node/v24.19.0/bin/node node_modules/typescript/bin/tsc -b
  /Users/beam/.nvm/versions/node/v24.19.0/bin/node node_modules/vite/bin/vite.js build
  ```

- Vite still reports the existing approximately 1.06 MB main JavaScript chunk (334 KB gzip); the build succeeds. Chunk splitting remains a possible performance improvement.
- `npm run test:e2e` exists in package.json, but no Playwright test suite/configuration is committed. Browser results above are interactive verification, separate from the 73 Vitest tests.
