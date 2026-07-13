---
title: Settings → Setup Hub migration (design)
date: 2026-07-13
status: design-approved
branch: feat/settings-into-setuphub
surface: frontend-only (mobile-web)
related:
  - src/clients/mobile-web/src/features/profile/ProfilePage.tsx
  - src/clients/mobile-web/src/pages/SettingsPage.tsx
  - src/clients/mobile-web/src/core/navigation/simpleRoutes.tsx
---

# Settings → Setup Hub migration — design

## Problem / context
The farmer app has **two** account-like surfaces reached from the top header:
the **Setup Hub** (avatar → route `profile`, rendered by
`features/profile/ProfilePage.tsx` → `SetupHubMenu`) and the **Settings page**
(gear → route `settings`, `pages/SettingsPage.tsx`). Settings holds a mix of
real controls, dead/placeholder controls, and engineer-only dev tools — some of
which the Setup Hub already half-hosts (its "Settings" group shows Language +
two "Coming soon" placeholders). This split is confusing and the dev tools are
wrongly visible to farmers.

## Goal
Move the **farmer-facing settings** out of the Settings page and into the Setup
Hub's existing "Settings" group, so the Hub is the single home. Keep the heavier
/ separately-owned items on the Settings page. Frontend-only; ship to prod via
the standard build-once-promote path. **Behaviour parity** for everything moved.

## Scope

### Moves into the Hub "Settings" group
| Item | Kind | Wiring |
|---|---|---|
| Language | inline | already live in the Hub — no change |
| Consent | link | Hub row → existing `consent` route |
| Export my data | link | Hub row → existing `dataRights/export` route |
| Erase my data | link | Hub row → existing `dataRights/erasure` route |
| Billing (owners only) | inline | Hub sub-screen reusing `features/admin/billing/SubscriptionCard`; owner-gated on `myFarm.role === 'PrimaryOwner'`; `onManageBilling` stays the existing placeholder alert (parity) |

### Stays on the Settings page (untouched)
- **Voice Diary** — the "Voice Journal" card + `VoiceRetainedConsentToggle`. Final placement TBD by founder later.
- **Harvest configuration** — the per-plot accordion + `HarvestConfigSheet` modal.
- **Developer Tools + Notification tester** — but now **gated behind `import.meta.env.DEV`** so farmers never see them in prod (admin work runs on `admin.shramsafal.in`).

### Dropped (not migrated)
- **App Permissions** — redundant; Android requests GPS/mic/camera natively.
- **Delete Crop Data** — the buttons have no `onClick` today (dead UI); migrating dead UI adds no value.

### Out of scope
- **Finance Settings** (`finance-settings`, under Finance Manager) — separate page, unchanged.
- Making the placeholder items real (Billing "Manage", etc.) — separate follow-ups.
- Any backend / DB / AI change.

## Design

### Mechanism
The Hub already renders a **"Settings" group** from a `settingsItems` array
(`ProfilePage.tsx:308-312`), where each row calls `onSelectExtra(id)` which sets
`activeExtra`; `activeExtra` then renders either an inline sub-screen (Language,
`:324-345`) or a "Coming soon" placeholder (`:346-356`). The migration:

1. **Rewrite `settingsItems`** → `language` (unchanged), `consent`, `export`,
   `erase`, and `billing` (owner-only). Remove the `permissions` and `voice`
   placeholder rows.
2. **Split the selection handler.** Replace the raw `onSelectExtra={setActiveExtra}`
   with a small `handleSelectExtra(id)`:
   - `consent` / `export` / `erase` → call new nav callbacks (see step 4) — these are top-level routes, not folded sub-screens.
   - `language` / `billing` → `setActiveExtra(id)` (folded sub-screens).
3. **Replace the `activeExtra` placeholder block** (`:346-356`): keep the Language
   branch; add a `billing` branch that renders `SubscriptionCard` inside the shared
   `header(...)` back-frame. Delete the "Coming soon" catch-all.
4. **Add navigation callback props** to `ProfilePage` — `onOpenConsent`,
   `onOpenExport`, `onOpenErasure` — wired in `simpleRoutes.tsx`'s
   `renderProfileRoute` to `setCurrentRoute('consent' | 'dataRights/export' | 'dataRights/erasure')`, mirroring the existing `onOpenFinanceManager` pattern.

### Back-navigation
The consent / export / erasure pages currently `onBack → 'settings'`. The plan
**must first grep every caller** of the `consent`, `dataRights/export`, and
`dataRights/erasure` routes (consent especially may also be reached from the
onboarding/DPDP flow). Then:
- If the Settings page is their **only** caller → repoint the three renderers'
  `onBack` in `simpleRoutes.tsx` to `setCurrentRoute('profile')`.
- If there are **multiple** callers (e.g. onboarding) → use origin-aware return:
  the Hub sets a `return_route` marker (sessionStorage) before navigating, and the
  page's `onBack` returns there, defaulting to `'settings'`. Do **not** hard-repoint.
(Voice Diary, ai-admin, ops-admin keep `onBack → 'settings'`.)

### Settings page after migration (`pages/SettingsPage.tsx`)
Remove the Language selector, App Permissions block, Consent / Export / Erase
cards, Delete Crop Data block, and Billing block. Keep the Voice Diary card +
consent toggle and the Harvest Config accordion + modal. Wrap the Notification
tester + Developer Tools group in `import.meta.env.DEV`. The ⚙️ gear
(`AppHeader.tsx:152 → 'settings'`) is **unchanged** — it still reaches the slim
Settings page (Voice Diary + Harvest config).

### Cleanup (dead code in the worked area)
- Delete the unreferenced duplicate `features/settings/SettingsPage.tsx`.
- Delete the unused `features/profile/components/SetupHubAccordion.tsx` and drop
  the `import type { HubSection }` from `ProfilePage.tsx` (define the small type
  locally or reuse `HubMenuItem`).

### Naming-conflict guard
No component is deleted-and-recreated; each moved control renders in exactly one
place after the change. `SubscriptionCard`, `VoiceRetainedConsentToggle`, and the
consent/export/erasure pages are **reused as-is** — only their entry point and
back-target move. This is what keeps the migration free of duplicate/conflicting
components.

## Testing
- Update `core/navigation/__tests__/AppRouter.feature-gate.test.tsx` if it asserts Settings contents.
- Add/extend a ProfilePage test: Hub "Settings" group shows language/consent/export/erase (+ billing when owner); selecting consent/export/erase fires the nav callback; selecting billing renders the sub-screen.
- Verify `import.meta.env.DEV` gate hides dev tools in a prod build.
- `npm run typecheck` + `npm run lint` (eslint `--max-warnings 0`) + `npm run test` green.

## Deployment
Frontend-only, **build-once-promote**: `npm run build:prod` → `aws s3 sync --delete`
to `s3://shramsafal-app-prod` (excluding `apk/ deploy/`, `index.html` no-cache) →
CloudFront `EFLL3RCLOOO60` invalidation `/*`. Prod-proof: app 200, new bundle hash
served, Hub Settings group renders the migrated rows, gear still opens the slim
Settings page. Add a `DEPLOYMENT_TRACKER.md` row. No migration, no backend, no wake.

## Non-goals / risks
- No DB/backend/AI change → low blast radius.
- Risk: consent/export/erase Back could strand a user if another entry point exists (e.g. onboarding consent). Mitigated by the caller-grep + origin-aware fallback in the Back-navigation section — never a blind repoint.
