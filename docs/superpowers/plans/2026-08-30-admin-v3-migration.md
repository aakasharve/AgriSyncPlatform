# Admin Console v3 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the v3 visual design and its honesty discipline on the live admin console **without losing a single thing the console can do today**, and add what v3 brings that the console does not have. The founder's requirement, in his words: *"without loosing any functional elemnt form the old one missing but adding all new functionalitoes and features."*

**Architecture:** This is a **port, not a deploy**. The v3 prototype (`G:/VALIDATION/ADMIN_ REDESIGN/v3`) is **thirteen** static HTML files with sample data, no auth, no fetching, no router and no tenancy. It contributes **appearance, information design and state vocabulary** — nothing else. The live console (`src/clients/admin-web`, 43 tsx files) contributes **all machinery**: routing, guards, org scoping, URL state, pagination, polling, freshness, error typing. The port rebuilds v3's surface **behind the live machinery**, screen by screen, behind the existing routes — never the reverse.

The order is load-bearing: build the shared primitives first (tokens, formatters, honest-state components, the romanised search index, and **one** list component), then migrate one screen at a time. The console must be usable and shippable at the end of every task.

**Tech Stack:** React 19, TypeScript ~6.0, Vite 8, Tailwind CSS v4 (`@theme` token layer, `@custom-variant`), React Router 7, TanStack Query 5, TanStack Table 8, axios 1.15, recharts 3.8, date-fns 4, lucide-react, clsx + tailwind-merge via `cn()`, class-variance-authority. Test runner to be added in Task 1 (`vitest` + `@testing-library/react` + `jsdom`) — admin-web has **zero test files today**, verified.

**Spec:** `_COFOUNDER/specs/_active/2026-08-30-admin-v3-migration.md` — author it from this plan's header + Preservation Register before Task 1 begins. The PR body must reference that spec ID (project CLAUDE.md, Commit and PR Conventions).

**Sources of truth for this plan (all opened and verified 2026-08-30):**
- Live: `src/clients/admin-web/src/**` (every file cited below was read, not inferred)
- Prototype: `G:/VALIDATION/ADMIN_ REDESIGN/v3/` — CONTRACT.md, README.md, app.js, theme.css, data.js, **thirteen** html files — an earlier draft said twelve and omitted `wvfd.html` (27KB), which is the North Star design Task 21 must port. The v3 README contradicts itself on this count; the directory is authoritative.
- Deploy target: `_COFOUNDER/Projects/AgriSync/Operations/DEPLOYMENT_TRACKER.md:77` — Admin-web (`admin.shramsafal.in`), S3 `shramsafal-admin-prod` + CloudFront `E31NGXQN85PXV7`, *"data calls fail while API hibernated"*.

**Two corrections to the brief, before anyone builds from it:**

1. **v3 has no Releases screen.** Verified by directory listing 2026-08-30: all-farms, api-errors, farmer-health, index, live-health, login, settings, silent-churn, suffering, templates, users, voice-pipeline, **wvfd** — **thirteen**, no releases.html. (An earlier draft said twelve and omitted `wvfd.html`, which is the North Star design Task 21 must port. The v3 README contradicts itself on this count; the directory is authoritative.) README.md says v2 shipped one and v3 removed it deliberately. Do not build a Releases screen from this plan.
2. **`login.html` does not load `app.js`, but it does load `data.js`.** Verified at `login.html:91`. The palette is correctly withheld, but every farm name, owner and farmer phone is still parsed into `window.DATA` on an unauthenticated page. In the React port this cannot recur (there is no bundled sample data), but the *reason* — no PII reachable before sign-in — must survive as a rule, not just as an omission.

---

## Global Constraints

- **Nothing is lost silently.** Every capability in the Preservation Register below is either **restored** by a named task or appears in the **Deliberately Dropped** table with a reason and a founder signature. There is no third option. A capability that is neither restored nor signed off is a build failure.
- **Light mode is locked.** CONTRACT.md section 8 bans a `prefers-color-scheme` dark rule; Appendix 15 records the dark-mode toggle as a deliberate deletion. This is a **removal of a feature that works today** (`AdminShell.tsx:69-76`, `ThemeProvider.tsx:16-55`) and therefore needs the founder's tick in the Deliberately Dropped table — see **D1**. If it stays dropped, the now-inert `dark:` utilities must be **stripped from ported components**, not left dead.
- **The design system lives in one place.** One token layer (`src/styles/globals.css` `@theme`), one `cn()`, one list component, one chart shell, one formatter module, one honest-state vocabulary. The live console hand-rolls its own table markup in sixteen places and duplicates a Devanagari font check four times; **neither pattern is carried forward.**
- **No screen supplies its own filtering.** The prototype duplicates **2,775 lines** of inline filter/sort/summary script across `all-farms.html` (511), `silent-churn.html` (531), `api-errors.html` (632), `suffering.html` (552) and `users.html` (549) — measured, not estimated. That is **not** ported. One `DataList` component; each screen supplies a configuration object. Founder pre-approved.
- **Machinery beats mockup, every time.** Where the prototype and the live console disagree about behaviour, the live console wins unless this plan explicitly says otherwise. CONTRACT.md's own appendix says the same: *"The code won every time."*
- **Every screen is wired to a real hook.** No sample data ships. The hook per screen is named in its task and repeated in the Founder Acceptance Gate.
- **Every route sits behind the existing guards.** RequireAuth then RequireScope then EntitlementGuard. The prototype has no auth; that gap does not travel.
- **Honesty rules outrank layout.** CONTRACT.md section 9: unmeasured is a grey em dash captioned "not measured", never a 0; a broken feed names the time it stopped and never presents the last good number as current; an honesty state outranks any semantic colour.
- **No fabricated freshness.** A chip may only state an age it actually has. `HomePage.tsx:18-19` computing `now = new Date()` to make a "Live · 1s ago" chip over an em-dash KPI is the exact defect the redesign exists to remove.
- **Fail-closed permissions.** `canRead`/`canWrite`/`canExport` return false when scope is unresolved (`useAdminScope.ts:97-99`). That default is a security property and does not change.
- Conventional Commits. No `--no-verify`. No force-push to `main`. Branch off `main`; local feature commits need not be signed (project CLAUDE.md, founder decision 2026-08-08).
- Architecture tests must still pass: `dotnet test src/tests/AgriSync.ArchitectureTests/`. They do not cover admin-web, but the gate runs them and this plan must not break the gate.

---

## Change Surface

**DB** — **No DB changes.** No migration, no new table, no index, no RLS policy, no seed. Confirmed: this plan touches only `src/clients/admin-web/` plus one CI workflow file and one hosting-config file.

**Backend** — **No backend changes.** Every endpoint this console calls already exists and is already gated server-side by `AdminScopeHelper`. The one widened DTO the redesigned API Errors screen wants (`OpsErrorEventDto` gaining ErrorCode, WorkKept, Message, AppVersion, Meaning, UsualCause) is delivered by a **different plan** — `docs/superpowers/plans/2026-08-30-error-capture-engine.md`, **Task 8** ("Carry it to the admin API"). Task 6 of that plan widens the vocabulary and is NOT the unblocking task — waiting on the wrong one unblocks this screen two tasks early, against fields that do not exist yet. This plan consumes it; it does not build it.

**Frontend** — **Yes. This is a frontend-only plan.**

- `src/clients/admin-web/src/` — all 43 existing tsx/ts files are read; most are rewritten or deleted.
- New: `src/lib/format.ts`, `src/lib/searchKey.ts`, `src/lib/useListUrlState.ts`, `src/components/data/DataList.tsx`, `src/components/data/ChartShell.tsx`, `src/components/state/`, `src/components/ui/PersonName.tsx`, `src/hooks/useScheduleTemplates.ts`, `src/test/`.
- Deleted: `src/pages/PlaceholderPage.tsx`, `useOpsHealthWrapped` (`useOpsHealth.ts:45-57`), `src/assets/hero.png`, `src/assets/vite.svg`, `public/icons.svg`, the unedited Vite-template `README.md`.
- New dev deps: vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom.
- New committed hosting config: the SPA history-fallback rule (see Task 28) — **not in the repo today**, verified.
- New committed deploy script: `src/clients/admin-web/scripts/deploy-s3.sh` — admin-web has **no scripts directory at all** today, verified.

**Cross-cutting** — No secrets. No new env vars (`.env.local` = `http://localhost:5048`, `.env.production` = `https://api.shramsafal.in`, both unchanged). No AI prompt touched, therefore no `prompt-registry.md` bump and no golden-set delta. No SharedKernel event. **`.github/workflows/ci-gate.yml` gains an `admin-web-test` job AND that job is added to `gate`'s `needs:` list** (today line 162 reads `needs: [backend, frontend]`). This is the only wiring that makes the Preservation Register enforceable. Putting the job in `eslint.yml` does NOT work: that workflow is not required, and `DEPLOYMENT_TRACKER.md` records `admin-web-lint` going red and being merged past. A promise checked by a job nobody has to pass is not a promise. `.github/workflows/lighthouse.yml:55-95` already builds admin-web and asserts perf >= 0.7 and a11y >= 0.9 on `/farmer-health` — that budget must still pass.

---

## Preservation Register

**This table is the founder's guarantee.** **59** at-risk capabilities, 18 missing, **18** deliberately dropped. Every line is checkable. A task is not done until its register lines are ticked, and the whole register is swept in Task 30.

### A — AT RISK (exists today, invisible in a mockup, would be lost by a design-led port)

| # | Done | Capability | Lives today in | Restored by |
|---|---|---|---|---|
| A1 | [ ] | `X-Active-Org-Id` header stamped on every admin request — the whole tenant-scoping mechanism | `lib/api.ts:17-20`; `app/ActiveOrgProvider.tsx:46-52,86-91` | T2, T12 |
| A2 | [ ] | Four-outcome scope resolver (Resolved / Unauthorized / Ambiguous / NotInOrg) plus the two full-page OrgSwitcher interstitials with their distinct headline and subline pairs | `App.tsx:70-101`; `hooks/useAdminScope.ts:27,68-79`; `components/OrgSwitcher.tsx:28-91` | T2, T11, T12 |
| A3 | [ ] | EntitlementGuard on **10 of 13** in-shell routes (16 route declarations in total, counting `/login`, `/403` and the catch-all) with the exact route-to-module-key map; **36-key** ModuleKeys registry mirroring ModuleKey.cs. *(Corrected 2026-08-31 by measurement: the prose here said 9 of 12 and 33 keys; the Step 5 `ROUTE_GUARDS` map below was always right, and it is what T2 pinned.)* | `App.tsx:129-158`; `components/EntitlementGuard.tsx:29-45`; `lib/moduleKeys.ts:13-67` (69 is the exported type alias, not a key) | T2, T11 |
| A4 | [ ] | Three routes DELIBERATELY ungated — `/`, `/schedules/templates`, `/settings/admins` — and the two code comments that say why | `App.tsx:125-127,159-163` | T2, T11 |
| A5 | [ ] | In-page (not route) ops:read gate on drilldown Band 5, with the "Ops data hidden" panel; scope-still-loading treated as no-access | `features/farmer-health/FarmerHealthDrilldown.tsx:47-48,142-167` | T23 |
| A6 | [ ] | canRead / canWrite / canExport fail-closed predicates; the guard read/write/export levels kept even with no write or export call site | `hooks/useAdminScope.ts:81-99`; `components/EntitlementGuard.tsx:38-39` | T2, T11 |
| A7 | [ ] | Scope query key includes the active org — admin, me, scope, activeOrgId or none | `hooks/useAdminScope.ts:72` | T2, T12 |
| A8 | [ ] | EntitlementGuard renders null (not a redirect) while scope loads — stops a hard refresh of a guarded deep link bouncing to /403 | `components/EntitlementGuard.tsx:33` | T2, T11 |
| A9 | [ ] | RequireAuth deep-link capture via state.from, honoured by LoginPage | `App.tsx:53-60`; `pages/LoginPage.tsx:41-42` | T11 |
| A10 | [ ] | Session persistence with client-side expiry (admin.session.v1), three-state auth machine, invalidateQueries on login and removeQueries on logout | `lib/auth.ts:1-42`; `app/AdminAuthProvider.tsx:13,21-51` | T2, T11 |
| A11 | [ ] | Global 401 interceptor with redirect-loop guard | `lib/api.ts:63-69` | T2, T11 |
| A12 | [ ] | Typed 428 to AdminScopeAmbiguousError (carries memberships) and 403 to AdminModuleForbiddenError (carries moduleKey) over four backend codes | `lib/api.ts:30-53,71-83` | T2, T11 |
| A13 | [ ] | The /403 page — two message branches from router state; the ONLY sign-out control in the app; deliberately outside RequireScope | `pages/ForbiddenPage.tsx:6-41`; `App.tsx:115` | T10, T11 |
| A14 | [ ] | PII redaction-aware DTO contract (farmerName may be the literal redacted marker, phone may be masked as 98******12) and redaction-tolerant rendering | `features/farmer-health/farmer-health.types.ts:80-82,100,125`; `FarmerHealthDrilldown.tsx:52` | T5, T22, T23 |
| A15 | [ ] | `?org=<uuid>` URL parameter with UUID validation and URL, then localStorage, then null precedence | `app/ActiveOrgProvider.tsx:12-13,39-44,102-112` | T12 |
| A16 | [ ] | `?since` on API Errors — a working filter with NO UI control, reachable only by hand-editing the URL | `pages/ops/OpsErrorsPage.tsx:64,66`; `hooks/useOpsErrors.ts:17,29` | T18 |
| A17 | [ ] | `?page` URL-synced SERVER-SIDE pagination on Farms (40), Users (50), API Errors (50) with items, totalCount, page, pageSize | `FarmsListPage.tsx:11,16,98-104`; `UsersPage.tsx:9,13,74-80`; `OpsErrorsPage.tsx:58,62,166-178`; `useFarms.ts:13-25`; `useUsers.ts:10-20`; `useOpsErrors.ts:20-38` | T7, T8, T14, T17, T18 |
| A18 | [ ] | `?search` / `?tier` / `?endpoint` / `?weeks` / `?days` URL-synced filter state across five pages | `FarmsListPage.tsx:17-18,26-27`; `UsersPage.tsx:14,22`; `OpsErrorsPage.tsx:63,84-86`; `OpsVoicePage.tsx:14,29-31`; `NorthStarPage.tsx:22,34-36` | T7, T14, T17, T18, T19, T21 |
| A19 | [ ] | `?weeks` 8/12/24 on North Star and `?days` 7/14/30 on Voice Pipeline — value flows to hook arg, query key, API query string AND the interpolated card title | `NorthStarPage.tsx:56-69,153`; `OpsVoicePage.tsx:42-55,97` | T19, T21 |
| A20 | [ ] | Functional setSearchParams updater preserving unrelated params, and page reset to 1 on every filter change | `FarmsListPage.tsx:26-28`; `UsersPage.tsx:22-23`; `OpsErrorsPage.tsx:82-85` | T7 |
| A21 | [ ] | Search draft deliberately NOT URL-synced until Enter or submit (Farms, Users); API Errors endpoint input commits on blur OR Enter, trimmed, with a conditional Clear filter button | `FarmsListPage.tsx:19,41-45`; `UsersPage.tsx:15,22,36-40`; `OpsErrorsPage.tsx:103-115` | T7, T14, T17, T18 |
| A22 | [ ] | The whole `/farmer-health/:farmId` drilldown route and its nine components | `App.tsx:153-155`; `FarmerHealthDrilldown.tsx` plus DwcScoreCard, FarmerTimeline, WorkerSummaryList, SyncStateBlock, AiHealthBlock, FarmerSearchBox | T23 |
| A23 | [ ] | Per-surface polling cadences plus React Query global defaults (staleTime 60s, refetchOnWindowFocus false, retry 1) | `App.tsx:34-42`; `useOpsHealth.ts:40-41` 30s; `useOpsErrors.ts:35-36` 30s; `useFarms.ts:37` suffering 60s; `useOpsVoice.ts:24-25` 5m; `useWvfd.ts:32-33` 5m; `useCohortPatterns.ts:15` 5m | T2, T26 |
| A24 | [ ] | AdminResponse envelope; meta.source and meta.lastRefreshed driving FreshnessChip at 17 render sites over 11 screens; three source-to-label mappings; the 4-tier s/m/h/d age ramp | `lib/api.ts:89-99`; `components/ui/FreshnessChip.tsx:12-33` | T4, T5, all screen tasks |
| A25 | [ ] | keepPreviousData on paginated lists plus the Refreshing indicator that replaces the row count | `useFarms.ts:23`; `useUsers.ts:19`; `useOpsErrors.ts:37`; `FarmsListPage.tsx:56`; `UsersPage.tsx:41`; `OpsErrorsPage.tsx:117`; `FarmerHealthPage.tsx:87-89` | T8, T14, T17, T18 |
| A26 | [ ] | Farmer-health endpoints live on a DIFFERENT path prefix — `/admin/farmer-health/` vs `/shramsafal/admin/`; schedule templates hits `/shramsafal/reference-data/crop-schedule-templates` and returns a RAW array, no envelope, no meta | `features/farmer-health/api/farmerHealthApi.ts:21,32` vs `hooks/useAdminScope.ts:74`; `ScheduleTemplatesPage.tsx:17` (16 is the `queryFn` line) | T2, T24 |
| A27 | [ ] | `/shramsafal/admin/ops/health` is the ONE endpoint returning no AdminResponse envelope; it carries a server computedAtUtc that the page fetches and discards | `hooks/useOpsHealth.ts:30,33-43`; `pages/ops/OpsLivePage.tsx:9-10,21` | T2, T20 |
| A28 | [ ] | AbortSignal threading into axios (cancel on unmount) and useFarmerHealth retry 0 plus enabled-gating (the idle-but-mounted mode the search box depends on) | `useCohortPatterns.ts:13`; `useFarmerHealth.ts:14-23` | T2, T22, T23 |
| A29 | [ ] | FarmerSearchBox probe-then-navigate: 300ms debounce gating only the button, query on explicit submit, navigation to the SERVER-RESOLVED farmId, encodeURIComponent, non-blocking inline miss message, onResolved extension point | `features/farmer-health/components/FarmerSearchBox.tsx:23-56,86-90` | T22 |
| A30 | [ ] | Intervention-queue sorting: 4 columns, aria-sort, per-column default direction, default score ASC, lastActiveAt DESC tiebreak | `InterventionQueueTable.tsx:44-70,144-161` | T8, T22 |
| A31 | [ ] | Watchlist collapsed by default with a FIXED weeklyDelta-ascending sort (biggest drop first), deliberately not user-sortable, aria-expanded and aria-controls | `WatchlistTable.tsx:35-36,44-48,52-71` | T22 |
| A32 | [ ] | Accessible details data tables under every chart (5) and per-band LoadingState with aria-busy plus named sr-only labels | `ScoreDistributionChart.tsx:71`; `EngagementTierBreakdown.tsx:95` (sr-only); `PillarHeatmap.tsx:77`; `WeeklyTrendChart.tsx:91`; `FarmerTimeline.tsx:138`; `EmptyAndErrorStates.tsx:69-85` | T9, T22, T23 |
| A33 | [ ] | Zero-fill normalisation to fixed axes — FIXED_BINS (10), TIER_ORDER A to D, PILLAR_ORDER (6) — so absent data cannot reshuffle a chart | `ScoreDistributionChart.tsx:20,33`; `EngagementTierBreakdown.tsx:20,31`; `PillarHeatmap.tsx:25,48` | T9, T22 |
| A34 | [ ] | Runtime Devanagari detection switching the font per name, at FOUR call sites | `FarmerHealthDrilldown.tsx:30-36`; `InterventionQueueTable.tsx:27-33`; `WatchlistTable.tsx:17-23`; `WorkerSummaryList.tsx:20-26` | T6 |
| A35 | [ ] | Mandatory verbatim compliance copy: ScoringActiveBanner ("Scoring active from {date}; data accumulating.") and the WorkerSummaryList disclaimer plus its red-line comment | `EmptyAndErrorStates.tsx:15-37`; `WorkerSummaryList.tsx:6-17,81-83`; `FarmerHealthPage.tsx:38-42,71-73` | T5, T22, T23 |
| A36 | [ ] | Understated-vs-normal empty copy on the intervention queue — two different truths, selected by a flag | `InterventionQueueTable.tsx:72-81` | T5, T22 |
| A37 | [ ] | C7 colour rule (a healthy pillar tops out at teal, success is never bright green) and C8 slate inset border marking privileged ops panels | `DwcScoreCard.tsx:28-145`; `AiHealthBlock.tsx:16-32`; `SyncStateBlock.tsx:33` | T3, T23 |
| A38 | [ ] | AiHealth rate sanitisation — null, NaN or undefined becomes an em dash; clamp 0..1; never a fabricated 0% | `AiHealthBlock.tsx:16-32` | T4, T23 |
| A39 | [ ] | Active org name shown in the Farmer Health subtitle — the ONLY place in the console that names the current tenant | `FarmerHealthPage.tsx:31-33,55-57` | T10, T12 |
| A40 | [ ] | Drilldown four-branch state handling with Band 1 (back link, name, farm id, bucket badge) rendered before and through every branch; "Farm not found in your scope." as a distinct empty state | `FarmerHealthDrilldown.tsx:50-54,114-130` | T23 |
| A41 | [ ] | ErrorState with a working Retry wired to refetch(), plus the formatError unwrapping ladder | `EmptyAndErrorStates.tsx:95-131`; `FarmerHealthPage.tsx:66-68` | T5 |
| A42 | [ ] | Route-level code splitting — all 12 pages React.lazy behind one Suspense (keeps the recharts-heavy Farmer Health chunk out of the initial payload) | `App.tsx:15-32,44-48,112` | T11 |
| A43 | [ ] | Catch-all route navigating to `/` with replace (there is no 404 page) | `App.tsx:165` | T27 |
| A44 | [ ] | Deep-link refresh depends on a server-side SPA history fallback that is NOT in this repo — no _redirects, vercel.json, netlify.toml or nginx conf anywhere in admin-web | `vite.config.ts:1-21` (absence verified) | T28 |
| A45 | [ ] | Provider nesting order is load-bearing: Theme, QueryClient, BrowserRouter, ActiveOrg, AdminAuth; plus the fail-fast throws in useAdminAuth, useActiveOrg and useTheme | `App.tsx:105-109` (104 is `return (`, 110 is `<WheatWindShader />`); `AdminAuthProvider.tsx:59-63`; `ActiveOrgProvider.tsx:75-79`; `ThemeProvider.tsx:68-72` | T2, T11 |
| A46 | [ ] | Command-palette placement outside RequireAuth with no entitlement filtering — both facts are decisions the port must make consciously | `App.tsx:111`; `app/CommandPalette.tsx:7-19` | T13 |
| A47 | [ ] | Tailwind v4 @theme token layer and the custom dark variant bound to the data-mode attribute — every dark utility resolves through that attribute, not Tailwind class strategy and not prefers-color-scheme | `styles/globals.css:4,10-44,47-69` | T3 |
| A48 | [ ] | cn() twMerge helper and the CVA-based Button, Card and KpiCard primitives — cn() is what lets a className override actually beat a base Tailwind class | `lib/utils.ts:4-6`; `components/ui/Button.tsx`, `Card.tsx`, `KpiCard.tsx` | T3 |
| A49 | [ ] | Build and tooling config: the @ alias declared in BOTH vite.config and tsconfig; port 4001 strictPort; tsc -b then vite build; ESLint rules deliberately demoted to warn with max-warnings 9999 so admin-web participates in the gate without a shell OR-true | `vite.config.ts:8-20`; `eslint.config.js:8-41`; package.json scripts | T28 |
| A50 | [ ] | tanstack react-table used on exactly one page, with manualPagination and server-driven pageCount | package.json; `pages/ops/OpsErrorsPage.tsx:58,73-79` | T8, T18 |
| A51 | [ ] | Per-row recency columns with DELIBERATELY different date-fns format strings across screens (API Errors shows the full date, Ops Live shows time only); date-fns imported independently in 14 files with no shared formatter | `FarmsListPage.tsx:90-91`; `OpsErrorsPage.tsx:21`; `OpsLivePage.tsx:109,167`; `UsersPage.tsx:66-67` | T4 |
| A52 | [ ] | Ops Live SECOND Farmer Suffering Watchlist panel — different endpoint, different shape (farmId only, no farm name), different window from /farms/suffering | `pages/ops/OpsLivePage.tsx:129-174` | T20 |
| A53 | [ ] | Nav badge slot rendering a red count pill — fully styled, currently unpopulated, renders nothing today | `app/AdminShell.tsx:28,116-120` | T10 |
| A54 | [ ] | Axios `timeout: 20_000` and the `BASE_URL` fallback `'http://localhost:5001'` — the fallback also contradicts `.env.local` (`5048`), so a build with no env silently points at a dead port | `lib/api.ts:5,9` | T11 |
| A55 | [ ] | North Star chart's FIXED y-domain `[0,7]` with explicit ticks including 4.5, plus a `ReferenceLine y={4.5}` for the goal — the same anti-rescaling honesty property A33 registers for the farmer-health charts. A floating axis would let a bad week be redrawn to look normal | `pages/metrics/NorthStarPage.tsx:178-190` | T21 |
| A56 | [ ] | `main.tsx` `StrictMode` double-invokes effects in dev — load-bearing because `FarmerSearchBox` navigates from INSIDE an effect, which the port must reproduce rather than "clean up" | `main.tsx`; `FarmerSearchBox.tsx:41-48` | T22 |
| A57 | [ ] | The two rule-definition subtitles — "Paid farms with WVFD = 0 for 2+ consecutive weeks. Act before renewal." and the Suffering equivalent. The ONLY place either list's definition is stated on screen | `SilentChurnPage.tsx:20`; `SufferingPage.tsx:20` | T15, T16 |
| A58 | [ ] | `AdminShell` breadcrumb via `humanizePath`, and `NavLink end={n.to === '/'}` so Home is not marked active on every route | `app/AdminShell.tsx:56,137-144` | T10 |
| A59 | [ ] | `tsconfig.app.json` strictness — `types: ["vite/client"]`, `include: ["src"]`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`. `npm run build` runs `tsc -b` over `src`, so any test using bare `it()`/`expect()` without an import fails type-check unless `vitest/globals` is added to `types` | `tsconfig.app.json`; Task 1 Step 2 | T1 |
### B — MISSING (v3 has no equivalent; the port must supply it)

| # | Done | Capability | Supplied by |
|---|---|---|---|
| B1 | [ ] | A /403 Forbidden screen — where every guard denial, every Unauthorized outcome and every scope-query error lands. v3 has none. | T11 |
| B2 | [ ] | Real login. The v3 submit handler is literally a redirect to index.html — no POST to /user/auth/login, no token storage, no server error surfaced, no "Signing in" state. | T11 |
| B3 | [ ] | Any sign-out control anywhere. Live has exactly one (on /403); v3 has none. | T10, T11 |
| B4 | [ ] | Server-side pagination UI on Farms (40/page), Users (50/page), API Errors (50/page): prev/next, Page N of M, bounds disabling, pager hidden when there is one page. v3 renders 16/19/14 rows at once and has no pager. | T8, T14, T17, T18 |
| B5 | [ ] | The weeks 8/12/24 selector on North Star and the days 7/14/30 selector on Voice Pipeline. v3 hardcodes 12 weeks and 14 days in data.js. | T19, T21 |
| B6 | [ ] | The whole `/farmer-health/:farmId` drilldown and its nine components. v3 collapses everything into one flat farmer-health.html with no per-farmer route. BIGGEST SINGLE FEATURE LOSS in the design. | T23 |
| B7 | [ ] | FarmerSearchBox (farmId / userId / phone lookup). v3 has no farmer search. | T22 |
| B8 | [ ] | Score-distribution histogram and engagement-tier donut as rendered charts. DATA.farmerHealth carries scoreDistribution and engagementTiers but no v3 screen renders them. | T22 |
| B9 | [ ] | The tier A/B/C/D engagement-tier filter on All Farms. v3 facets are crop, village, plan and land-record; tier is a column only. | T14 |
| B10 | [ ] | Ops Live Farmer Suffering Watchlist panel (farmId, total errors, sync, logs, voice, last error). v3 live-health.html puts a service-health table in that slot. | T20 |
| B11 | [ ] | The org switcher as a UI surface. Live has two full-page variants; the topbar switcher its own copy promises (App.tsx:84) does not exist. | T12 |
| B12 | [ ] | Loading skeletons sized to each table real shape (8 rows by 7 cells on Farms, etc.). v3 has no loading state because it has no fetch. | T5, T8 |
| B13 | [ ] | Refreshing background-fetch indicators on Farms, Users, API Errors and Farmer Health. | T8 |
| B14 | [ ] | A manual refresh affordance — needed once real fetching returns; v3 has no slot for it. | T10 |
| B15 | [ ] | Everything write-shaped the redesign will need a home for: export/CSV, copy-to-clipboard, retry-a-failed-call, mark-error-resolved, add/remove admin, publish/unpublish a template, record-an-outreach-call, row actions, toasts, confirmations. | T10 (slots only — see note) |
| B16 | [ ] | PII redaction and masking of phone numbers. v3 prints full phone numbers on Home, All Farms, Silent Churn, Users and in the palette index. | T5, T6, T13 |
| B17 | [ ] | i18n for console chrome. All v3 chrome is English; only its sample data is Marathi. | Deferred — see note |
| B18 | [ ] | Tests of any kind. admin-web has ZERO test files today (verified) and v3 has none, so the port has no safety net proving equivalence. | T1, T2, T30 |

> **B15 note:** this plan builds the SLOTS (a row-action column in DataList, a toast host in the shell, a canWrite/canExport-gated Button variant) and ships ZERO write endpoints. Every write surface is a separate plan with its own spec. Building affordances that call nothing would re-ship the exact lie v3 exists to remove.
>
> **B17 note:** i18n is not in scope and is not dropped. The console users are the founder and FPO staff; the Marathi requirement is on FARMER names (A34), which is preserved. Recorded here so it is a decision, not an oversight.

### C — DELIBERATELY DROPPED (each needs the founder's tick)

> **Signed 2026-08-31.** The founder answered the three that remove things which **work today**:
> **D1 dark mode — drop. D3 the wheat shader — drop. D4 the shortcut badges — remove.** His words:
> *"drop , drop remove"*. Those three carry `FOUNDER 2026-08-31`.
>
> The other fifteen are marked `doctrine-settled`, **not** founder-signed, and the distinction is
> deliberate. Every one of them is either dead code with zero callers, or a statement the console
> makes that is not true — a fabricated freshness age, a coverage claim wider than the code, a zero
> printed where there is no reading, a row-click to a route that does not exist. Doctrine `P4` (no
> fabricated numbers) already settles those; asking would be asking permission to stop lying.
> **Any of the fifteen can be pulled back by saying so** — the Task 30 sweep reads this column.

| # | Capability | Reason | Founder OK |
|---|---|---|---|
| D1 | Dark-mode toggle, the authored dark token set, and the persisted admin.theme.v1 preference with a prefers-color-scheme default | CONTRACT.md section 8 and Appendix 15: light mode is locked; a toggle that cannot toggle is worse than none. THIS IS A WORKING USER-FACING FEATURE BEING REMOVED (`AdminShell.tsx:69-76`, `ThemeProvider.tsx:16-55`). If dropped, the now-inert dark utilities are stripped from every ported component, not left dead. | [x] FOUNDER 2026-08-31 |
| D2 | The dusk colour theme axis (ColorTheme fresh or dusk) | A complete second palette honoured by CSS and the shader, but setTheme has ZERO callers — reachable only by hand-editing localStorage. Dead capability. Drop without ceremony. | [x] doctrine-settled |
| D3 | WheatWindShader — the full-viewport animated WebGL wheat-field background on every route | v3 replaces the visual identity entirely (CONTRACT.md section 8 bans glassmorphism, translucency and gradients). Dropping it also removes a GPU cost, a mousemove listener and a silent-failure path — but it is the console signature surface (`App.tsx:110`, `WheatWindShader.tsx`, 175 lines). Explicit decision, not an omission. | [x] FOUNDER 2026-08-31 |
| D4 | The Cmd-1 / Cmd-2 / Cmd-F sidebar shortcut badges | Verified: the only global key handler in the codebase binds Cmd-K and Escape (`CommandPalette.tsx:39-49`). The three badges (`AdminShell.tsx:35,36,40,111-115`) advertise behaviour that does not exist. Carrying them forward re-ships a lie. Either drop the badges or implement the handlers — T13 asks the founder which. | [x] FOUNDER 2026-08-31 |
| D5 | HomePage fabricated freshness timestamps (now = new Date(), lastNightly = now minus 14h) | `HomePage.tsx:18-19,25,63,107,137` computes ages client-side so the chips always read "Live 1s ago" and "Nightly 14h ago" over KPI cards that are themselves em dashes. Do not port the lie. | [x] doctrine-settled |
| D6 | HomePage "Phase 2 wires this to /admin/ops/health", "Wired in Phase 2" and "Chart renders in Phase 3" placeholder copy | Scaffolding text shipped to production operators (`HomePage.tsx:110,124,141`). v3 replaces the whole Home screen with computed content plus honest non-values. | [x] doctrine-settled |
| D7 | Ops Live error banner copy "Backend unreachable. Start the .NET API on port 5001." | A dev-machine instruction rendered to a production operator at admin.shramsafal.in (`OpsLivePage.tsx:24-28`). Replaced by the v3 feed-down block, which names when the feed stopped and never shows the last good number as current. | [x] doctrine-settled |
| D8 | HomePage "all R1-R10 clear" claim | Factually wrong — `OpsLivePage.tsx:32-42` only ever evaluates R9 and R10. The v3 grey "R1-R8 NOT CHECKED" row is a bug fix hiding inside the redesign. Carry the fix, drop the claim. | [x] doctrine-settled |
| D9 | Silent-failure empty states on seven screens ("No errors found. The system is healthy.", "No farms with repeated errors — great!", "No users found", "No farms found", "No farms in silent churn", "No activity yet", "No schedule templates found.") | Verified: isError appears in exactly three files repo-wide (`App.tsx`, `FarmerSearchBox.tsx`, `useAdminScope.ts`). Every other screen renders a 500, a timeout or a 403 as good news. Replaced by the v3 four-way distinction — applied to EVERY screen, not just the ones v3 drew. | [x] doctrine-settled |
| D10 | useOpsHealthWrapped — a dead duplicate hook on the same endpoint with a divergent query key | `useOpsHealth.ts:45-57`, ZERO callers (verified). Wiring it alongside useOpsHealth would poll /admin/ops/health twice every 30 seconds on a 2-vCPU box. Delete. | [x] doctrine-settled |
| D11 | The Farms row-click affordance to /farms/:farmId | `FarmsListPage.tsx:77` navigates to a route that is not registered, so every click falls through the catch-all and silently bounces to Home — while the whole table is styled cursor-pointer. The v3 expandable-row detail is a credible replacement. Do not port the silent bounce. | [x] doctrine-settled |
| D12 | The hardcoded AK avatar | initialsOf(null, null) is called with literal nulls (`AdminShell.tsx:77-79`) so every user sees AK, and useAdminAuth() is called on line 53 with its result discarded. The console never shows who is signed in. T10 wires it properly. | [x] doctrine-settled |
| D13 | Schedule Templates permanent "Nightly recent" chip with no timestamp | A FreshnessChip with source materialized and no lastRefreshed (`ScheduleTemplatesPage.tsx:29`) claims a freshness it cannot prove, over an endpoint that returns no envelope at all. Forbidden by CONTRACT.md section 9.1. | [x] doctrine-settled |
| D18 | Fabricated zeros on the two ops screens — `avgLatency = 0` returned when there is no data, and `?? 0`, `?? 0%`, `?? 0ms` rendered for null voice fields | Same defect class as D5, four more sites the earlier draft did not catalogue. A zero and "we have no reading" are different facts; printing the first when you mean the second is the exact thing this redesign exists to stop. Verified: `OpsVoicePage.tsx:25-27`, `OpsLivePage.tsx:49,55,62,69` | [x] doctrine-settled |
| D14 | PlaceholderPage and the unreferenced assets (public/icons.svg, src/assets/hero.png, src/assets/vite.svg) plus the unedited Vite-template README | Zero importers and zero references (verified by grep). Dead scaffolding — drop, and do not mistake PlaceholderPage for a missing route. | [x] doctrine-settled |
| D15 | decodeJwt-based client-side authorization | Already deliberately out of the auth path (`lib/auth.ts:10-23`, the comment says debugging only; the W0-B pivot made the server authoritative via /admin/me/scope). Keep it out — reintroducing client-side claim checks would reverse an architectural decision. | [x] doctrine-settled |
| D16 | ActiveOrgProvider.clear() and the NotInOrg copy claiming "The previous selection has been cleared" | clear() is declared and never called (`ActiveOrgProvider.tsx:21,65`), so the sentence at `App.tsx:95` is false — the bad org id stays in localStorage AND in the URL. T12 calls clear() on NotInOrg, which makes the sentence true; the false-claim version is what is dropped. | [x] doctrine-settled |
| D17 | OrgSwitcher window.location.reload() Continue button | `OrgSwitcher.tsx:77`. **Corrected 2026-08-30 — the earlier reason gave the current code too much credit.** Every data query key does omit the org (verified across all 11 hooks), but the Continue button only renders when `fullPage && activeOrgId`, and after `choose()` the resolver flips to Resolved and the switcher unmounts — so the reload is largely unreachable. **Stale cross-tenant rows are therefore a live risk today, not a prevented one.** T12 putting the org in every data key is a fix, not merely a tidy-up; keeping the reload would mask a regression in it. | [x] doctrine-settled |

---

## Dependency on the error-capture plan

`docs/superpowers/plans/2026-08-30-error-capture-engine.md` widens `OpsErrorEventDto` (its **Task 8**, not Task 6 — Task 6 widens the vocabulary) with ErrorCode, WorkKept, Message, AppVersion, Meaning and UsualCause.

**Blocked on it:**

- **Task 18, Steps 5 to 7 only** — the API Errors expandable-row detail (what the server actually said), the errorCode and Meaning columns, the workKept verdict, and the "Where the errors landed" roll-up cause column.

**Not blocked on it — build these now:**

- Tasks 1 to 17 and 19 to 30 in full.
- **Task 18, Steps 1 to 4** — the API Errors screen ported onto DataList with today's six fields (occurredAtUtc, eventType, endpoint, statusCode, latencyMs, farmId), plus `?page`, `?endpoint`, `?since`, server pagination and honest empty states. It ships and is useful with the current DTO; the new fields are additive columns behind a null check.
- Task 20 (Live Health) — its recent-errors table reads the same DTO and gains the same fields for free once they land, but it is not blocked either.

**Rule:** if the error-capture plan has not deployed when Task 18 is reached, build Steps 1 to 4, mark Steps 5 to 7 as BLOCKED, and continue to Task 19. Do NOT stub the fields with placeholder text — an absent field renders as an honest non-value through the same component every other absence uses.

---

## The hook behind every screen

No screen ships sample data. This table is repeated in the Founder Acceptance Gate as a checkable list.

| Route | Screen | Hook(s) | Endpoint | Envelope? |
|---|---|---|---|---|
| `/` | Home | useOpsHealth, useWvfd(12), useFarmsList(1,1) for totalCount, useSilentChurn, useSuffering | several | mixed — /ops/health is UNWRAPPED |
| `/ops/live` | Live Health | useOpsHealth | `/shramsafal/admin/ops/health` | NO ENVELOPE (A27) |
| `/ops/errors` | API Errors | useOpsErrors with page, pageSize, endpoint, since | `/shramsafal/admin/ops/errors` | yes |
| `/ops/voice` | Voice Pipeline | useOpsVoice(days) | `/shramsafal/admin/ops/voice?days=` | yes |
| `/metrics/nsm` | North Star WVFD | useWvfd(weeks) | `/shramsafal/admin/metrics/wvfd?weeks=` | yes |
| `/farms` | All Farms | useFarmsList(page, 40, search, tier) | `/shramsafal/admin/farms` | yes |
| `/farms/silent-churn` | Silent Churn Watchlist | useSilentChurn() | `/shramsafal/admin/farms/silent-churn` | yes |
| `/farms/suffering` | Farmer Suffering Watchlist | useSuffering() | `/shramsafal/admin/farms/suffering` | yes |
| `/farmer-health` | Farmer Health | useCohortPatterns() | `/admin/farmer-health/cohort` | yes — DIFFERENT PREFIX (A26) |
| `/farmer-health/:farmId` | Drilldown | useFarmerHealth(farmId) | `/admin/farmer-health/{farmId}` | yes — DIFFERENT PREFIX (A26) |
| `/schedules/templates` | Schedule Templates | useScheduleTemplates() — NEW, extracted from the inline useQuery | `/shramsafal/reference-data/crop-schedule-templates` | NO ENVELOPE, raw array (A26) |
| `/users` | Users | useUsersList(page, 50, search) | `/shramsafal/admin/users` | yes |
| `/settings/admins` | Admin Users | NONE — there is no endpoint | — | — |

> **Settings has no data source.** `SettingsAdminsPage.tsx:4-6` hardcodes a SEEDED_ADMINS array inside the component. v3 handles this honestly: it states that the allow-list has one entry, that ssf.admin_users has never been read because its migration has not been run, and that access is all-or-nothing. **Task 25 must not invent an endpoint and must not keep a hardcoded row presented as data.**

---

## Tasks

### Task 1: Give the port a safety net — add a test runner

**Files:**
- Modify: `src/clients/admin-web/package.json`
- Create: `src/clients/admin-web/vitest.config.ts`
- Create: `src/clients/admin-web/src/test/setup.ts`
- Create: `src/clients/admin-web/src/test/renderWithProviders.tsx`

**Interfaces:**
- Produces: `renderWithProviders(ui, options)` — the harness every later test uses. It must mount the EXACT provider order from `App.tsx:105-109`, because that order is itself a preserved capability (A45).

**Why first:** admin-web has zero test files. A rewrite of 43 files with no test is a rewrite with no evidence. The Preservation Register is a promise; Tasks 1 and 2 are what make it enforceable.

- [x] **Step 1: Install the runner**

```bash
cd "src/clients/admin-web"
# vitest 4, NOT 3. vitest@3 depends on vite ^5||^6||^7; this project is on vite ^8.0.9,
# and mobile-web already runs vitest ^4.1.9 on a modern vite. Installing ^3 pulls a
# second, incompatible vite alongside the real one on the first command of the first task.
npm i -D vitest@^4 @vitest/coverage-v8@^4 jsdom@^26 \
  @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [x] **Step 2: Configure it, reusing the @ alias (A49 — the alias must now exist in three places)**

```ts
// vitest.config.ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [x] **Step 3: Build the provider harness in the load-bearing order**

```tsx
// src/test/renderWithProviders.tsx
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ActiveOrgProvider } from '@/app/ActiveOrgProvider';
import { AdminAuthProvider } from '@/app/AdminAuthProvider';

export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

/**
 * Mirrors App.tsx:104-110 exactly. ActiveOrg MUST wrap AdminAuth: the scope
 * query key depends on the active org and login() invalidates it (A45).
 */
export function renderWithProviders(
  ui: ReactNode,
  { route = '/', queryClient = makeTestQueryClient() } = {},
) {
  return {
    queryClient,
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[route]}>
            <ActiveOrgProvider>
              <AdminAuthProvider>{ui}</AdminAuthProvider>
            </ActiveOrgProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  };
}
```

- [x] **Step 4: Add the scripts** — `"test": "vitest run"` and `"test:watch": "vitest"`.

- [x] **Step 5: Prove it runs.** Run: `npm run test`. Expected: exit code 0 ("no test files found" is acceptable at this step only).

- [x] **Step 6: Commit**

```bash
git add src/clients/admin-web/package.json src/clients/admin-web/package-lock.json \
        src/clients/admin-web/vitest.config.ts src/clients/admin-web/src/test/
git commit -m "test(admin-web): add vitest + RTL harness with the load-bearing provider order"
```

---

### Task 2: Lock the invisible machinery before touching it

**Files:**
- Create: `src/clients/admin-web/src/lib/__tests__/api.contract.test.ts`
- Create: `src/clients/admin-web/src/lib/__tests__/auth.contract.test.ts`
- Create: `src/clients/admin-web/src/hooks/__tests__/useAdminScope.contract.test.tsx`
- Create: `src/clients/admin-web/src/components/__tests__/EntitlementGuard.contract.test.tsx`
- Create: `src/clients/admin-web/src/__tests__/routes.contract.test.ts`
- Create: `src/clients/admin-web/src/hooks/__tests__/queryContracts.contract.test.tsx` — **added during execution.** The five files listed above covered no row for A23, A26, A27 or A28, which Step 6 asserts. A45 folded into `routes.contract.test.ts`, since it is App.tsx's structure like A3 and A4.
- Create: `src/clients/admin-web/src/test/stubAdapter.ts` — **added during execution.** Shared by four of the six test files. Swaps the **axios adapter**, not the module: mocking `adminApi.get` would bypass both interceptors and characterise nothing, while replacing only the transport leaves the real request and response chains running.

**Interfaces:**
- Covers register rows A1, A3, A4, A6, A7, A8, A10, A11, A12, A23, A26, A27, A28, A45.
- Produces characterisation tests. These describe CURRENT behaviour, not desired behaviour. They must be written and green BEFORE any rewrite, so that a later red is a real regression.

**Why:** these are the capabilities that have no pixels. A screenshot diff will never catch them. This is the single most important task in the plan.

- [x] **Step 1: Lock the request contract (A1, A11, A12)**

```ts
import { describe, it, expect } from 'vitest';
import { adminApi, AdminScopeAmbiguousError, AdminModuleForbiddenError } from '@/lib/api';

describe('adminApi request contract', () => {
  it('stamps the org header under its exact name', async () => {
    // The header name X-Active-Org-Id is coupled to the backend CORS
    // allowlist and to AdminScopeHelper's read. Renaming it silently
    // breaks every request in the console.
  });

  it('maps 428 admin_active_org_required to a typed error carrying memberships', async () => {
    const rejected = (adminApi.interceptors.response as any).handlers[0].rejected;
    const err = await rejected({
      response: { status: 428, data: { code: 'admin_active_org_required', memberships: [{ orgId: 'o1' }] } },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminScopeAmbiguousError);
    expect((err as AdminScopeAmbiguousError).memberships).toHaveLength(1);
  });

  it.each([
    'admin_module_forbidden', 'admin_platform_only', 'admin_not_in_org', 'admin_no_membership',
  ])('maps 403 %s to a typed error carrying the module key', async (code) => {
    const rejected = (adminApi.interceptors.response as any).handlers[0].rejected;
    const err = await rejected({
      response: { status: 403, data: { code, moduleKey: 'ops.live' } },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminModuleForbiddenError);
    expect((err as AdminModuleForbiddenError).moduleKey).toBe('ops.live');
  });

  it('clears the session on 401 and does not redirect when already on /login', () => {
    // Guards the infinite-reload failure mode at lib/api.ts:65.
  });
});
```

- [x] **Step 2: Lock the session machine (A10)**

Assert: a stored session whose expiresAtUtc is in the past reads as null WITHOUT a network round trip (`lib/auth.ts:30`); AdminAuthProvider starts in loading and only then resolves to anonymous or authenticated (this three-state machine is what prevents a login-page flash on refresh); login() calls invalidateQueries on the scope key and logout() calls removeQueries — NOT the other way round, so the next user in the same tab cannot inherit the previous user's grants.

- [x] **Step 3: Lock the scope contract (A6, A7)**

```tsx
it('includes the active org in the scope query key', () => {
  // admin / me / scope / activeOrgId. Omitting the org serves one org's
  // permissions to another. No visual review can catch this.
});

it.each(['canRead', 'canWrite', 'canExport'] as const)(
  '%s returns false when the scope is unresolved', (fn) => { /* fail-closed */ },
);
```

- [x] **Step 4: Lock the guard loading semantics (A8)**

```tsx
it('renders nothing (not a redirect) while the scope query is loading', () => {
  // EntitlementGuard.tsx:33. A redirect here bounces every legitimate user
  // to /403 on a hard refresh of a guarded deep link.
});
it('does not substitute a spinner', () => {
  // The drilldown Band-5 gate depends on loading == no access, so that
  // server-redacted nulls are never rendered as data.
});
```

- [x] **Step 5: Lock the route-to-guard map (A3, A4)**

```ts
export const ROUTE_GUARDS: Record<string, string | null> = {
  '/':                      null,   // deliberate — KPI cards 403 independently
  '/ops/live':              'ops.live',
  '/ops/errors':            'ops.errors',
  '/ops/voice':             'ops.voice',
  '/metrics/nsm':           'metrics.nsm',
  '/farms':                 'farms.list',
  '/farms/silent-churn':    'farms.silent-churn',
  '/farms/suffering':       'farms.suffering',
  '/farmer-health':         'farmer.health',
  '/farmer-health/:farmId': 'farmer.health',
  '/users':                 'admin.users',
  '/schedules/templates':   null,   // deliberate — no ModuleKey exists yet
  '/settings/admins':       null,   // deliberate — no ModuleKey exists yet
};

it('every route keeps its module key, and the three ungated routes stay ungated', () => {
  // Adding a guard to Home, Templates or Settings is a behavioural
  // regression that locks every user out — not a consistency cleanup.
});
```

- [x] **Step 6: Lock the cadence table, the RQ defaults and the two endpoint oddities (A23, A26, A27)**

Assert the exact numbers as data: ops/health 30000, ops/errors 30000, farms/suffering 60000, ops/voice 300000, metrics/wvfd 300000, farmer-health/cohort 300000; global staleTime 60000, refetchOnWindowFocus false, retry 1 — **and the two per-hook overrides this line originally omitted: `useOpsHealth` and `useOpsErrors` each set `staleTime` to 25000**. Pin both layers; pinning only the global would let a hook's override drift unnoticed. Assert farmerHealthApi uses the `/admin/farmer-health/` prefix while every other admin call uses `/shramsafal/admin/`, and that useOpsHealth types its response UNWRAPPED.

- [x] **Step 7: Run and confirm green against the CURRENT code.** Run: `npm run test`. Expected: PASS. If any test fails now, the test is wrong — fix the test, not the console. These describe what exists.

- [x] **Step 8: Wire the tests into the REQUIRED gate — not the optional one**

> **Executed 2026-08-31 (`3bd961b5`, `3d5b6b0e`) — and this step as written was INCOMPLETE.**
> Adding the job and adding it to `needs:` is **not sufficient**. The `gate` job carries
> `if: always()`, so it runs even when a dependency failed and `needs:` does not decide its
> outcome — its own shell script does, and that script named only `backend` and `frontend`.
> Followed literally, a red `admin-web-test` would have made `gate` wait for it, look at two
> greens, and report success. 118 tests red, merged past: the same decorative-gate failure this
> step exists to prevent, arriving through a different door. **Every job in `needs` must also be
> named in the gate's condition**, and an invariant comment now says so above that line.
>
> Two further corrections: `admin-web-lint` lives in `eslint.yml:94`, not in `ci-gate.yml`, so
> this is a cross-file mirror of its *shape*, not a sibling job. And the mirrored tolerant
> `npm install` was **replaced with `npm ci`** — a required gate must be deterministic, and the
> Windows-lockfile drift that justified the tolerant install was repaired in Task 1
> (`npm ci --dry-run` exits 0, measured).
>
> Chain verified end to end: `ci-gate.yml` has no path filter → `needs` includes the job → the
> gate's condition names it → branch protection requires `gate` with `enforce_admins: true`.
> Not yet observed in a real GitHub run, because nothing is pushed.

Add an `admin-web-test` job to **`.github/workflows/ci-gate.yml`** (mirroring the existing
`admin-web-lint` job's tolerant npm install and cache-dependency-path), then add it to the `gate`
job's `needs:` list:

```yaml
  gate:
    name: gate
    needs: [backend, frontend, admin-web-test]
```

**Do not put this in `eslint.yml`.** That workflow is not a required check, and
`DEPLOYMENT_TRACKER.md` records `admin-web-lint` red and merged past with founder approval. Tasks 1
and 2 exist to make the Preservation Register enforceable; wired to a non-required job they enforce
nothing, and the whole guarantee is decorative.

- [x] **Step 9: Commit**

```bash
git commit -m "test(admin-web): characterise the invisible machinery before the v3 port"
```

---

### Task 3: One token layer — port the v3 design system, light mode locked

> **🛑 SEQUENCING — do not delete the old classes yet.** `.glass`, `.glass-panel`, `.glass-kpi`,
> `.glass-sidebar`, `.chip-fresh`, `.chip-live`, `.chip-mat` and `.nav-active` (`globals.css:101-228`)
> are referenced across roughly **twenty files that are not migrated until Tasks 14–26**. ADD the
> new token layer alongside them; do not remove the old ones here. They are deleted in **Task 27**,
> after the last consumer has moved and the build is verified clean.

**Files:**
- Modify: `src/clients/admin-web/src/styles/globals.css`
- Modify: `src/clients/admin-web/index.html`
- Modify or delete: `src/clients/admin-web/src/app/ThemeProvider.tsx` (see D1)
- Modify: `src/clients/admin-web/src/components/ui/Button.tsx`, `Card.tsx`, `KpiCard.tsx`

**Interfaces:**
- Consumes v3 `theme.css` (252 class rules) and CONTRACT.md section 7.7 (colour), section 8 (banned), section 10 (quality floor).
- Produces the token set every later task styles against. **No component may introduce a raw hex value from here on.**

- [x] **Step 1: Replace the @theme block with the v3 tokens.** Map the v3 custom properties onto Tailwind v4 @theme names so utilities generate: blue 4F46E5 (interactive and neutral-informational), green 0F8A5F (positive), red E11D48 (needs a person, or a failure), amber B45309 (stale or warning), text-3 8A9990 (EVERY honesty state), plus the vivid fills for bar fills and dots only — never for text — and the tint backgrounds. Keep radius-card and radius-kpi.

- [x] **Step 2: Encode the two product colour constraints as named tokens, with their IDs in a comment (A37)**

```css
@theme {
  /* C7 — success never reaches bright green. A healthy pillar tops out at
     teal by product decision, so a "good" reading can never be mistaken for
     a celebration. Do not raise this value. */
  --color-pillar-good: #0e7d7b;
  /* C8 — privileged ops panels carry a slate inset border so an admin can
     tell ops data from the core farmer profile at a glance. */
  --color-ops-inset: rgba(100, 116, 139, 0.55);
}
```

Then replace the ad-hoc hex literals at `DwcScoreCard.tsx:28-145`, `AiHealthBlock.tsx:27-32` and `SyncStateBlock.tsx:33` with these tokens.

> **Executed 2026-08-31 (`793c16f4`). Step 3's "if dropped" branch was DANGEROUS as written.**
> It says to *"delete the custom-variant dark declaration"* and separately to strip the `dark:`
> utilities. **Deleting that line first makes the leftover utilities LIVE, not inert.** Tailwind v4's
> built-in `dark` variant is `@media (prefers-color-scheme: dark)`; the old file rebound `dark` to
> `[data-mode='dark']`, an attribute nothing ever set, which is what made them dead. Remove the
> rebinding and the survivors fall back to the built-in media query — measured in the compiled
> stylesheet mid-task, producing exactly the `prefers-color-scheme` rule `CONTRACT.md` §8 bans, and
> repainting the console for any admin on a dark-themed laptop. **Both halves must land together.**
> Six `dark:` utilities survived in four farmer-health components and `PlaceholderPage.tsx`; all
> stripped. Built CSS now contains zero `prefers-color-scheme` rules and zero `dark:` classes.
>
> Step 2's file list said **three** files carry the ad-hoc hexes. There are **four** —
> `FarmerHealthDrilldown.tsx:41` holds a second copy of the C7 teal and `:150` a second copy of the
> C8 inset. A constraint living in two places with its reason attached to only one is precisely what
> the named token exists to prevent. `AiHealthBlock.tsx` and `SyncStateBlock.tsx` each had a second
> literal the plan also missed (`:46` and `:61`). All tokenised, with a test that fails if any
> literal reappears anywhere in `src`.
>
> `app.js:360-363` is off by three — the override is at `app.js:363`. `globals.css:101-228` starts
> right but the block runs to **241**.

- [x] **Step 3: Lock light mode.** Set index.html to lang en with data-mode light, and delete data-theme fresh. Delete the dusk rules (D2). For the dark palette do whichever the founder ticked in D1:
  - **If dropped:** delete the dark-mode block, delete the custom-variant dark declaration, delete ThemeProvider.tsx, remove the toggle from the shell, and STRIP every dark utility from every ported component. Leaving them inert is how a dead capability comes back as a bug.
  - **If kept:** keep the custom-variant dark declaration bound to the data-mode attribute VERBATIM (A47). It is bound to the attribute, not to the Tailwind class strategy and not to prefers-color-scheme; adopting the v3 stylesheet wholesale without it silently neutralises every dark utility in the code being carried over.

- [x] **Step 4: Rebuild the primitives on cn() (A48).** Keep `lib/utils.ts` exactly as it is. Rebuild Button, Card and KpiCard with CVA variants resolving to the new tokens. Do NOT ship the v3 hand-written as-star classes alongside Tailwind utilities — two parallel styling systems is the failure this task exists to prevent. Map each as-star concept onto the token layer instead.

  KpiCard gains the v3 honesty behaviour: a state prop, and when state is not ok the tone is FORCED to grey regardless of the caller's tone — the v3 one-line "honesty wins" override (`app.js:360-363`).

- [x] **Step 5: Add the quality-floor rules from CONTRACT.md section 10.** prefers-reduced-motion kills all animation and scroll-behaviour; a print media block hides chrome with break-inside avoid on panels; focus is 2px indigo at 2px offset everywhere and outlines are never removed; breakpoints at 1280 / 1279 / 1023 with the sidebar collapsing to a horizontal strip below 1024.

- [x] **Step 6: Remove the desktop-only viewport lock.** `index.html:6` declares a fixed 1280 viewport, which makes the console desktop-only by construction. v3 is responsive to 1023 and below. Change to width=device-width, initial-scale=1.

- [x] **Step 7: Verify nothing regressed.** Run: `npm run build && npm run test && npm run lint`. Expected: all three exit 0. The console still renders old screens on new tokens — visually different, functionally identical.

- [x] **Step 8: Commit** — `feat(admin-web): one token layer from v3, light mode locked`

---

### Task 4: One formatter module — the thing that does not exist today

> **Executed 2026-08-31 (`168f4874`), plus the standalone bug fix `319c8aba`. Four plan errors.**
>
> 1. **`rate01` does not exist in the repo.** Step 2 says "lifted verbatim from
>    `AiHealthBlock.tsx:16-32`". There is no function by that name anywhere in `admin-web`; the
>    sanitisation lives *inside* `pct()`, which also builds a label and picks a tone. The cited range
>    also overshoots — `pct` is 16–25 and 27–32 is `TONE_COLOR`, a colour map unrelated to rates.
>    The three sanitisation lines were extracted exactly; `pct()` left alone.
> 2. **Step 4's "move `fmtAge` unchanged" contradicts this task's own central rule.** The original
>    returns `''` for a missing input, not `null`, and renders **`"NaNd ago"`** for an unparseable
>    one — a fabricated freshness age, the D5 class. Deviated on both, and **fixed the live chip in
>    its own commit** (`319c8aba`) rather than folding a behavioural fix into a mechanical task.
> 3. **Three of the eleven date citations are off by one:** `OpsLivePage.tsx:109 → 108`,
>    `OpsLivePage.tsx:167 → 166`, `WorkerSummaryList.tsx:28 → 29`. Wrong in `b69e6fa7`, the commit
>    that added this plan — plan error, not drift. All eleven format **strings** are correct.
> 4. **`fmt.ratePct` added beyond the plan, and it closes a real trap.** Without it the natural call
>    is `fmt.pct(rate01(x) * 100)` — and in JavaScript `null * 100` is **`0`**, resurrecting the
>    exact fabricated zero this module exists to prevent.
>
> **Confirmed as stated:** A51's "14 files import date-fns with no shared module" — measured, exactly 14.
>
> **`DATE_FORMATS` covers 11 of the 22 `format(...)` call sites.** The other eleven are recharts
> axis/tooltip formats this table never mentioned — `FarmerTimeline:90`, `SyncStateBlock:17`,
> `WatchlistTable:26`, `WeeklyTrendChart:33,58`, `NorthStarPage:174,201`, `OpsVoicePage:114,135,172,189`.
> Not added; they belong to **Tasks 19, 21 and 22**. Recorded here so they are not lost.
>
> **DECIDED 2026-08-31 — an out-of-range rate must render "not measured", not a clamped 0% / 100%.**
> `rate01` today pulls an impossible value (`-0.2`, `1.4`) to the nearest bound, so a broken server
> reading prints **"0%"** — which reads as *the AI failed every single time*. That is a fabricated
> number, which `P4` forbids; a value outside the definition of the measure is not a noisy edge, it
> is an unbelievable reading. **Task 23 makes this change** when it ports the AI-health panel: one
> line plus one test, and the existing clamp test changes in the same commit. Preserved as-is until
> then because changing it now would alter a live screen from outside any task.
>
> **Not ported, deliberately:** v3's `AS.fmt.duration` has **zero callers** across all thirteen
> prototype HTML files — v3 renders latency as `withUnit(latencyMs,'ms')`, so `fmt.ms` follows that.
> `dec` is subsumed by `num(v, decimals)`. `unit`/`withUnit` emit HTML strings; that is a component's
> job in React.
>
> **No call site was re-pointed.** All 14 date-fns files still hold their own literals; `AiHealthBlock`
> still has its own `pct()`. Tasks 14–26 move them screen by screen. The `DATE_FORMATS` test passes
> if the literal is still inline **or** the file now imports `@/lib/format`, so it goes red only on
> genuine drift.

**Files:**
- Create: `src/clients/admin-web/src/lib/format.ts`
- Create: `src/clients/admin-web/src/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces fmt.num, fmt.pct, fmt.ms, fmt.money, fmt.acres, fmt.date, fmt.dateTime, fmt.time, fmt.age, rate01, and the per-surface format constants. Every one returns null for a null input.
- Consumes date-fns, currently imported independently in 14 files with no shared module (A51).

- [x] **Step 1: Port the v3 AS.fmt contract — null in, null out**

```ts
/**
 * Every formatter returns null for a missing input. This is the rule that
 * stops a missing measurement falling through and landing as a zero.
 * Callers render a null through <NotMeasured/>, never as text.
 * Ported from v3 app.js AS.fmt (lines 164-215).
 */
export const fmt = {
  /** Indian grouping, fixed decimals so columns align under tabular-nums. */
  num(v: number | null | undefined, decimals = 0): string | null {
    if (v == null || Number.isNaN(v)) return null;
    return v.toLocaleString('en-IN', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
  },
};
```

- [x] **Step 2: Carry the AiHealth sanitisation rule into the module (A38)**

```ts
/**
 * A rate that is null, NaN or out of range is NOT a zero. Clamped to 0..1,
 * and a missing rate returns null so the caller renders an em dash.
 * Lifted verbatim from AiHealthBlock.tsx:16-32 so the honesty rule stops
 * being a formatter detail buried inside one component.
 */
export function rate01(v: number | null | undefined): number | null {
  if (v === undefined || v === null || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(1, v));
}
```

- [x] **Step 3: Encode the per-surface date choices explicitly — they are deliberate, not drift (A51)**

```ts
/**
 * These differ ON PURPOSE. API Errors shows the full date because an
 * operator reading it may be looking days back; Ops Live shows time only
 * because its whole window is the last two hours.
 */
export const DATE_FORMATS = {
  opsErrorsRow:   'yyyy-MM-dd HH:mm:ss', // OpsErrorsPage.tsx:21
  opsLiveRow:     'HH:mm:ss',            // OpsLivePage.tsx:108
  opsLiveLastErr: 'HH:mm',               // OpsLivePage.tsx:166
  farmsLastLog:   'dd MMM',              // FarmsListPage.tsx:90
  farmsCreated:   'dd MMM yy',           // FarmsListPage.tsx:91
  usersCreated:   'dd MMM yy',           // UsersPage.tsx:66
  usersLastLogin: 'dd MMM yy, HH:mm',    // UsersPage.tsx:67
  churnLastLog:   'dd MMM yyyy',         // SilentChurnPage.tsx:41
  sufferLastErr:  'HH:mm, dd MMM',       // SufferingPage.tsx:42
  cohortRow:      'dd MMM, HH:mm',       // InterventionQueueTable.tsx:37
  workerSince:    'dd MMM yyyy',         // WorkerSummaryList.tsx:29
} as const;
```

- [x] **Step 4: Port the 4-tier freshness age ramp (A24).** Move fmtAge out of `FreshnessChip.tsx:12-19` into format.ts unchanged: under 60s gives seconds, under 1h gives minutes, under 24h gives hours, otherwise days.

- [x] **Step 5: Test every null path**

```ts
it.each([null, undefined, NaN])('returns null for %s so nothing renders a fabricated zero', (v) => {
  expect(fmt.num(v as number)).toBeNull();
  expect(rate01(v as number)).toBeNull();
});
it('groups Indian-style', () => expect(fmt.num(2477000)).toBe('24,77,000'));
```

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and was originally enforced
almost nowhere. An invariant nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 6: Run and commit** — `feat(admin-web): one formatter module, null in / null out`

---

### Task 5: The honest-state vocabulary — four causes, not one

> **Executed 2026-08-31 (`e0fb322e`). The shim line above was INCOMPLETE and is now corrected.**
> It listed three names; `FarmerHealthPage.tsx:14` also imports **`ScoringActiveBanner`** from that
> path. Following it literally would have broken the build **in the same commit whose whole purpose
> is to protect the build.** The shim re-exports four names. Ten importers confirmed by measurement
> at `faecb7db` — the plan was right about the count.
>
> **Redaction turned out to be a FIFTH kind of absence, and it does not belong in the four.** The
> four causes answer *"why is there no measurement"*. A hidden farmer name is a **fully-measured
> value you are not permitted to see** — a permission fact, not a measurement fact. The four words
> stay intact; masking got its own axis (`redaction.ts`, `Masked.tsx`).
>
> Also worth recording: **the prototype could only teach three of the four causes.** v3 does no
> fetching, so *"the request broke"* has no design in it at all — and that is precisely the cause the
> seven silent-failure screens are actually hitting.
>
> **Citation drift (a fourth and fifth instance):** `FarmerHealthDrilldown.tsx:52` is **:55**.
> `app.js:341-350` is `AS.none` at **341–348**, and the `STATE_WORD` map it depends on is at
> **333–338** — outside the cited range, so the plan cited the function without the vocabulary that
> gives it its words. Both ported.
>
> **Task 5's text never mentions `KpiCard`**, but `KpiCard.tsx:19-38` (Task 3) declared the same four
> state words locally with an explicit note to lift them here. Done — one word list, not two.
>
> **D9 is NOT closed by this task.** This builds the vocabulary; it does not apply it. The seven
> screens still say *"No errors found. The system is healthy."* until Tasks 14–26 rewire them.

> **🛑 SEQUENCING — read before moving any file.** `features/farmer-health/components/EmptyAndErrorStates.tsx`
> has **ten importers**, and its consumers are not migrated until Tasks 22–23 — seventeen tasks
> later. Moving `EmptyState` / `LoadingState` / `ErrorState` out of it without a shim leaves the
> build **red from Task 5 until Task 23**, which breaks this plan's "shippable at every task"
> invariant outright.
>
> **Do this instead:** create the new module, and leave the old file in place as a thin re-export
> (`export { EmptyState, LoadingState, ErrorState, ScoringActiveBanner } from '<new path>'`). Delete the old file in
> **Task 27**, once its last importer is migrated — and only after `npm run build` is clean.

**Files:**
- Create: `src/clients/admin-web/src/components/state/` — NotMeasured, MeasuredZero, NoMatch, FeedDown, LoadFailed, LoadingState, ErrorState, EmptyState, ScoringActiveBanner, Masked, plus an index barrel
- Delete after migration: `src/clients/admin-web/src/features/farmer-health/components/EmptyAndErrorStates.tsx`

**Interfaces:**
- Consumes CONTRACT.md sections 6.1 to 6.4 and section 9, plus the existing EmptyAndErrorStates.tsx, which is the only place in the console that already does this properly.
- Produces the vocabulary every panel on every screen uses. NotMeasured is the ONLY component allowed to print a missing value — the v3 AS.none rule (`app.js:341-350`).

- [x] **Step 1: Promote the three good primitives out of the feature folder (A41, A32).** Move EmptyState, LoadingState and ErrorState into components/state, KEEPING: the LoadingState role status plus aria-busy plus named aria-label plus sr-only label, so a screen-reader user is told WHICH block is loading; and the ErrorState working Retry wired to refetch() with its formatError unwrapping ladder (error, then string, then Error.message, then an object with a message, then a fallback).

- [x] **Step 2: Build the four distinct empty causes (D9)**

```tsx
/**
 * Four causes, not one. Today seven screens render a 500, a timeout or a
 * 403 as good news ("No errors found. The system is healthy."). isError is
 * referenced in exactly three files repo-wide. This component set is what
 * makes that impossible to repeat.
 */
export function MeasuredZero({ what, checkedAt }: { what: string; checkedAt: string }) {
  // "No errors in the last 2 hours. The window was checked at 11:41.
  //  This is a measured zero, not a missing feed."
}
export function NoMatch({ filterInWords, onClear }: { filterInWords: string; onClear: () => void }) {
  // Nothing matched the filter. Distinct from a measured zero.
}
export function FeedDown({ since, lastGood }: { since: string; lastGood?: string }) {
  // MUST name the time the feed stopped, and MUST NOT present the last good
  // number as current: "The last figure it produced was 41 logs at 06:11 —
  // that is history, not today's count."
}
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // The request failed. Always retryable.
}
```

- [x] **Step 3: Carry the mandatory copy byte-for-byte, with its red-line comments (A35).** ScoringActiveBanner keeps its exact string — "Scoring active from {date}; data accumulating." — and its role status with aria-live polite. Carry the source comment "MANDATORY copy per C5 — do not paraphrase" into the new file. The WorkerSummaryList disclaimer and its red-line comment travel with that component in T23.

- [x] **Step 4: Keep the two-variant empty on the intervention queue (A36)**

```tsx
/**
 * Two different truths, and a design that supplies one empty state per table
 * collapses them into a celebration.
 *   understated (cohort is empty) -> "No farms in intervention bucket yet."
 *                                    with no hint
 *   normal      (cohort has rows) -> "No farms in intervention bucket."
 *                                    plus "All scored farms are above the
 *                                    40-pt intervention threshold."
 */
```

- [x] **Step 5: Make a masked value a first-class state, not text (A14, B16)**

```tsx
/**
 * The server redacts per role: farmerName may arrive as the redacted marker,
 * phone as 98******12. A layout built from v3 full-PII sample data breaks on
 * a masked value. Treat masking as a state so every surface renders it the
 * same way — and so a title falls back to the farmId when the name is
 * redacted (FarmerHealthDrilldown.tsx:52).
 */
export const REDACTED = '**redacted**';
export function isRedacted(v: string | null | undefined): boolean { return v === REDACTED; }
export function Masked({ value, fallback }: { value: string | null; fallback?: string }) { /* … */ }
```

- [x] **Step 6: Test the honesty rules**

```tsx
it('never renders a zero for an unmeasured value', () => { /* em dash plus caption */ });
it('a feed-down block names when the feed stopped', () => { /* … */ });
it('a feed-down block never presents last-good as current', () => { /* … */ });
it('a measured zero says so in words', () => { /* … */ });
it('the scoring banner copy is byte-identical', () => {
  expect(screen.getByRole('status')).toHaveTextContent('Scoring active from first deploy; data accumulating.');
});
```

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and was originally enforced
almost nowhere. An invariant nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 7: Run and commit** — `feat(admin-web): four honest states, one vocabulary, mandatory copy preserved`

---

### Task 6: One name renderer — romanised search plus Devanagari font, in one place

> **Executed 2026-08-31 (`7d493804`, plus a follow-up closing the spelling gaps).**
>
> **Step 3 was already done and the plan's claim about it was false.** It asserts *"index.html
> currently loads Inter and JetBrains Mono only."* Untrue since Task 3: it loads DM Sans + Noto Sans
> Devanagari + JetBrains Mono, and Inter is gone. The step needed **evidence, not an edit** — and the
> evidence mattered: with the Devanagari face deleted from `index.html`, **20 of 23 tests still
> passed**, including every test asserting the component requests the right font family. A component
> asking for a face is not evidence the face exists. Three tests now assert the `<link>` and its
> weights, read from disk with a length guard.
>
> **`fallback = '—'` in the Step 2 sketch was wrong** against Task 5's `Masked` as shipped. It would
> have collapsed two different facts into one character: a name that is **absent** and a name you are
> **not permitted to see**. The first is a data problem to chase; the second is not. Default removed.
>
> **The Files list is incomplete** — Step 4 contains two `render(...)` assertions, which cannot live
> in a `.ts` file. `src/components/ui/__tests__/PersonName.test.tsx` added.
>
> **Citation drift (sixth instance):** `app.js:35-101` is **33–101**; line 35 lands mid-sentence in
> the section comment. The four call-site citations were the **first six-for-six correct** set on this
> branch.
>
> **DECIDED 2026-08-31 — index more spellings, not fewer.** Execution surfaced three gaps and the
> same principle settles all three: *the cost of a wrong extra result is far lower than the cost of a
> missing one.* (a) The prototype keeps the word-final inherent 'a', so a two-word search
> `gaikwad patil` misses — an extra spelling drops it. (b) **कुलकर्णी was unfindable by its ordinary
> English spelling** — one of the most common surnames in Maharashtra, so not an edge case. (c) **ज्ञ
> is indexed as both `dny` and `gy`** — Marathi reads *Dnyaneshwar*, the same character in Hindi reads
> *gyan*, and people type both; ञ, ङ, ऑ/ॉ and the dotted letters added in the same pass.
> **This was the coordinator's call, not the founder's** — he speaks Marathi and may want `dny` alone.
>
> **`PersonName` has ZERO call sites on purpose**, and the four duplicated font checks are untouched.
> They die with their screens in Tasks 22–23. `searchKey` has no consumers until Tasks 8 and 13.

**Files:**
- Create: `src/clients/admin-web/src/lib/searchKey.ts`
- Create: `src/clients/admin-web/src/components/ui/PersonName.tsx`
- Create: `src/clients/admin-web/src/lib/__tests__/searchKey.test.ts`

**Interfaces:**
- Consumes v3 `app.js:33-101` (AS.roman at 57, AS.searchKey at 87).
- Produces searchKey(s) and PersonName — used by the DataList search, the command palette index, and everywhere a person's name is rendered.

**Why:** this is the prototype's single most valuable non-visual addition, and it also kills a live duplication. The Devanagari font check is copy-pasted at FOUR call sites today (A34).

- [x] **Step 1: Port the transliterator**

```ts
/**
 * Romanises Devanagari so a Marathi surname is findable by typing it the way
 * a person would say it. Ported from v3 app.js AS.roman / AS.searchKey.
 *
 * Anusvara assimilates to the following consonant's place of articulation,
 * so the Marathi surname Kamble romanises with an m, not an n.
 */
export function roman(s: string, dropInherent: boolean): string { /* … */ }

/** Every spelling a person might type for one Devanagari string — seven of them. */
export function searchKey(s: string | null | undefined): string {
  if (!s || !/[ऀ-ॿ]/.test(s)) return '';
  const full = roman(s, false);
  const tight = roman(s, true);
  const w = tight.replace(/v/g, 'w');            // va is written both v and w
  return [
    full, tight,
    full.replace(/v/g, 'w'), w,
    w.replace(/ay/g, 'ai'),                      // gaykwad -> gaikwad
    tight.replace(/ay/g, 'ai'),
    tight.replace(/m([pbm])/g, 'n$1'),           // kamble / kanble both findable
  ].join(' ');
}
```

- [x] **Step 2: Collapse four duplicates into one component (A34)**

```tsx
/**
 * Replaces the identical HAS_DEVANAGARI / fontFor pair duplicated at
 * FarmerHealthDrilldown.tsx:30-36, InterventionQueueTable.tsx:27-33,
 * WatchlistTable.tsx:17-23 and WorkerSummaryList.tsx:20-26.
 *
 * The project font rule is hard (CLAUDE.md, Font Rules): Marathi body text
 * is Noto Sans Devanagari. An English-language mockup shows Latin names
 * only, so dropping this regex is invisible in review and wrong in prod.
 */
const HAS_DEVANAGARI = /[ऀ-ॿ]/;

export function PersonName({ name, fallback = '—', className }: PersonNameProps) {
  if (isRedacted(name)) return <Masked value={name} fallback={fallback} />;
  const text = name?.trim() || fallback;
  return (
    <span className={className} style={{
      fontFamily: HAS_DEVANAGARI.test(text)
        ? "'Noto Sans Devanagari', sans-serif"
        : "'DM Sans', sans-serif",
    }}>{text}</span>
  );
}
```

- [x] **Step 3: Load the Devanagari face.** index.html currently loads Inter and JetBrains Mono only. CONTRACT.md section 8 bans monospace anywhere; v3 uses IBM Plex Sans and IBM Plex Sans Devanagari. Whatever the chrome face becomes, Noto Sans Devanagari MUST be loaded or PersonName silently falls back to a Latin face.

- [x] **Step 4: Test the seven spellings**

```ts
it.each([
  ['भोसले',  'bhosale'],
  ['गायकवाड', 'gaikwad'],
  ['कांबळे',  'kamble'],
  ['वाघ',    'wagh'],
])('%s is findable by typing %s', (deva, typed) => {
  expect(searchKey(deva)).toContain(typed);
});
it('renders a Devanagari name in the Devanagari face', () => { /* … */ });
it('renders a redacted name through Masked, never as the literal marker', () => { /* … */ });
```

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 5: Commit** — `feat(admin-web): romanised Devanagari search plus one PersonName renderer`

---

### Task 7: One URL-state hook — the easiest thing to get wrong in a rewrite

> **Executed 2026-08-31 (`263a8f4c`). Three things this task discovered that outrank its own text.**
>
> **1. 🛑 The functional updater CANNOT preserve a param the router never saw — so this task does not
> close the org hole on its own.** `ActiveOrgProvider.syncUrl` writes `?org=` with a raw
> `window.history.replaceState` (`ActiveOrgProvider.tsx:102-108`), behind React Router's back. In
> `react-router@7.15.1`, `setSearchParams` builds its `prev` from the router's `location.search`, so
> after an OrgSwitcher selection **the router is one org behind the address bar**, and the next filter
> write — even a perfectly correct functional one — strips `org` back out of the shareable URL.
> **Task 12 Step 2 is what actually closes this.** Written into the hook's header so nobody reads that
> file and concludes the hole is shut.
>
> **2. `setMany` is not ergonomics — it is the only correct way to write two keys.** `setSearchParams`
> is a `useCallback` closing over the current render's `searchParams`, so **two `set()` calls in one
> handler both build from the same pre-first-call snapshot and the second silently clobbers the
> first.** The plan named `setMany` without saying why; the reason is measured and now cited in the
> file.
>
> **3. Step 4 overstates v3's poverty, and the nuance belongs to Task 13.** v3 reads exactly one
> param, `?q`, and the Ctrl+K palette *generates* those links (`app.js:726,729`). It is a one-way
> contract — the palette writes a link, the page seeds its box once (`app.js:705-707`), and nothing
> typed afterwards reaches the URL. `if (A.param('q')) opened = true;` is the prototype's **own**
> summary-first open flag. The core claim (no writes, no history API — grepped, zero hits) stands.
> **Task 13 has a deep-link shape to port, not to invent.**
>
> **Citation drift (seventh):** `OpsErrorsPage.tsx:82-85` is **81-86** — the cited range covers the
> inner lines of two different functions and excludes both signatures.
>
> **DECIDED 2026-08-31, all three of execution's questions:**
> - **Sort key, direction and the open flag DO go in the URL.** A link becomes reproducible and Back
>   undoes a sort. Nothing that works today stops working. This is what every serious admin console
>   does, and sort currently dies on every refresh.
> - **Trim on all three search screens** (Task 14). Today API Errors trims and Farms/Users do not, so
>   pasting a name with a trailing space into Farms returns "no results" for a farm that exists. A
>   leading space is never a thing a person meant to search for.
> - **The stale search box is fixed in Tasks 14/17/18, not here.** After Back or Clear the filter
>   really clears but the box still shows the old text — the console stating something untrue about
>   its own state, which is the defect class this redesign exists to remove. The naive fix steals
>   focus on every Enter, so it belongs with the screens, not in a shared hook.

**Files:**
- Create: `src/clients/admin-web/src/lib/useListUrlState.ts`
- Create: `src/clients/admin-web/src/lib/__tests__/useListUrlState.test.tsx`

**Interfaces:**
- Produces useListUrlState with params, set, setMany, reset, draft and commitDraft.
- Consumes useSearchParams from React Router 7.

**Why:** all six URL-writing pages today use the FUNCTIONAL updater form so that page, search, tier and org coexist (A20). The failure mode of getting this wrong — a filter change silently clearing the org — is invisible until someone reports wrong data.

- [x] **Step 1: Make the functional updater the only way to write**

```ts
/**
 * ALWAYS the functional form. Passing a plain object REPLACES the whole
 * query string and would silently drop the org param, which is how a filter
 * change turns into a cross-tenant data bug that no visual review can catch.
 * See FarmsListPage.tsx:26-28, UsersPage.tsx:22-23, OpsErrorsPage.tsx:81-86.
 */
function set(key: string, value: string | null, opts?: { resetPage?: boolean }) {
  setSearchParams((prev) => {
    if (value == null || value === '') prev.delete(key); else prev.set(key, value);
    if (opts?.resetPage !== false && key !== 'page') prev.set('page', '1');
    return prev;
  });
}
```

- [x] **Step 2: Keep the reset-page-to-1 rule (A20).** Every filter change resets page to 1. Without it a user filters to 3 results, stays on page 5, and sees nothing.

- [x] **Step 3: Support both commit contracts (A21).** Two DELIBERATE, OPPOSITE interaction contracts that look identical in a screenshot:
  - **Draft plus explicit commit** (Farms, Users): local state, URL written only on Enter or the Search button. Live-syncing per keystroke floods browser history and refetches per character.
  - **Blur OR Enter, trimmed** (API Errors): an UNCONTROLLED input using defaultValue, committing on blur AND on Enter, with a trim, plus a Clear filter button that appears only when a filter is applied. Converting it to a controlled input silently changes WHEN a filter applies.

  Both must be reachable from this hook; neither is the default that the other collapses into.

- [x] **Step 4: Own the sort key too — this is an improvement over both sides.** v3 writes NO URL state at all (verified: no pushState, no replaceState, no history API anywhere in app.js), so in the prototype no filter, no sort column, no sort direction and no list-open state is shareable, bookmarkable or refresh-surviving, and the back button does not undo a filter. Live URL-syncs filters but keeps sort in component state (`InterventionQueueTable.tsx:44-45`), so sort dies on refresh. The port exceeds both: sort key, sort direction and the summary-first open flag all go in the URL.

- [x] **Step 5: Test the preservation property directly**

```tsx
it('preserves the org param when a filter changes', () => {
  // start at /farms with org and page=3; set tier=B; expect org still
  // present and page reset to 1.
});
it('does not write the search draft until submit', () => { /* … */ });
it('commits the endpoint filter on blur as well as Enter', () => { /* … */ });
it('round-trips sort key and direction through the URL', () => { /* … */ });
```

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 6: Commit** — `feat(admin-web): one URL-state hook; functional updater, page reset, both commit contracts`

---

### Task 8: ONE list component — the 2,775 duplicated lines that are not ported

> **🛑 MEASURED CONSTRAINT from Task 6 (`c2b8cf28`) — read before designing the search.**
>
> `searchKey` generates up to **48 spellings / ~500 characters** for a three-word Marathi name.
> Measured over **3,000 farms**, real names, jsdom, single run:
>
> | | |
> |---|---|
> | Build the index | **~60 ms one-time, ~355 KB in memory** |
> | Scan the index | **~0.4 ms per keystroke** |
>
> **The search is instant. The build is not.** 0.4 ms per keystroke is imperceptible and the index
> could grow tenfold and still be fine. But **60 ms is a dropped frame**, so the index MUST be
> memoised on the row data and MUST NEVER be recomputed inside a keystroke handler. Doing that turns
> a 0.4 ms search into a 60 ms one and the search will *feel broken* — which is worse than the
> current no-search, because a slow box invites retyping.
>
> Ceilings are asserted in `searchKey.test.ts` (≤ 64 spellings, < 1 KB for a three-word name), so a
> later change to the respelling rules cannot quietly make the build ten times worse.
>
> **Caveats stated, not buried:** jsdom, one machine, one run, 3,000 rows. **Not** measured in a real
> browser, on a low-end device, or at 50,000 rows. If this task targets any of those, measure again.
>
> The haystack shape the numbers describe is `` `${raw} ${searchKey(raw)}`.toLowerCase() ``. Task 6
> deliberately did **not** ship a `searchHaystack` helper — its shape is this task's call.

**Files:**
- Create: `src/clients/admin-web/src/components/data/DataList.tsx`
- Create: `src/clients/admin-web/src/components/data/` — SummaryFacets, ExpandableRow, SortHeader, Pager, types
- Create: `src/clients/admin-web/src/components/data/__tests__/DataList.test.tsx`

**Interfaces:**
- Produces DataList — the ONLY table/list in the console from here on.
- Consumes useListUrlState (T7), the state vocabulary (T5), PersonName and searchKey (T6), fmt (T4), and tanstack react-table for the server-paginated case (A50).

**This is the founder-approved consolidation task.** The live console hand-rolls table markup in sixteen places; the prototype duplicates 2,775 lines of filtering across five screens. Neither travels.

- [x] **Step 1: Define the configuration surface**

```ts
export interface DataListConfig<T> {
  id: string;                                   // namespaces URL params, labels aria
  rows: T[];
  rowKey: (row: T) => string;
  columns: ColumnDef<T>[];                      // label, render, sortType, align, width

  /** Server pagination — Farms 40, Users 50, API Errors 50. Omit for client-side. */
  pagination?: { mode: 'server'; page: number; pageSize: number; totalCount: number;
                 onPage: (p: number) => void }
             | { mode: 'none' };

  /** Summary-first facets. Each option states its exact count and, where the
   *  screen has acreage, its exact acreage. crossFiltered true means the
   *  number on a button is the number you get by pressing it. */
  facets?: FacetConfig<T>[];

  /** Search. commit submit (Farms, Users) or commit blur-or-enter (API Errors). */
  search?: { placeholder: string; commit: 'submit' | 'blur-or-enter';
             keys: (row: T) => string[] } | { mode: 'server' };

  /** Fixed, non-user-controllable ordering — a product decision, not a preference. */
  fixedSort?: { key: string; dir: 'asc' | 'desc'; because: string };

  /** Default sort plus per-column default direction plus tiebreak. */
  defaultSort?: { key: string; dir: 'asc' | 'desc'; tiebreak?: (a: T, b: T) => number };

  /** Collapsed-by-default accordion around the whole list. */
  collapsible?: { defaultOpen: boolean; summary: (rows: T[]) => ReactNode };

  /** Expandable row detail — prose plus a definition list of context. */
  expand?: (row: T) => ReactNode;

  /** Row-action slot. Renders nothing unless a screen supplies actions. (B15) */
  actions?: (row: T) => ReactNode;

  /** State vocabulary, per list. */
  states: { isLoading: boolean; isFetching: boolean; error: unknown;
            onRetry: () => void; measuredZero?: { what: string; checkedAt: string };
            feedDown?: { since: string; lastGood?: string } };

  /** Skeleton shaped like the real thing, not a generic spinner. (B12) */
  skeleton: { rows: number; cells: number };
}
```

- [x] **Step 2: Implement the sorter with all four semantics that exist today**

```ts
/**
 * Missing values park at the BOTTOM in BOTH directions (v3): not small,
 * not large, not there. A cell carrying a real 0 with no honesty state sorts
 * as a real zero. The sort is stable via an index tiebreak.
 *
 * Per-column default direction and the score-ASC then lastActiveAt-DESC
 * tiebreak come from InterventionQueueTable.tsx:60-69 — that product rule
 * (ties on score break by most-recently-active first) is encoded in exactly
 * one file today and would not survive a rewrite.
 *
 * aria-sort is live on every sortable header.
 */
```

- [x] **Step 3: Implement summary-first opening.** Computed totals; per-option counts AND per-option acreage where the screen has acreage; three ways to open the list; a chip stating the applied filter IN WORDS whose close control returns to the SUMMARY, not to a longer list; Show all as a true three-state toggle with truthful aria-expanded.

  Cross-filtered counts are OPT-IN PER SCREEN, because v3 deliberately applies them on All Farms and Silent Churn but NOT on Users, Suffering and API Errors — where a count that moved would stop answering "how many are there". A zero-yield option keeps its position and shows 0.

- [x] **Step 4: Resolve the collision between summary-first and server pagination**

> **This is the one real design conflict in the whole port.** The v3 summary-first pattern claims every filter option can state its exact count and exact acreage. That is only computable over a FULLY LOADED set — trivially true at n=16, false at real volumes. Server pagination (A17) means the client holds 40 rows, not all of them.
>
> **Resolution, in order of preference:**
> 1. **Ask the server.** A faceted-count response alongside the page. Requires a backend change, so a separate plan — and it is the only version that stays true at scale.
> 2. **State the scope of the count.** Until (1) exists, the chip must read "12 on this page", not "12". A count whose scope is unstated is exactly the defect v3 exists to remove.
> 3. **Load everything.** REJECTED. Prod is a 2-vCPU box with a measured ceiling of about 32 simultaneous requests; a console that fetches every farm to draw a facet count is a self-inflicted outage.
>
> Build (2) now. Record (1) as the follow-up. Do not ship an unqualified count.

- [x] **Step 5: Implement expandable rows.** Generated prose plus a definition list of context, keyboard-operable on Enter AND Space, aria-expanded and aria-controls, auto-collapsing when a search hides the row, and the detail row moving WITH ITS PARENT AS A GROUP when the table sorts.

- [x] **Step 6: Implement keepPreviousData behaviour and the Refreshing swap (A25, B13).** The row count is replaced by "Refreshing…" while isFetching and not isLoading — the stricter Farmer Health variant (`FarmerHealthPage.tsx:87`) becomes the shared rule, so a first load shows the skeleton and only a background poll shows the indicator. Without placeholderData keepPreviousData every page change flashes a skeleton; without the indicator a background 30s poll changes the table under the user with no explanation.

- [x] **Step 7: Implement the pager (A17, B4).** Prev, "Page N of M", Next; bounds-disabled; HIDDEN ENTIRELY when there is one page; driving the page param through useListUrlState. For the API Errors case back it with tanstack react-table manualPagination plus server-driven pageCount (A50), so the one screen that already has server pagination does not lose it to a client-side sorter.

- [x] **Step 8: Test the twelve behaviours a rewrite loses**

```tsx
it('parks missing values at the bottom in both sort directions', () => {});
it('sorts a real zero with no honesty state as a real zero', () => {});
it('is a stable sort', () => {});
it('applies the per-column default direction on first click', () => {});
it('breaks a score tie by lastActiveAt descending', () => {});
it('keeps aria-sort live on the active column', () => {});
it('moves a detail row with its parent when sorting', () => {});
it('opens and closes a row on Enter and on Space', () => {});
it('hides the pager when there is one page', () => {});
it('disables Prev on page 1 and Next on the last page', () => {});
it('swaps the row count for Refreshing only on a background fetch', () => {});
it('returns a filter chip close control to the summary, not to a longer list', () => {});
```

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 9: Commit** — `feat(admin-web): one DataList — sixteen hand-rolled tables and 2,775 duplicated lines retired`

---

> **Executed 2026-08-31 (`1955f461`). 440 tests. Findings that outrank the plan's own text:**
>
> **The measurement disagrees with Task 6's, and the pessimistic number is the one to design against.**
> Build the index **97–112 ms** (Task 6 said ~60), scan **0.73 ms/keystroke** (said ~0.4), memory
> **3,458 KB** (said ~355). Not a contradiction — Task 8 indexed three fields of the most
> respelling-rich surnames (85 spellings for one row) where Task 6 measured one field of ordinary
> names. **Both agree on the shape: the build costs ~130× a scan, so it MUST be memoised.** Proved by
> call count, not a clock: 6 keystrokes over 3,000 rows → `keys() 3000 -> 3000`, zero rebuilds.
>
> **🛑 A separate, larger performance problem was found and is NOT search.** At 3,000 rows a keystroke
> costs ~70 ms, of which the search is 0.73 ms. The rest is React re-rendering 3,000 rows because the
> draft text lives inside `DataList`. Irrelevant at 40–50 rows a page — **but Silent Churn (T15) and
> Suffering (T16) fetch their WHOLE list today.** Those two tasks must paginate or virtualise; they
> should not discover this.
>
> **The tiebreak's comment lies about its own code.** `InterventionQueueTable.tsx` comments
> "Tiebreak score-asc"; the code is `if (sortKey === 'score')` and runs in **both** directions. The
> code was carried, not the comment. It also returns `-1` when two timestamps are equal — the same
> answer for `(a,b)` and `(b,a)`, an inconsistent comparator with **no defined result under V8**. Now
> returns 0 and falls to a stable index. The only behaviour change in the task, and it had no defined
> behaviour to preserve.
>
> **Citation drift (eighth):** `InterventionQueueTable.tsx:60-69` spans two separate facts, includes
> four unrelated lines and cuts line 70. Correct: **60-62** (tiebreak) and **67-70** (per-column
> default direction).
>
> **The 2,775 figure is right, with a caveat:** that counts `<script>` through `</script>`
> inclusive. The JavaScript itself is **2,765**; the whole files are **3,555**.
>
> **Cross-filtering verified, not trusted:** `pass(` appears only in `all-farms.html:322` and
> `silent-churn.html:322`. The other three bake counts into markup at build time. Opt-in, default OFF.
>
> **Three plan-sketch defects fixed:** the `search` server variant had no `placeholder` and no
> `commit`, so it would have shipped an unlabelled input; `states.measuredZero` was optional and is
> now **required**, so TypeScript forbids an empty list that does not say what it looked for and when;
> and `tiebreak` hung off `defaultSort`, which would have silently stopped applying the moment a
> reader clicked that column twice — it hangs off the column.
>
> **TanStack Table was NOT used for the pager** — arithmetic instead. The protected behaviour (server
> decides the page count, client never slices) is preserved and tested. **If Task 18 also drops it,
> register row A50 needs the founder's tick in the Deliberately-Dropped table.**
>
> **🛑 URL params are NOT namespaced.** Every screen in Tasks 14–18 has one list, so nothing collides.
> **Ops Live (T20) has two tables (A52)** and needs namespaced params — a small addition to T7, not a
> second list component.

---

### Task 9: One chart shell — with the data table as a required prop

**Files:**
- Create: `src/clients/admin-web/src/components/data/ChartShell.tsx`
- Create: `src/clients/admin-web/src/components/data/GapBar.tsx`, `Sparkline.tsx`

**Interfaces:**
- Produces ChartShell, where `dataTable` is a REQUIRED prop.

- [x] **Step 1: Make the accessible data table impossible to omit (A32).** Five charts carry a details/summary "Show data table" today — `ScoreDistributionChart.tsx:71`, `EngagementTierBreakdown.tsx:95` (sr-only by construction, so invisible in any screenshot), `PillarHeatmap.tsx:77`, `WeeklyTrendChart.tsx:91`, `FarmerTimeline.tsx:138`. Making it a required prop of the shared shell is what stops a rewrite dropping it silently.

- [x] **Step 2: Carry the fixed-axis fill as a shell responsibility (A33)**

```ts
/**
 * The API returns sparse collections. Without a fixed axis a missing bin
 * vanishes and the whole chart shifts between refreshes — which reads as
 * data movement rather than absence. Invisible until it happens in prod.
 *   FIXED_BINS   — 10 score bins (ScoreDistributionChart.tsx:20)
 *   TIER_ORDER   — A, B, C, D    (EngagementTierBreakdown.tsx:20)
 *   PILLAR_ORDER — 6 pillars     (PillarHeatmap.tsx:25)
 */
```

- [x] **Step 3: Add the v3 hatched gap — and reconcile it with the zero fill**

> **These two rules collide and the collision must be decided, not averaged.** Live zero-fills an absent bin to 0 so the axis cannot reshuffle. v3 requires a never-measured period to render as a HATCHED 45-degree full-height stub, never a zero-height bar, because a gap must not be readable as a bad day.
>
> **Both are right about different things.** The resolution: KEEP THE FIXED AXIS, and render an absent slot AS A GAP rather than as a zero. zeroFill becomes fillAxis, returning either a value or a gap marker. A slot that was measured and came back zero is a real zero; a slot that was never measured is a gap. This is the same measured-zero-versus-missing-feed distinction as T5, applied to a chart.
>
> The recency-opacity ramp is deliberately NOT applied to a gap — an absence has no recency. The hatch is the only gradient in the v3 stylesheet and is documented there as data encoding, not decoration (CONTRACT.md section 8); do not add a second one.

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 4: Commit** — `feat(admin-web): one chart shell — data table required, gaps are gaps not zeros`

---

> **Executed 2026-08-31 (`f398e414`). 492 tests. All eight citations correct — the first clean sweep.**
>
> **🛑 A defect the Preservation Register never carried: the live charts collapse gap and zero at
> PANEL level, not merely at slot level.** `ScoreDistributionChart.tsx:36` reads `if (total === 0)` —
> and because it zero-fills first, that is true both when the API returned **nothing** and when it
> returned ten bins each genuinely measured at zero. Both print *"Not enough data yet — check back in
> 7 days."* One of those is a broken pipeline; the other is a cohort of farms that all scored in one
> place. Same defect at `EngagementTierBreakdown.tsx:34`. A33 only ever described the slot-level `?? 0`.
>
> **🛑 HAND-OFF for Tasks 21–23: recharts cannot draw this hatch through `<Bar>`.** A `Cell` takes a
> `fill`, and a `repeating-linear-gradient` is not a paint server it accepts; a full-height stub over
> a value axis is not something `<Bar>` expresses either. Whoever re-points `ScoreDistributionChart`
> and `WeeklyTrendChart` must render gap slots through `GapBar`/`Sparkline` outside recharts, or
> overlay them. Recorded now rather than discovered there.
>
> **`dataTable` is enforced at the TYPE level, not by a runtime test** — and the guard survives a
> determined workaround: someone who made the prop optional *and* added `?.` at all five use sites is
> still stopped by `TS2578` on the `@ts-expect-error` directive. The same device now guards
> `states.measuredZero` on a chart, matching Task 8's list rule.
>
> **A plain `<table>` was chosen over `DataList` for the accessible table, and the deciding reason is
> not cost: a chart's table MUST NOT be sortable.** Its order *is* the fixed axis — the exact property
> A33 exists to protect. A reader who re-sorts it holds a second, disagreeing view of the same
> numbers. (Also: `DataList` writes the un-namespaced `?sort`/`?dir`/`?open`, and Farmer Health draws
> **four** charts on one page — the Ops Live collision arriving four times over.)
>
> **`dataTable` describes columns, never rows.** The rows *are* the chart's `slots`, and the gap cell
> is rendered by the shell — so there is no code path by which the accessible table can print `0` for
> a period nobody measured.
>
> **`theme.css` has TWO hatch frequencies**, 4px/8px (`:814`) and 5px/10px (`:838`); §8 names only the
> latter as its exception. **One step carried deliberately** — two frequencies on one screen read as
> two different states, which is the legend this console does not have.
>
> **A33's `PillarHeatmap.tsx:25,48` is imprecise:** 48 is the iteration; the `?? 0` fallbacks are at
> **51** and **53**.
>
> **DECIDED:** a chart with nothing in it no longer says *"check back in 7 days"* — that is a fact
> about the future with no source, and if the pipeline is broken it says it forever. It now states
> the absence plainly. And a chart still draws when most slots are missing, with coverage stated in
> words, rather than hiding the one real reading there is.
>
> **Pre-existing §8 violation found, not fixed:** `LoadingState.tsx:47` (Task 5) uses a Tailwind
> gradient for a white-on-white shimmer. Decoration, not data encoding. **Task 29 or a founder call.**

---

### Task 10: The shell — nav, top bar, and the things the console has never shown

**Files:**
- Rewrite: `src/clients/admin-web/src/app/AdminShell.tsx`
- Create: `src/clients/admin-web/src/app/ToastHost.tsx`

- [x] **Step 1: Rebuild the sidebar on the v3 layout, keeping all six groups and twelve items.** 236px at 1280 and above, 212px at 1024 to 1279, a horizontal strip below 1024. Groups stay Overview, Operations, Product, Farms, Schedules, Admin — CONTRACT.md Appendix 1 confirms six, not five, with WVFD alone in Product.

- [x] **Step 2: Keep the nav badge slot (A53)**

```tsx
/**
 * Renders nothing today, so it appears in no screenshot and gets removed as
 * dead code — then gets "invented" later as a new feature. It is the natural
 * home for a live alert or suffering count, which the v3 Home screen already
 * computes.
 */
badge?: number;
```

- [x] **Step 3: Resolve the shortcut badges (D4).** The only global key handler binds Cmd-K and Escape. Either implement Cmd-1, Cmd-2 and Cmd-F or drop the three badges. Carrying the chips forward re-ships a lie, which is precisely what the v3 doctrine forbids. Recommendation: implement them in T13 — three lines in an existing handler is cheaper than explaining a removed affordance.

- [x] **Step 4: Put the active org in the top bar, on every screen (A39, B11).** Today the org name appears in exactly one subtitle, on one screen (`FarmerHealthPage.tsx:31-33,55-57`). With v3 having no org concept at all, that last visible trace of tenancy would disappear and every screen would show org-scoped numbers with nothing on screen saying which org. Do the opposite of dropping it: the active org name goes in the top bar on every screen, with a real switcher beside it. The v3 doctrine demands that a number states its scope.

- [x] **Step 5: Wire the avatar to the real user (D12).** initialsOf is called with literal nulls so every user sees AK, and useAdminAuth() is called and its result discarded (`AdminShell.tsx:53,77-79`). Either wire it to the resolved scope user or drop the avatar. Do not reproduce the constant.

- [x] **Step 6: Add a sign-out control to the shell (A13, B3).** Today the ONLY sign-out in the entire app is on /403. Put a real one in the top bar. Keep the /403 one as well — a denied user still needs it.

- [x] **Step 7: Add a manual Refresh affordance (B14).** One control that invalidates the current route query keys, next to a dataUpdatedAt-driven freshness chip. v3 has no slot for this and needs one the moment real fetching returns.

- [x] **Step 8: Add the toast host (B15 — slot only).** Mount it; register nothing. It exists so the first write surface has somewhere to land.

- [x] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [x] **Step 9: Commit** — `feat(admin-web): v3 shell — org named on every screen, real avatar, real sign-out, refresh`

---

> **Executed 2026-08-31 (`ba8f5a1c`). 523 tests. Six mutations, six kills.**
>
> **🛑 `decodeJwt` decoded one character per byte**, so a Marathi `display_name` arrived as mojibake —
> the avatar would have been wrong before the font ever got a chance. Fixed in `lib/auth.ts`, a file
> this task does not list. Display use only; **D15 (no client-side authorization) is intact** and
> Task 2's characterisation of `decodeJwt` is unchanged and green.
>
> **A measurement changed the design.** Switching org was written as `removeQueries()` behind a
> `setTimeout` with a comment about an effect-ordering race. Measured against a query keyed the way
> this console keys them (no org in the key):
>
> | | refetches? | on screen during the refetch |
> |---|---|---|
> | `removeQueries()` | **never** | the previous org's rows, indefinitely |
> | `invalidateQueries()` | yes | **the previous org's rows** |
> | `resetQueries()` | yes | loading |
>
> `resetQueries()` shipped. **The `setTimeout` made no measurable difference and was deleted with its
> explanation** — a defensive line with an unproven reason is the defect this repo keeps catching.
>
> **D3 was ALREADY DONE.** The envelope said Task 3 left the shader and its render site; both false —
> `793c16f4` deleted `WheatWindShader.tsx`, its import and its render site. There was nothing to
> delete. **Register A45's note "(110 is `<WheatWindShader />`)" is now dead.**
>
> **Every `AdminShell.tsx` citation was stale** (Task 3 edited the file): shortcut fields **32,33,37**
> not 35,36,40; badge render **99–103** not 111–115; `useAdminAuth()` **49** not 53;
> `initialsOf(null,null)` at **66** with the helper at **134–141**, not 77–79. A53's **25 / 104–108**,
> not 28 / 116–120.
>
> **🛑 B11 is assigned to T12, but Step 4 required it and it was built HERE.** T12 must **not** build a
> second switcher. Its remaining share: Step 2 (`?org=` through the router), Step 3 (org in every data
> key), Step 5 (`clear()` on NotInOrg), and the full-page `OrgSwitcher`.
>
> **Five per-item nav icon colours dropped** (`#d60000`, `#f59e0b`, `#dc2626`, `#ea580c`, `#7c3aed`).
> They encode nothing, and §7.7 is explicit: *"if you cannot say what a colour means, remove it."*
>
> **DECIDED 2026-08-31:** Live Health **stays under Operations** — the incumbent wins; nav order is
> muscle memory and is not moved to match a mockup. The top-bar chip is **relabelled "Fetched Nm ago"**
> (lands in T27 with the chip's own migration): the shell chip means *your browser received this*,
> while the in-screen chips mean *the server calculated this* — **two different facts wearing one
> label** is the defect class this redesign exists to remove. The two no-org sentences stand as written.
>
> **⚠️ Worktrees carry no `.env.local`** (gitignored), so `npm run dev` silently calls the dead
> fallback port 5001 (`api.ts:5`, A54) and every screen shows 403. Created locally, uncommitted.
> **The code-level fix to that fallback is T11's.**

---

### Task 11: Auth, guards and routing — restored and hardened

**Files:**
- Rewrite: `src/clients/admin-web/src/App.tsx`
- Modify: `src/clients/admin-web/src/lib/api.ts`
- Modify: `src/clients/admin-web/src/pages/LoginPage.tsx`
- Modify: `src/clients/admin-web/src/pages/ForbiddenPage.tsx`

- [ ] **Step 1: Reproduce the provider tree in the exact order, with the reason in a comment (A45)**

```tsx
/**
 * ORDER IS LOAD-BEARING. Reordering compiles fine and type-checks fine, then
 * breaks org-keyed scope invalidation at runtime: ActiveOrg must wrap
 * AdminAuth because the scope query key depends on the active org and
 * login() invalidates it.
 *   Theme > QueryClient > BrowserRouter > ActiveOrg > AdminAuth
 */
```

Keep the fail-fast throw in useAdminAuth, useActiveOrg and useTheme when used outside their provider.

- [ ] **Step 2: Keep route-level code splitting (A42).** All 12 pages stay lazy behind one Suspense. v3 is thirteen separate HTML files, which gives the same effect for free and therefore never prompts the question. The recharts-heavy Farmer Health chunk in particular must stay out of the initial payload — and lighthouse.yml asserts a 0.7 perf floor on that route.

- [ ] **Step 3: Rebuild RequireScope with all four branches (A2).** Three of the four outcomes have no URL of their own and appear in no screenshot. Reproduce: isLoading gives the fallback; isError goes to /403; Unauthorized goes to /403; Ambiguous renders the full-page OrgSwitcher headlined "Choose your active organization"; NotInOrg renders the full-page OrgSwitcher headlined "That organization is not in your memberships". It is not a screen in the design; it is a gate above every screen.

- [ ] **Step 4: Reproduce the guard map — including the three deliberate gaps (A3, A4).** Carry both explanatory comments verbatim:

```tsx
{/* HomePage is a KPI collage — individual cards can 403 independently without
    hiding the whole page. No single module gate fits, so no guard here. */}
{/* Schedules + Settings: no matching module key in W0-A's ModuleKey set yet.
    Relying on RequireScope (any resolved scope) for now; specific module
    gates land when schedule / admin-management surfaces add their keys. */}
```

A tidy-minded port adds guards everywhere for consistency and locks every user out of Schedules and Settings, because NO ModuleKey exists for them. Adding a guard to Home, Templates or Settings is a behavioural regression, not a cleanup. The Task 2 ROUTE_GUARDS test enforces this.

- [ ] **Step 5: Keep the guard loading semantics and its access levels (A6, A8).** Render null while loading — not a spinner, not a redirect. Keep the read/write/export levels even though no call site uses write or export yet: canExport is wired end-to-end (server flag, hook, guard) and used by no screen, so a rewrite that reimplements permissions from the design will not know it exists. v3 adds no write surfaces; the founder's brief adds features that will.

- [ ] **Step 6: Fix the deep-link gap while restoring returnTo (A9, B2).** RequireAuth currently stores only location.pathname, dropping the query string — which is where page, search, tier, weeks, days and org all live. Store the full location (pathname plus search) and navigate back to it on success. The v3 login submit handler is literally a redirect to index.html; the whole capability is invisible in a mockup and would be rebuilt as "redirect to home".

  Keep everything `LoginPage.tsx:25-50` already does right: the real POST to /user/auth/login, session storage, the server's own error message surfaced, and the "Signing in…" disabled state.

- [ ] **Step 7: Make the 401 interceptor stop destroying the deep link (A11)**

```ts
/**
 * Keep the redirect-loop guard — without the "already on /login" check a
 * token expiring mid-session produces an infinite reload. But the hard
 * window.location.assign('/login') throws away the very deep link
 * RequireAuth exists to preserve. Route through the router and carry the
 * current location as returnTo.
 */
```

- [ ] **Step 8: Restore /403 and branch on the typed errors (A12, A13, B1).** /403 stays OUTSIDE RequireScope so a broken scope cannot loop. Keep both message variants (module-specific and no-membership) and both actions. Then do what the console does not do today: CATCH AdminScopeAmbiguousError and AdminModuleForbiddenError at the surfaces that can act on them. They have zero catch sites right now, so a port can observe that nothing uses them and delete them — discarding the backend's deliberate distinction between admin_module_forbidden, admin_platform_only, admin_not_in_org and admin_no_membership permanently. This is the natural home for the v3 honest-state discipline applied to permissions.

- [ ] **Step 9: Run the Task 2 characterisation suite.** Run: `npm run test`. Expected: PASS, unchanged. If routes.contract.test.ts goes red, a guard moved — that is the regression this task exists to prevent.

- [ ] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [ ] **Step 10: Commit** — `feat(admin-web): auth plus four-outcome scope gate plus typed denials, deep links preserved`

---

### Task 12: Tenancy — org in the URL, in the top bar, and in every query key

**Files:**
- Rewrite: `src/clients/admin-web/src/app/ActiveOrgProvider.tsx`
- Modify: `src/clients/admin-web/src/components/OrgSwitcher.tsx`
- Modify: every hook in `src/clients/admin-web/src/hooks/` and `features/farmer-health/hooks/`

**Port this before any screen.** Nothing about tenancy is on screen: a grep of the entire prototype returns ZERO hits for org, tenant or scope (verified). v3 is implicitly single-tenant, so a design-led port produces a console where every list silently returns the wrong org's rows or 428s.

- [ ] **Step 1: Keep the module-scoped snapshot bridge and the exact header name (A1)**

```ts
/**
 * The axios interceptor is module-scoped and cannot subscribe to React.
 * getActiveOrgIdSnapshot() is the bridge. The header name X-Active-Org-Id
 * is coupled to the backend CORS allowlist and to AdminScopeHelper's read —
 * it is not a local naming choice.
 */
```

- [ ] **Step 2: Move the org param into router-managed search params (A15).** syncUrl currently uses window.history.replaceState (`ActiveOrgProvider.tsx:102-108`), which React Router DOES NOT SEE — so the next setSearchParams on any page strips the org straight back out of the shareable URL. Use useSearchParams with the functional updater from T7. Keep the UUID validation on BOTH the URL read and the storage read, and keep the precedence: URL, then localStorage, then null.

  The org param is the ONLY way a multi-org admin can switch org mid-session today, because the promised topbar switcher does not exist. It also makes an org-scoped view shareable. v3 reads only a q param and writes no URL state at all.

- [ ] **Step 3: Put the org in every DATA query key — and then delete the reload (A7, D17).** The scope key already includes the org (`useAdminScope.ts:72`). EVERY DATA KEY OMITS IT, which is the only reason the OrgSwitcher window.location.reload() exists: without a full reload, switching orgs serves cached rows from the previous tenant.

```ts
// Before: queryKey: ['farms', 'list', page, pageSize, search, tier]
// After:  queryKey: ['farms', 'list', activeOrgId ?? 'none', page, pageSize, search, tier]
```

  Apply to useFarmsList, useSilentChurn, useSuffering, useUsersList, useOpsErrors, useOpsHealth, useOpsVoice, useWvfd, useCohortPatterns, useFarmerHealth and useScheduleTemplates. Then replace the reload with setActiveOrgId plus invalidateQueries.

- [ ] **Step 4: Build the topbar switcher (B11).** `App.tsx:84` already tells the user "you can switch later from the topbar" and `OrgSwitcher.tsx:24-26` documents a compact popover variant. Neither exists. Build it: the compact non-full-page variant in the top bar, next to the org name from T10.

- [ ] **Step 5: Make the NotInOrg sentence true (D16).** clear() is declared and never called, so "The previous selection has been cleared" is false — the bad org id stays in localStorage AND in the URL. Call clear() when the resolver returns NotInOrg. Either call it or drop the sentence; do not port the false claim.

- [ ] **Step 6: Test the cross-tenant property**

```tsx
it('sends the active-org header on every admin request', () => {});
it('refetches every data query when the org changes', () => {
  // The regression this guards: switching orgs serves cached rows from the
  // previous tenant. It is silent, and it is a data-leak-shaped bug.
});
it('keeps the org param through a filter change on every list screen', () => {});
it('rejects a non-UUID org param and a non-UUID stored value', () => {});
it('clears the stored org when the resolver says NotInOrg', () => {});
```

- [ ] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [ ] **Step 7: Commit** — `feat(admin-web): org in the URL, the top bar and every query key; reload removed`

---

### Task 13: Command palette v2 — entity-aware, gated, filtered

**Files:**
- Rewrite: `src/clients/admin-web/src/app/CommandPalette.tsx`

- [ ] **Step 1: Index entities, not just pages.** v3 indexes 12 nav destinations PLUS 16 farms (sub-line = owner) and 19 users (sub-line = phone) against the romanised haystack from T6, and deep-links via a q param into the destination screen's search box, FORCING ITS LIST OPEN so the jump lands on the person, not the summary. The live palette is 11 hardcoded nav commands and is missing Farmer Health entirely (`CommandPalette.tsx:7-19` — verified, no farmer-health entry).

- [ ] **Step 2: Move it behind RequireAuth and filter by canRead (A46, B16)**

```tsx
/**
 * Two conscious decisions, both currently wrong in different directions.
 *
 * (a) Live mounts the palette at App.tsx:111, OUTSIDE RequireAuth. Harmless
 *     while it lists 11 static page names. The moment it indexes farm names,
 *     owners and farmer phone numbers — which is the whole point of v2 —
 *     that PII sits one keystroke from an unauthenticated screen. v3
 *     identified this as latent and withheld the palette from login.html;
 *     indexing entities makes it live. Mount inside RequireAuth.
 *
 * (b) Live applies no scope filter, so the palette offers destinations that
 *     bounce the user straight to /403. Filter every entry through
 *     canRead(moduleKey) using the same map as ROUTE_GUARDS.
 */
```

- [ ] **Step 3: Add the missing destination.** Farmer Health is absent from the palette today. Add it, and the per-farm drilldown.

- [ ] **Step 4: Resolve D4 here.** If the founder chose implement, bind Cmd-1 to /, Cmd-2 to /ops/live and Cmd-F to /farms in the same handler that owns Cmd-K and Escape. If drop, remove the badges in T10.

- [ ] **Step 5: Test**

```tsx
it('is not mounted for an anonymous user', () => { /* PII must not be reachable pre-auth */ });
it('omits a destination the current scope cannot read', () => { /* no /403 dead ends */ });
it('finds a Marathi surname when the user types its Latin spelling', () => {});
it('deep-links via the q param and forces the destination list open', () => {});
```

- [ ] **Final step for this task: prove the console still builds**

The "shippable at every task" invariant is asserted throughout this plan and enforced almost
nowhere — Tasks 4, 5, 6, 7, 9, 10, 12 and 13 originally ended at "run and commit". An invariant
nothing checks is a hope. Before committing:

```bash
cd src/clients/admin-web && npm run build && npm run test && npm run lint
```

Expected: exit code 0 on all three. If the build is red, the invariant is already broken — fix it
here rather than carrying it into the next task.

- [ ] **Step 6: Commit** — `feat(admin-web): entity-aware palette behind auth, filtered by scope`

---

## Tasks 14 to 26: Screens, one at a time

Every screen task shares the SAME SIX STEPS. They are written out once here and referenced per screen; each screen task then lists only what is specific to it.

> **S1.** Replace the hand-rolled table (or card grid) with DataList and a config object. No filtering logic in the page.
> **S2.** Wire to the named hook. No sample data. Keep the cadence and the placeholderData from the register.
> **S3.** Wire every URL param the screen owns through useListUrlState, preserving the org param and the page-reset rule.
> **S4.** Replace every empty state with the correct one of the four causes. Handle isError — currently only three files in the whole console reference it.
> **S5.** Apply the honest-value rule: a null from fmt renders through NotMeasured; a redacted name through Masked; a Devanagari name through PersonName.
> **S6.** Run `npm run test && npm run build`; commit; tick this screen's Preservation Register rows.

---

### Task 14: All Farms — `/farms`

**Hook:** useFarmsList(page, 40, search, tier) against `/shramsafal/admin/farms`, envelope, keepPreviousData.
**Register rows:** A17, A18, A20, A21, A24, A25, A34, A51; B4, B9, B12, B13, B16; D11.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Keep server pagination at 40 per page.** v3 renders all 16 farms at once and its Show all button is a promise it can only keep at n=16. At real volumes a client-side port either loads everything (fatal on a 2-vCPU box, measured ceiling about 32 concurrent requests) or quietly drops the ability to reach page 2.
- [ ] **Step 3: Keep the tier A/B/C/D filter (B9).** The v3 facets are crop, village, plan and land-record, and tier is a column only; the live tier filter is a working server-side capability with a UI control (`FarmsListPage.tsx:46-54`). Keep both — the v3 facets are additive.
- [ ] **Step 4: Fix the Owner column (v3 Appendix 6).** Today the header reads Owner and the cell renders the owner's phone (`FarmsListPage.tsx:80`). The v3 version — name with the phone as a sub-line — makes the header true. Render the name through PersonName and the phone through Masked.
- [ ] **Step 5: Resolve the dead row-click (D11).** The onClick navigates to an unregistered route, so every click falls through the catch-all and bounces to Home while the whole table is styled cursor-pointer. Replace with the v3 expandable row. Do NOT port the silent bounce, and do not leave a pointer cursor on a row that does nothing.
- [ ] **Step 6: Keep the draft-not-URL-synced search (A21)** and the Refreshing swap (A25).
- [ ] **Step 7: Commit** — `feat(admin-web): All Farms on DataList`

---

### Task 15: Silent Churn — `/farms/silent-churn`

**Hook:** useSilentChurn() against `/shramsafal/admin/farms/silent-churn`, envelope, staleTime 300s, NO refetchInterval.
**Register rows:** A24, A34; B12, B16; D9.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Replace "No farms in silent churn" (D9).** An unqualified empty on this screen reads as good news whether the list is genuinely empty or the request 500'd. Four causes.
- [ ] **Step 3: Add the v3 "Too new to judge" hold-out panel.** Farms with no last log to count back from are held OUT of the watchlist and shown separately with an unmeasured state — that is neither a long silence nor zero weeks. The live screen has no such concept; it renders a formatted date or the literal word Never (`SilentChurnPage.tsx:41`), which calls "never logged" the same thing as "logged and stopped".
- [ ] **Step 4: Add the v3 "Outreach is not measured" note.** Every expanded row reads "Last contacted — not measured". A new true statement about the product; do not soften it.
- [ ] **Step 5: Cross-filtered facet counts ON** (v3 applies them here and on All Farms).
- [ ] **Step 6: Commit** — `feat(admin-web): Silent Churn on DataList, with the too-new hold-out`

---

### Task 16: Suffering — `/farms/suffering`

**Hook:** useSuffering() against `/shramsafal/admin/farms/suffering`, envelope, staleTime 60s plus refetchInterval 60s.
**Register rows:** A24, A34; B12; D9.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Replace "No farms with repeated errors — great!" (D9).** The single worst silent-failure string in the console: it renders a 500 as a celebration.
- [ ] **Step 3: Add the v3 "nothing marks an error resolved" note.** True statement about the product; the write surface that would change it is B15, a separate plan.
- [ ] **Step 4: Cross-filtered facet counts OFF** — v3 deliberately does not cross-filter here, because a count that moved would stop answering "how many are there".
- [ ] **Step 5: Commit** — `feat(admin-web): Suffering on DataList`

---

### Task 17: Users — `/users`

**Hook:** useUsersList(page, 50, search) against `/shramsafal/admin/users`, envelope, keepPreviousData.
**Register rows:** A17, A18, A20, A21, A24, A25, A51; B4, B12, B13, B16; D9.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Keep server pagination at 50 per page** and the draft-commit search contract.
- [ ] **Step 3: Mask the phone (B16).** v3 prints full phone numbers on every user row. The phone IS the account, so the column stays — but it renders through Masked and respects whatever the server sends.
- [ ] **Step 4: Show absences as absences.** The bare em dashes at `UsersPage.tsx:61-62` carry no reason. Route them through NotMeasured so they say WHY. Same for lastLoginAt — "never signed in" is a fact, not a blank.
- [ ] **Step 5: Cross-filtered facet counts OFF.**
- [ ] **Step 6: Commit** — `feat(admin-web): Users on DataList, absences named`

---

### Task 18: API Errors — `/ops/errors` — PARTIALLY BLOCKED

**Hook:** useOpsErrors with page, pageSize 50, endpoint and since, against `/shramsafal/admin/ops/errors`; envelope; staleTime 25s plus refetchInterval 30s; keepPreviousData.
**Register rows:** A16, A17, A18, A20, A21, A24, A25, A50, A51; B4, B12, B13; D9.

- [ ] **Step 1: S1 to S6, using the server-paginated DataList mode** backed by tanstack react-table manualPagination (A50). This is the one screen that already has server pagination; a port that unifies on the v3 client-side sorter loses it.

- [ ] **Step 2: Keep the since param — and finally give it a control (A16)**

```tsx
/**
 * The textbook case. ?since is read at OpsErrorsPage.tsx:64, passed at :66,
 * threaded through useOpsErrors.ts:17,29 into the API query string — and has
 * NO UI control anywhere. It is reachable only by hand-editing the URL.
 * A screen-by-screen port from v3 deletes it and nobody notices until an
 * on-call engineer's saved link stops working.
 *
 * Keep reading it. Then give it a real time-window selector, so it stops
 * being URL-only.
 */
```

- [ ] **Step 3: Keep the blur-OR-Enter endpoint filter exactly (A21)** — uncontrolled defaultValue, a trim, and the conditional Clear filter button. It looks identical to the Farms search in a screenshot and behaves differently on purpose.

- [ ] **Step 4: Replace "No errors found. The system is healthy." (D9)** with the v3 measured zero: "No errors in the last 2 hours. The window was checked at 11:41. This is a measured zero, not a missing feed."

- [ ] **Step 5 — BLOCKED on the error-capture plan Task 8** ("Carry it to the admin API" — NOT its Task 6, which widens the vocabulary)**:** add the errorCode and Meaning columns.

- [ ] **Step 6 — BLOCKED:** the expandable row showing what the server actually said (Message), which app build the farmer was on (AppVersion), and whether the farmer's work survived (WorkKept — kept, lost or unknown, rendered as three distinct states, never defaulted).

- [ ] **Step 7 — BLOCKED for the roll-up, NOT blocked for attribution:** the v3 "Where the errors landed" endpoint roll-up (endpoint, errors, worst status, share) with a computed section dot. Rows that cannot be attributed render "— not attributable" rather than guessing a farm; that part is NOT blocked, because farmId is already nullable in OpsErrorEvent (`useOpsHealth.ts:9`).

- [ ] **Step 8: Commit** — `feat(admin-web): API Errors on DataList; the since filter gets a control`

---

### Task 19: Voice Pipeline — `/ops/voice`

**Hook:** useOpsVoice(days) against `/shramsafal/admin/ops/voice?days=`, envelope, 5-minute cadence.
**Register rows:** A18, A19, A24; B5.

- [ ] **Step 1: S1 to S6, using ChartShell.**
- [ ] **Step 2: Keep the days 7/14/30 selector, end to end (A19, B5).** v3 hardcodes 14 days in data.js, so the control is simply absent from the design. The value must flow into ALL FOUR places it flows today: the hook argument, the query key (so 7, 14 and 30 are three cache entries, `useOpsVoice.ts:17`), the API query string, and the interpolated card title "Voice Success Rate — last N days" (`OpsVoicePage.tsx:97`).
- [ ] **Step 3: Add the v3 by-provider breakdown,** with a null average latency given a full-size note rather than a footnote. The v3 data.js self-checks that provider rows sum to the daily totals; the React port asserts the same in a test rather than a console warning.
- [ ] **Step 4: Hatched gaps for never-measured days (T9 Step 3).** A day with no numbers is a hatched hole, never a zero-height bar.
- [ ] **Step 5: Commit** — `feat(admin-web): Voice Pipeline with a real day-window selector`

---

### Task 20: Live Health — `/ops/live`

**Hook:** useOpsHealth() against `/shramsafal/admin/ops/health`. NO ENVELOPE (A27), 30-second cadence.
**Register rows:** A24, A27, A51, A52; B10; D7, D8, D10.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Keep the unwrapped response type (A27)**

```ts
/**
 * This is the ONE endpoint that returns no AdminResponse envelope. A port
 * that assumes a uniform envelope either crashes here or silently renders
 * undefined meta. Keep the unwrapped type — and take the opportunity to
 * surface the server's computedAtUtc, which the page fetches at
 * useOpsHealth.ts:30 and then discards in favour of the browser's own fetch
 * time (OpsLivePage.tsx:10). A chip must state the server's age, not ours.
 */
```

- [ ] **Step 3: Delete useOpsHealthWrapped (D10).** Zero callers; wiring it beside useOpsHealth would poll the same endpoint twice every 30 seconds on a 2-vCPU box.
- [ ] **Step 4: Ship the v3 R1-R8 fix (D8).** Keep the three-state alert badge — BREACH, CLEAR, N/A (v3 Appendix 8) — and render R1 to R8 as a grey NOT CHECKED rule. `HomePage.tsx:34` claims "all R1-R10 clear" while this page evaluates only R9 and R10; the redesign is where that self-contradiction dies.
- [ ] **Step 5: Add the v3 "Evaluated, but never delivered" note.** A breach writes one line to the API host log, sends no email, no SMS, no push, no page, and has never reached a person on its own. That is a true and important statement about the alerting system.
- [ ] **Step 6: Replace the dev-machine error banner (D7).** "Backend unreachable. Start the .NET API on port 5001." is rendered to a production operator at admin.shramsafal.in. Use FeedDown, which names when the feed stopped and never shows the last good number as current.
- [ ] **Step 7: Decide the second suffering panel explicitly (A52, B10).**

> This looks like a duplicate of /farms/suffering and a redesign de-duplicates it. IT IS NOT A DUPLICATE: different endpoint (/ops/health vs /farms/suffering), different shape (farmId only, no farm name — `OpsLivePage.tsx:150`), different window (24h inside a live health poll). The v3 live-health.html puts a service-health table in that slot instead.
>
> **Decision: keep both.** The service-health table is additive and goes below. If the founder cuts the suffering panel, /farms/suffering must first be confirmed to cover the operational need — see the founder questions.

- [ ] **Step 8: Add the v3 service-health table.** API, each voice provider, the dead collector, the nightly rebuild. Its "what it feeds" list is DERIVED by scanning freshness metadata for a nightly source, not typed by hand.
- [ ] **Step 9: Keep the two deliberate time formats (A51)** — seconds precision on the recent-errors rows, minutes on last-error.
- [ ] **Step 10: Commit** — `feat(admin-web): Live Health tells the truth about R1-R8`

---

### Task 21: North Star WVFD — `/metrics/nsm`

**Hook:** useWvfd(weeks) against `/shramsafal/admin/metrics/wvfd?weeks=`, envelope, 5-minute cadence.
**Register rows:** A18, A19, A24; B5.

- [ ] **Step 1: S1 to S6, using ChartShell.**
- [ ] **Step 2: Keep the weeks 8/12/24 selector end to end (A19, B5)** — hook argument, query key, query string, and the interpolated title "WVFD — last N weeks" (`NorthStarPage.tsx:153`).
- [ ] **Step 3: Never-computed weeks are gaps, not zeros.** v3 has two such weeks in its sample; the live chart would draw them as a trough.
- [ ] **Step 4: Keep the goal bar, the delta and the tier chips,** but route currentWvfd, priorWvfd and goalWvfd through fmt so a null renders through NotMeasured rather than the current hardcoded fallbacks at `NorthStarPage.tsx:83,96,124-125`, which print a fabricated number when the API returns nothing.
- [ ] **Step 5: Commit** — `feat(admin-web): WVFD with a real week-window selector and honest gaps`

---

### Task 22: Farmer Health landing — `/farmer-health`

**Hook:** useCohortPatterns() against `/admin/farmer-health/cohort` — DIFFERENT PREFIX (A26), 5-minute cadence, AbortSignal threaded.
**Register rows:** A14, A24, A25, A26, A28, A29, A30, A31, A32, A33, A34, A35, A36, A39, A41; B7, B8.

- [ ] **Step 1: S1 to S6.**
- [ ] **Step 2: Keep the endpoint prefix distinct, with a comment (A26).** A port that centralises the admin prefix as a tidy-up 404s both farmer-health screens. Nothing on screen hints at it.
- [ ] **Step 3: Port FarmerSearchBox intact (A29, B7).** v3 has no farmer search at all. Preserve every subtlety: the 300ms debounce gating ONLY the button (not the query), the query firing on EXPLICIT SUBMIT via enabled, acceptance of a farmId OR a userId OR a phone, probe-first so a bad id never lands on a broken page, navigation to the SERVER-RESOLVED farmId rather than the typed string, encodeURIComponent on the path segment, the non-blocking inline miss message ("Couldn t find that farmer in your scope." — carry the real apostrophe from the source), and the onResolved extension point.
- [ ] **Step 4: Keep retry 0 and enabled-gating on useFarmerHealth (A28).** Deliberate: a 404 must fail fast and become not-found UX. A rewrite inheriting the global retry 1 breaks the search box not-found path with a two-attempt hang.
- [ ] **Step 5: Move the sorters into DataList options, not away (A30, A31).**
  - Intervention queue: 4 sortable columns, live aria-sort, per-column default direction, default score ASC with the lastActiveAt DESC tiebreak. v3 sorts everything with DIFFERENT semantics (state-parks-last, stable, no tiebreak rule), so a reviewer sees parity where there is none. URL-SYNC THE SORT STATE — today it is component-local and dies on refresh.
  - Watchlist: collapsed by default, aria-expanded and aria-controls, ordering FIXED at weeklyDelta ascending (biggest drop first) and deliberately NOT user-sortable. v3 makes every table sortable, which would silently convert a product decision into a user preference. Carry the in-code note.
- [ ] **Step 6: Render the two charts v3 never draws (B8).** scoreDistribution and engagementTiers exist in the data and appear on no v3 screen. Keep the fixed axes (A33) and the data tables (A32) — including the sr-only one under the donut.
- [ ] **Step 7: Keep the cross-surface emptiness computation (A35, A36).** The ScoringActiveBanner fires only when interventionQueue length plus watchlist length plus the summed scoreDistribution equals zero (`FarmerHealthPage.tsx:38-42`). That sum is what distinguishes "first deploy, nothing scored yet" from "scored, and nothing needs intervention" — which is exactly the understated-versus-normal empty split (A36).
- [ ] **Step 8: The org name moves to the top bar (A39, T10 Step 4)** — but this page keeps its subtitle, because it is the page where scope matters most.
- [ ] **Step 9: Commit** — `feat(admin-web): Farmer Health landing, charts v3 never drew`

---

### Task 23: Farmer Health drilldown — `/farmer-health/:farmId`

**Hook:** useFarmerHealth(farmId) against `/admin/farmer-health/{farmId}` — different prefix, retry 0, AbortSignal.
**Register rows:** A5, A14, A22, A26, A28, A32, A34, A35, A37, A38, A40, A41.

**This is the biggest single feature loss in the design, and it will not appear in any screenshot diff — the flat v3 farmer-health.html looks complete.** It is also the only working row drilldown in the console.

- [ ] **Step 1: Port the route and all five bands.**
  - **Band 1** — back link, name (through PersonName, falling back to the farmId when the name is redacted), farm id, bucket badge, suspicious-flag alert.
  - **Band 2** — DwcScoreCard: the 64px total with the six-pillar expandable accordion at their UNEQUAL maxes summing to 100 (Trigger fit 10, Action simplicity 20, Proof 25, Reward 10, Investment 10, Repeat 25).
  - **Band 3** — FarmerTimeline: the 14-day by 6-event heat grid with PER-ROW normalisation.
  - **Band 4** — WorkerSummaryList: capped at 5, with its mandatory disclaimer.
  - **Band 5** — SyncStateBlock plus AiHealthBlock, gated.

- [ ] **Step 2: Keep the in-page ops:read gate and its honest denial panel (A5)**

```tsx
/**
 * A second, finer permission layer INSIDE a page that already passed a route
 * guard. v3 has no drilldown at all, so both the gate and the honest denial
 * panel vanish together.
 *
 * Scope-still-loading is deliberately treated as NO ACCESS so server-redacted
 * nulls are never rendered as data. Keep canRead(ModuleKeys.OpsLive) around
 * SyncStateBlock and AiHealthBlock, and keep the Lock panel copy verbatim:
 *   "Sync posture and AI invocation health for this farm exist but are not
 *    visible at your role."
 *
 * This is the only honest partial-denial UI in the app, and it is exactly the
 * honesty discipline v3 claims to champion.
 */
```

- [ ] **Step 3: Keep Band 1 outside the state branches (A40).** Error, loading, empty and data are four separate branches and the header renders in ALL FOUR, so context is never lost. A port collapses this into one loading skeleton over the whole page. Keep "Farm not found in your scope." as a distinct empty state — it is a scope statement, not a 404 — and keep the retryable ErrorState.
- [ ] **Step 4: Keep the worker-list red line (A35).** Carry the disclaimer byte-for-byte — "(captured automatically from voice logs; reputation tracking not yet built)" — and carry the source comment into the new component file: "DO NOT add fields here without a new task. No reputation, no dispute, no payout, no skill, no score." A redesign treats copy as copy and enriches a thin-looking list.
- [ ] **Step 5: Keep C7 and C8 as tokens, not hexes (A37).** They read as styling; they are product constraints. A healthy pillar tops out at teal deliberately; the slate inset edge is how an admin tells privileged ops data from the core farmer profile.
- [ ] **Step 6: Extend the null-returning formatter contract to every drilldown figure (A38).** Ironically v3 has the STRONGER version of this rule — but only if the port applies it to a screen v3 does not contain. Includes the sync-state em-dash fallback on an unparseable timestamp.
- [ ] **Step 7: Keep per-band LoadingStates sized to real content with their explicit labels (A32)** — "Loading DWC score", "Loading 14-day timeline", "Loading worker summary" — rather than one generic spinner. Those labels are what tell a screen-reader user WHICH block is loading.
- [ ] **Step 8: Commit** — `feat(admin-web): Farmer Health drilldown, all five bands, gate intact`

---

### Task 24: Schedule Templates — `/schedules/templates`

**Hook:** useScheduleTemplates() — NEW, extracted from the inline useQuery at `ScheduleTemplatesPage.tsx:13-20`, against `/shramsafal/reference-data/crop-schedule-templates`. RAW ARRAY, no envelope, no meta (A26).
**Register rows:** A4, A26; D13.

- [ ] **Step 1: S1 to S6.** Templates render as CARDS, NOT A TABLE (v3 Appendix 12) — this is the one screen DataList does not own; it uses the same config for search, sort and state but a card renderer.
- [ ] **Step 2: Extract the hook** so no page holds an inline useQuery, and comment the missing envelope so the next reader does not "fix" it.
- [ ] **Step 3: Delete the unprovable freshness chip (D13).** A FreshnessChip with a materialized source and no lastRefreshed (`ScheduleTemplatesPage.tsx:29`) renders a permanent "Nightly recent" over an endpoint that returns no timestamp at all. CONTRACT.md section 9.1: every number states its source AND its age. There is no age here, so there is no chip — say "reference data, no timestamp available" instead.
- [ ] **Step 4: Keep the route ungated (A4).**
- [ ] **Step 5: Add the v3 unauthored-draft state.** A draft with no task list is a name and nothing else; a taskCount of 0 must not read as "zero tasks planned".
- [ ] **Step 6: Commit** — `feat(admin-web): Schedule Templates, honest about having no timestamp`

---

### Task 25: Settings, Admin Users — `/settings/admins`

**Hook:** NONE — there is no endpoint.
**Register rows:** A4; D9.

- [ ] **Step 1: Remove the hardcoded SEEDED_ADMINS array** (`SettingsAdminsPage.tsx:4-6`). A constant rendered inside a table with a green Active pill is data-shaped, and it is not data. It is a copy of what the config allow-list contained at the time the file was written.
- [ ] **Step 2: Ship the honest v3 version.** The console is showing ONE SOURCE OF TWO: the config allow-list is what is read; ssf.admin_users has never been read because its migration has not been run. State that. Also state the v3 all-or-nothing explanation: on the allow-list means every farmer phone and every farm log; off it means a 403; there is nothing in between.
- [ ] **Step 3: Replace the "Phase 6" scaffolding copy** (`SettingsAdminsPage.tsx:23-27`) with the same statement written for an operator, not for a developer reading a plan.
- [ ] **Step 4: Keep the route ungated (A4)** — there is still no ModuleKey for admin management.
- [ ] **Step 5: Commit** — `feat(admin-web): Settings states its source instead of hardcoding a row`

---

### Task 26: Home — `/` — last, because it aggregates everything

**Hooks:** useOpsHealth, useWvfd(12), useFarmsList(1, 1) for totalCount, useSilentChurn, useSuffering.
**Register rows:** A4, A23, A24, A53; B14; D5, D6, D8, D9.

**Home is done last** because every tile is a reading of a screen already ported, and because it is the only screen whose tiles must 403 independently — which is why it is ungated (A4).

- [ ] **Step 1: Delete all three lies at once (D5, D6, D8).** The fabricated now and lastNightly timestamps, the Phase 2 / Phase 3 scaffolding copy, and the "all R1-R10 clear" claim.

- [ ] **Step 2: Wire the eight tiles to real hooks, and be honest about the four that have no source.**

| Tile | Source | If there is none |
|---|---|---|
| Active Alerts | useOpsHealth apiErrorSpike and voiceDegraded | count R9 and R10 only; R1-R8 render NOT CHECKED |
| API Errors 24h | useOpsHealth | FeedDown if the poll failed |
| Voice Success 24h | useOpsHealth voiceFailureRatePct | — |
| Logs Today | NO ENDPOINT | NotMeasured — v3 draws it as a stopped feed |
| WVFD goal 4.5 | useWvfd(12) currentWvfd | NotMeasured |
| Active Farms | useFarmsList totalCount | NotMeasured |
| D30 Retention | NO ENDPOINT — never built | NotMeasured |
| MRR | NO ENDPOINT — never built | NotMeasured |

Four of eight tiles have no source. That is the truth and the screen must show it. The KpiCard forced-grey rule from T3 Step 4 makes it structural: a tile whose state is not ok cannot be painted green.

- [ ] **Step 3: Build the v3 "Farms a person should call today".** A union over suffering, silentChurn and silentChurnExcluded; one row per farm carrying EVERY reason it was flagged as coloured pills; sorted errors-descending then weeks-descending. This is the most useful thing v3 adds and it needs no new endpoint — useSuffering and useSilentChurn already exist.
- [ ] **Step 4: Enforce cross-screen consistency.** Re-derive the Voice Success tile tone from rule R10 rather than from its own field, so Ops Now cannot paint green the exact figure the Active Alerts tile beside it counts as a breach.
- [ ] **Step 5: Add computed section-head state dots,** each with a screen-reader WORD beside it (a coloured dot alone is undecodable), explicit worst-state-wins ordering, and NO DOT AT ALL when a section has nothing to report.
- [ ] **Step 6: Populate the nav badge (A53)** from the "should call today" count — the slot has been styled and empty since it was written.
- [ ] **Step 7: Add the page-level boot-failure state.** The v3 Home inlines its own SVG precisely because the shared script may be the thing that failed to load; the React equivalent is an error boundary around the shell that does not itself depend on a lazy-loaded chunk.
- [ ] **Step 8: Commit** — `feat(admin-web): Home wired to real hooks, four honest non-values, no fabricated freshness`

---

### Task 27: Delete the dead, and decide the two undecided routes

**Files:**
- Delete: `src/pages/PlaceholderPage.tsx`, `src/assets/hero.png`, `src/assets/vite.svg`, `public/icons.svg`, the Vite-template `README.md`, and useOpsHealthWrapped from `src/hooks/useOpsHealth.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Delete the six dead artefacts (D10, D14).** All verified: PlaceholderPage has zero importers; useOpsHealthWrapped has zero callers; hero.png, vite.svg and icons.svg have zero references anywhere in src or index.html. Write a real README for admin-web in their place.

- [ ] **Step 2: Decide the catch-all explicitly (A43).**

> `App.tsx:165` silently redirects every unknown path to `/` with replace. v3 is a set of files with no router, so unknown-path behaviour is undefined in the design and whatever the new router does by default would become the answer. The silent redirect is also what has been MASKING the broken /farms/:farmId link (D11) for its whole life.
>
> **Decision: introduce a real 404** now that D11 is fixed. A silent bounce to Home is indistinguishable from a broken link, which is how D11 survived. If the founder prefers the redirect, keep it — but keep it DELIBERATELY, with the comment saying so.

- [ ] **Step 3: Decide the farm-detail route (D11).** Either register /farms/:farmId or remove the row-click affordance and the cursor-pointer styling. T14 Step 5 chose the expandable row; this step is where the dead navigate() call is actually deleted.
- [ ] **Step 4: Run the full suite.** `npm run test && npm run build && npm run lint`
- [ ] **Step 5: Commit** — `chore(admin-web): delete dead scaffolding; 404 and farm-detail decided`

---

### Task 28: Make deep links survive production

**Files:**
- Create: the SPA history-fallback config for the admin distribution
- Create: `src/clients/admin-web/scripts/deploy-s3.sh`
- Verify: `vite.config.ts`, `tsconfig.app.json`, `eslint.config.js`, `package.json`

- [ ] **Step 1: Find and commit the history fallback (A44).**

> **This is the one failure mode that is invisible until deployment.** Every shareable URL — /farms with a tier and a page, /farmer-health with a farmId, /ops/errors with a since — works perfectly in vite dev and 404s in prod if the host does not rewrite unknown paths to index.html. There is no _redirects, no vercel.json, no netlify.toml and no nginx conf anywhere in admin-web — verified.
>
> The admin site is CloudFront E31NGXQN85PXV7 over S3 shramsafal-admin-prod. The rewrite therefore lives in a CloudFront custom-error-response (403 and 404 mapped to /index.html at 200) that exists only in the AWS console today. COMMIT IT INTO THE REPO THIS TIME — as `aws/admin/cloudfront-spa-fallback.json` applied by the deploy step, so the next person who recreates the distribution does not silently lose every deep link this plan just built.
>
> **Corollary, taken from the mobile-web tracker rows:** on a distribution with a 404-to-index rule at 200, ANY MISSING OBJECT RETURNS HTTP 200 WITH text/html. A status-code-only smoke check produces false greens. Every prod proof in the Deployment Plan below therefore asserts Content-Type, not just status.

- [ ] **Step 2: Verify the alias is declared in both places (A49).** `vite.config.ts:8-12` AND `tsconfig.app.json`. Missing one half gives a build that type-checks but will not bundle. It is now declared in three places, counting vitest.config.ts.
- [ ] **Step 3: Keep port 4001 strictPort.** Local tooling, CORS allowlists and the founder bookmarks assume it.
- [ ] **Step 4: Keep the build and lint config.** `eslint.config.js:8-41` deliberately demotes rules to warn with a 9999 warning ceiling so admin-web participates in the gate without a shell OR-true. Inheriting stricter defaults fails CI on day one.
- [ ] **Step 5: Write the deploy script that does not exist.**

> `src/clients/mobile-web/scripts/deploy-s3.sh` exists and self-verifies from the edge. `src/clients/admin-web` HAS NO scripts DIRECTORY AT ALL — verified. The tracker root-cause note on the 2026-07-17 cache incident says it plainly: "No script owns the S3 sync; every deploy re-types it freehand, so the method silently drifts. This will recur until the sync, with cache headers baked in, lives in a script." Create `src/clients/admin-web/scripts/deploy-s3.sh` modelled on the mobile-web one: explicit cache-control per class, index.html no-cache, hashed assets one-year immutable, ZERO objects immutable without a content hash, and an edge-side self-verification pass.

- [ ] **Step 6: Commit** — `chore(admin-web): commit the SPA fallback and a codified S3 sync`

---

### Task 29: Accessibility, responsiveness and the performance budget

- [ ] **Step 1: Keyboard sweep.** Every expandable row responds to Enter AND Space; focus is visible everywhere at 2px indigo with 2px offset; no outline is removed; the palette traps focus and returns it.
- [ ] **Step 2: Screen-reader sweep.** Every chart has its data table (A32); every loading block has a named aria-label; every aria-sort is live; every state dot has a word beside it; every aria-expanded is truthful.
- [ ] **Step 3: Responsive sweep** at 1280, 1279 and 1023, with the sidebar collapsing to a horizontal strip. The viewport lock was removed in T3 Step 6.
- [ ] **Step 4: prefers-reduced-motion and print** both honoured (T3 Step 5).
- [ ] **Step 5: Run the existing Lighthouse budget.** `.github/workflows/lighthouse.yml:55-95` builds admin-web and asserts perf 0.7 and a11y 0.9 on /farmer-health from a static dist. It must still pass. Note the job's own comment: unauthenticated, it actually scores /login, so a11y regressions on GATED routes will NOT be caught by it — Step 2 manual sweep is not optional.
- [ ] **Step 6: Commit** — `fix(admin-web): a11y and responsive sweep across all 13 routes`

---

### Task 30: The Preservation Register sweep

**Files:**
- Create: `src/clients/admin-web/src/__tests__/preservation.register.test.ts`

- [ ] **Step 1: Encode the register as a test.**

```ts
/**
 * The founder's guarantee, as an executable. Every A-row that CAN be
 * asserted mechanically is asserted here; every A-row that cannot is listed
 * with the manual gate step that covers it, so the list is exhaustive either
 * way and a gap is visible rather than assumed.
 */
const MECHANICAL = [
  'A1 active-org header', 'A3 route to module map', 'A4 three ungated routes',
  'A6 fail-closed predicates', 'A7 org in scope key', 'A8 guard renders null',
  'A10 session expiry plus cache hygiene', 'A11 401 loop guard', 'A12 typed 428 and 403',
  'A17 server pagination', 'A18 URL filters', 'A19 window selectors',
  'A20 functional updater plus page reset', 'A21 both commit contracts',
  'A23 cadences plus RQ defaults', 'A24 envelope plus chip mappings',
  'A25 keepPreviousData plus Refreshing', 'A26 two path prefixes',
  'A27 unwrapped ops health', 'A28 abort plus retry 0', 'A30 sort semantics',
  'A31 fixed watchlist order', 'A33 fixed axes', 'A34 Devanagari font',
  'A35 verbatim copy', 'A36 two empty variants', 'A38 rate sanitisation',
  'A42 lazy routes', 'A45 provider order', 'A50 manual pagination',
  'A51 per-surface date formats',
  // Added 2026-08-30 after the gate found them missing from the register. Five of
  // the six are trivially assertable; A56 (StrictMode effect double-invoke) is not,
  // and is covered by the manual gate instead.
  'A54 axios timeout plus base url fallback', 'A55 fixed north star axis plus goal line',
  'A57 rule definition subtitles', 'A58 breadcrumb plus navlink end',
  'A59 tsconfig strictness vs globals tests',
] as const;

// A56 (StrictMode double-invoke, and FarmerSearchBox navigating from inside an
// effect) cannot be asserted from a static sweep — it is a dev-only runtime
// behaviour. Covered by the Founder Acceptance Gate's by-hand farmer-search check.

```

- [ ] **Step 2: Walk every route with the harness** and assert each one renders, is guarded exactly as ROUTE_GUARDS says, and survives a hard refresh with its full query string intact.
- [ ] **Step 3: Tick every register row** in this document. A row that cannot be ticked either gets a task, or moves — WITH THE FOUNDER SIGNATURE — into the Deliberately Dropped table. There is no third option.
- [ ] **Step 4: Run everything.**

```bash
cd "src/clients/admin-web" && npm run test && npm run build && npm run lint
cd - && dotnet test src/tests/AgriSync.ArchitectureTests/
```

- [ ] **Step 5: Commit** — `test(admin-web): preservation register sweep — nothing lost`

---

## Founder Acceptance Gate

Do not proceed to deployment until the founder has verified these himself and ticked the box.

**Run it locally first.** The console needs the API on `http://localhost:5048` (that is what `.env.local` points at).

```bash
cd "src/clients/admin-web" && npm run dev
# opens http://localhost:4001 — the port is pinned deliberately
```

### 1. Walk every route. Sixteen checks.

| # | Open | Expect |
|---|---|---|
| 1 | `http://localhost:4001/login` | A real form. A wrong password shows THE SERVER OWN MESSAGE, not a generic "Login failed". A right one lands you on the page you asked for, not Home. |
| 2 | `http://localhost:4001/` | Eight tiles. FOUR of them show a grey em dash with a reason underneath (Logs Today, D30, MRR, and any other with no source). No tile says "awaiting live data". No chip says "1s ago" over an em dash. |
| 3 | `/ops/live` | R9 and R10 show BREACH, CLEAR or N/A. R1 to R8 show a grey NOT CHECKED. Nothing anywhere says "all R1-R10 clear". |
| 4 | `/ops/errors?since=2026-08-01T00:00:00Z` | The since filter applies AND there is now a visible control showing it. |
| 5 | `/ops/voice` | 7 / 14 / 30 buttons. Click 30: the URL becomes days=30, the chart title reads "last 30 days", and the numbers change. |
| 6 | `/metrics/nsm` | 8 / 12 / 24 buttons behaving the same way. |
| 7 | `/farms` | A pager at the bottom IF there is more than one page. Type a name and press Enter: a search param appears. Click Tier B: a tier param appears AND the page param resets to 1. |
| 8 | `/farms/silent-churn` | A separate "too new to judge" group, held out of the watchlist. |
| 9 | `/farms/suffering` | Rows. If empty, it says whether that is a measured zero or a failed load — it does NOT say "great!". |
| 10 | `/farmer-health` | A search box. Type a farmer phone, press Enter, and you land on their drilldown. |
| 11 | `/farmer-health/<any farmId>` | Five bands: header, score card with six pillars, 14-day grid, worker list with its disclaimer, and either the ops blocks OR the "Ops data hidden" panel. |
| 12 | `/schedules/templates` | Cards. NO "Nightly recent" chip — the endpoint has no timestamp to state. |
| 13 | `/users` | A pager. Phone numbers masked exactly as the server sends them. |
| 14 | `/settings/admins` | It says the allow-list has one entry, that ssf.admin_users has never been read because its migration has not run, and that access is all-or-nothing. NO hardcoded row dressed as data. |
| 15 | `/403` | A denial message AND a working Sign out button. |
| 16 | `/this-route-does-not-exist` | Whatever T27 Step 2 decided — and it is written down. |

**Founder verified all 16: [ ]**

### 2. Prove the invisible things, by hand

- [ ] **Deep link survives login.** Sign out. Paste `http://localhost:4001/farms?tier=B&page=3` into a fresh tab. Sign in. Expected: you land on `/farms?tier=B&page=3` — with the tier AND the page, not just `/farms`.
- [ ] **Deep link survives refresh.** On `/farms?tier=B&page=3&search=patil`, press F5. Expected: identical screen. Nothing resets.
- [ ] **The org is never lost.** Open `/farms?org=<a real org uuid>`. Change a filter. Expected: the org param is still in the URL. Open DevTools, Network, any request, Headers. Expected: `X-Active-Org-Id` present with that uuid.
- [ ] **Switching orgs does not serve stale rows.** With two org memberships, note a row on `/farms`, switch org in the top bar, and confirm the list changes WITHOUT a full page reload.
- [ ] **A denied module lands somewhere real.** Visit a route your scope cannot read. Expected: /403 with the module named — not a blank screen, not a redirect loop.
- [ ] **Sign-out is reachable from the shell**, not only from /403.
- [ ] **Cmd-K finds a Marathi farmer by Latin spelling.** Type `bhosale`. Expected: the Devanagari name appears. Then confirm the palette does NOT open on /login.
- [ ] **Background refresh is announced.** Sit on `/ops/errors` for 30 seconds. Expected: the row count briefly reads "Refreshing…" — the table does not just change under you.
- [ ] **Turn the API off** (stop the backend). Reload each screen. Expected: every one says the feed is down and when it stopped. NONE of them says the system is healthy, and none tells you to start a .NET API on port 5001.

**Founder verified: [ ]**

### 3. Confirm every Preservation Register line

- [ ] Every A-row (**59**) is ticked, or has moved to the Deliberately Dropped table with a reason.
- [ ] Every B-row (18) is ticked, or is explicitly deferred with a note (B15, B17).
- [ ] Every D-row (**18**) carries the founder tick — ESPECIALLY D1 (dark mode), D3 (the wheat shader) and D4 (the shortcut badges), which remove things that exist today.

**Founder confirmed the register: [ ]**

### 4. The suite is green

```bash
cd "src/clients/admin-web" && npm run test && npm run build && npm run lint
```

Expected: all three exit 0.

```bash
dotnet test src/tests/AgriSync.ArchitectureTests/
```

Expected: exit 0, unchanged — this plan touches no .NET code.

**Founder approved: [ ]**

---

## Deployment Plan

**Tier:** Frontend / Medium. Static site. No DB, no backend, no migration, no prod DB touch.

**Target:** `admin.shramsafal.in` — S3 `shramsafal-admin-prod` plus CloudFront `E31NGXQN85PXV7` (`DEPLOYMENT_TRACKER.md:77`).

**Deploy via the `agrisync-deploy` plugin (`/deploy`), never hand-rolled.** Founder-confirmed standing rule after a hand-rolled-deploy deviation.

- [ ] **Prerequisite — does the API need to be awake?** The tracker records for this row: *"data calls fail while API hibernated."* The redesigned console is MORE honest about a dead backend than the old one (every screen will correctly say the feed is down), so it can be deployed and browsed with prod hibernated. **But it cannot be prod-PROVEN that way** — every data assertion below needs a live API. **This is a founder decision, not an agent one:** either (a) deploy now and prove only the shell, routing and guards, then re-prove the data path at the next wake, or (b) wake prod for the window. Do not wake prod without an explicit instruction.
- [ ] **G0 to G6** all PASS via the plugin. **Re-probe G0 live**; do not reuse a prior attestation (the `d4a91c7e` stale-attestation lesson). Every gate attestation block must be cleared, not just the identity fields.
- [ ] **RG1 to RG5 release gates** at G1 via `release-safety-gates`. Record each verdict verbatim; NOT_PROVEN blocks exactly as FAIL does.
- [ ] **Build from merged `main` in an isolated worktree**, not from a working tree carrying another branch's changes.
- [ ] **Sync with the codified script from T28 Step 5.** index.html gets `Cache-Control: no-cache`; hashed assets get `public,max-age=31536000,immutable`; ZERO objects immutable without a content hash. A plain `aws s3 sync` with no cache-control is what stripped headers from 70 objects on the mobile bucket on 2026-07-17 — do not repeat it here.
- [ ] **Confirm the SPA fallback is applied** (T28 Step 1) before proving any deep link.
- [ ] **CloudFront invalidation** on E31NGXQN85PXV7, and confirm it reaches **Completed** — not merely submitted.

**Prod proof — assert Content-Type, never status alone.** This distribution rewrites unknown paths to index.html at HTTP 200, so a status-only check false-greens.

- [ ] `https://admin.shramsafal.in/` returns 200 with `Content-Type: text/html`.
- [ ] The entry-bundle hash inside the live index.html has FLIPPED from the previous deploy. Record both hashes in the tracker row.
- [ ] `https://admin.shramsafal.in/farms?tier=B&page=2` returns 200 text/html (proves the SPA fallback), and after sign-in the screen actually shows tier B on page 2 (proves the URL state survived).
- [ ] `https://admin.shramsafal.in/farmer-health/<farmId>` returns 200 text/html, and after sign-in renders the drilldown (proves the biggest at-risk capability landed).
- [ ] A hashed asset returns `public,max-age=31536000,immutable`; index.html returns `no-cache`.
- [ ] **Data proof (requires a live API):** /ops/live renders real numbers, and DevTools shows the active-org header on the request. Until this is observed, the deployment is SHELL-PROVEN, NOT PROD-PROVEN — say so in the tracker rather than rounding up.

**Rollback:** re-sync the previous build dist (retain it on disk before the swap) with the same cache-header script, then invalidate. No DB, no migration, no down-path. The rollback floor is the previous entry-bundle hash, recorded in the tracker row BEFORE the swap.

- [ ] **`DEPLOYMENT_TRACKER.md` row** updated the moment it merges — this is the `Admin-web (admin.shramsafal.in)` row at line 77, which today reads only "live". It gains its first real release record: SHA, entry-bundle hash before and after, invalidation id, gate verdicts, and the shell-proven versus prod-proven distinction.
- [ ] **Release Record** authored at ship time per rulebook section 4.2.

**Done means live on prod.** Code-complete is not approved; approved is not deployed; written is not live.

---

## Open questions that need the founder, not an agent

1. **D1 dark mode, D3 the wheat shader, D4 the shortcut badges.** Three things that exist today and would be removed. D1 and D3 are working features; D4 is a lie the removal fixes. Each needs an explicit tick.
2. **The facet-count collision (T8 Step 4).** Exact per-option counts over a paginated set need a faceted-count endpoint. Until that exists the counts must be scoped in words ("12 on this page"). Confirm that is acceptable, or commission the endpoint.
3. **The second suffering panel (T20 Step 7).** Keep both the Ops Live panel and /farms/suffering, or cut one. They are not duplicates.
4. **Settings has no data source (T25).** The console shows one source of two and the DB-backed source has never been read because its migration has not been run. Running that migration is a prod DB change and is out of scope here — confirm it stays out.
5. **Waking prod for the deploy proof (Deployment Plan, prerequisite).** Deploy now and prove the shell only, or wake prod for a proving window. Cost matters; the shell-only path is the cheaper one and loses nothing permanent.
