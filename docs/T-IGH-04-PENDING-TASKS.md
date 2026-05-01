# T-IGH-04 Sub-plan 04 Frontend Restructure — Pending Tasks

> **Branch:** `feature/ighardening-04-frontend` (parent repo).
> **Worktree:** `.worktrees/ighardening-04-frontend/`.
> **Status:** **PARTIAL_FOUNDATION** — Tasks 1a, 2, 3, 4, 5 LANDED on this branch but each carries its own remaining work toward Plan 04 DoD. Earlier wording said "SHIPPED" — that was an overclaim per the 2026-05-01 verifier round. See "Foundation reality check" below.
> **Why this doc lives here:** the `_COFOUNDER` private vault was dirty with unrelated work when this branch was cut, so per the verifier's instruction we did not write into `_COFOUNDER/.../Pending_Tasks/`. Move this document there once the vault is classified.

---

## Branch base divergence (FIX BEFORE NEXT SESSION)

`feature/ighardening-04-frontend` was branched from `akash_edits` at `b41e1c8` on 2026-05-01. Since then `akash_edits` advanced by **two commits** (both Sub-plan 05 PREP continuations, not Plan 04):

```
5e270b1 ci: add e2e/lighthouse/zap workflow scaffolds (workflow_dispatch only)
ffa9352 feat(e2e-api): /__e2e/{reset,seed,fail-pushes,status} env-gated (Sub-plan 05 Task 2)
```

**Action before next Plan 04 session:**
1. Confirm classification (these are 05 PREP_READY, no Plan 04 collisions).
2. Rebase `feature/ighardening-04-frontend` onto current `akash_edits` head (`5e270b1`).
3. Re-run all four pre-flight gates after rebase: mobile-web tsc, mobile-web vitest, marketing-web tsc, dotnet test Release.
4. Verify the post-rebase Task 1a snapshot still matches (no drift introduced by rebase).

---

## Foundation reality check (per 2026-05-01 verifier round)

Each landed task has remaining work before it satisfies Plan 04 DoD:

| Task | Landed | Remaining toward DoD |
|---|---|---|
| **1a** SyncPullReconciler snapshot + test infra | ✅ behavioral lock + jsdom/fake-indexeddb/testing-library scaffold | none — this one is fully done as scoped |
| **1b** ProfilePage TestProviders + tabs snapshot | ❌ **NOT LANDED** | All of it. Filed as `T-IGH-04-PROFILE-SNAPSHOT` below. Prereq for Task 6. |
| **2** Crops/Profile/uiPrefs in Dexie | ✅ schema v14 + repos + migrator | T-IGH-04-LEGACY-STORAGE-CLEANUP — drop the legacy `crops` and `farmer_profile` localStorage keys after one release of soak. |
| **3** localStorage architecture gate | ✅ **NEW-violation gate only** | Allow-list still has **21 entries**. Plan 04 DoD says "`localStorage.*` only inside `infrastructure/storage/`" — that requires the allow-list at zero. Filed as `T-IGH-04-LOCALSTORAGE-MIGRATION`. |
| **4** XState root store + syncMachine + worker bridge | ✅ machine in tree + worker emits events | **Conflict status durability is broken** — see `T-IGH-04-CONFLICT-STATUS-DURABILITY` (P0). Without it, the conflict UX shipped in Task 5 is racy. |
| **5** OfflineConflictPage + ConflictResolutionService + ConflictBadge | ✅ all three components + route exists | Two gaps: (a) `ConflictBadge` is **created but not mounted** in the app shell (`T-IGH-04-CONFLICT-BADGE-MOUNT`); (b) the rejected state the page surfaces is non-durable, see `T-IGH-04-CONFLICT-STATUS-DURABILITY` (P0). |

## What landed (this branch, 6 commits)

| Commit | Task | Summary |
|---|---|---|
| `00a0670` | 1a — SyncPullReconciler snapshot + test infra | jsdom + fake-indexeddb + testing-library; deterministic snapshot of post-pull Dexie + localStorage state with frozen clock. |
| `d4201c2` | 2 — Crops/Profile/uiPrefs in Dexie | DexieDatabase v13→v14, DexieCropsRepository, DexieProfileRepository, LegacyLocalStorageMigrator (idempotent) wired into DataSourceProvider init. 10 new tests. |
| `e36a3d2` | 3 — localStorage NEW-violation gate | `scripts/check-storage-discipline.mjs` (strict on new violations; 21 pre-existing allow-listed and tagged), `useUiPref` hook, CI wired in `eslint.yml` mobile-web-lint job. |
| `4e1f237` | 4 — XState root store + syncMachine + worker bridge | xstate@5.31, @xstate/react@6.1; syncMachine (idle/syncing/conflict/offline) with 8 tests; RootStore singleton; BackgroundSyncWorker emits TRIGGER / MUTATION_REJECTED / SYNC_DONE. |
| `8ffbcd7` | 5 — OfflineConflictPage + ConflictResolutionService + ConflictBadge | Marathi-first UX, retry/discard via mutationQueue, badge subscribed to syncMachine. New AppRoute `'offline-conflicts'` wired into AppRouter. 3 new tests. **Conflict status durability NOT addressed (see T-IGH-04-CONFLICT-STATUS-DURABILITY).** |
| `e8b7334` | docs: pending-tasks handoff (this file, original version) | superseded by the current edit. |

**Worktree gates (verified `8ffbcd7`):** `tsc --noEmit` clean · `vitest run` 8 files / 32 tests · `check:storage-discipline` OK (**21 allow-listed**) · `check:file-sizes` OK (still at 2600 cap; tighten in Task 10 after decompositions land).

---

## Pending Tasks

### T-IGH-04-CONFLICT-STATUS-DURABILITY (P0 — blocks Task 5 DoD)

**Origin:** 2026-05-01 verifier round. Surfaced when reviewing Session 1's
Task 5 against Plan 04's intended state-machine semantics.

**The bug:** Plan 04 specified four mutation states — `pending`, `applied`,
`rejected_user_review`, `rejected_dropped` — so server-rejected mutations
remain durably visible to the user until they explicitly retry or discard.
Session 1 shipped the conflict UX (Task 5) over the **existing** status
enum:

```ts
// src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts:57
export type MutationQueueStatus = 'PENDING' | 'SENDING' | 'APPLIED' | 'FAILED';
```

`OfflineConflictPage` reads `FAILED` rows. But `BackgroundSyncWorker.executeCycle`
calls `mutationQueue.markFailedAsPending()` (`MutationQueue.ts:140`) at the
start of every 15-second cycle — flipping every `FAILED` row back to
`PENDING` and auto-retrying it. Net effect:

1. Server rejects mutation → row marked `FAILED`.
2. Within ~15s, next cycle starts → `markFailedAsPending()` resets it to
   `PENDING`.
3. Worker retries the same rejected mutation; if the rejection is
   permanent (e.g., `MUTATION_TYPE_UNIMPLEMENTED`), it cycles `PENDING` →
   `SENDING` → `FAILED` indefinitely.
4. The user sees the conflict row appear and disappear in
   `OfflineConflictPage` depending on which phase of the cycle they
   refresh in — racy and undurable.

The syncMachine's `rejectedMutations` actor context masks this in the
ConflictBadge for a window (the `appendRejection` action de-dupes by
mutationId, so the count stays > 0), but `ConflictResolutionService.list()`
re-queries Dexie on every page mount, exposing the underlying churn.

**Fix:**
1. Extend `MutationQueueStatus`:
   ```ts
   export type MutationQueueStatus =
       | 'PENDING'
       | 'SENDING'
       | 'APPLIED'
       | 'FAILED'                  // transient — eligible for auto-retry
       | 'REJECTED_USER_REVIEW'    // durable — auto-retry skips; user must act
       | 'REJECTED_DROPPED';       // durable terminal — soft-deleted, kept for audit
   ```

2. `BackgroundSyncWorker.pushPendingMutations` decision tree on a
   non-applied result:
   - **Retryable** (network blip, `NO_RESULT`, transient 5xx): mark
     `FAILED`, let `markFailedAsPending()` auto-recover next cycle.
   - **Permanent** (`MUTATION_TYPE_UNKNOWN`, `MUTATION_TYPE_UNIMPLEMENTED`,
     `CLIENT_TOO_OLD`, server-side validation 4xx): mark
     `REJECTED_USER_REVIEW` directly, skip the auto-retry path.
   - The error-code → category mapping should live in
     `infrastructure/sync/RejectionPolicy.ts` (new file) so it's testable
     in isolation.

3. `MutationQueue.markFailedAsPending(maxRetryCount)` filters by status
   `'FAILED'` only; `REJECTED_USER_REVIEW` rows are skipped.

4. `ConflictResolutionService.list()` queries by status
   `'REJECTED_USER_REVIEW'` (not `'FAILED'`).

5. `ConflictResolutionService.retry(id)` flips
   `REJECTED_USER_REVIEW` → `PENDING` and triggers a fresh cycle. Server
   may reject again; categorization still applies.

6. `ConflictResolutionService.discard(id)` flips
   `REJECTED_USER_REVIEW` → `REJECTED_DROPPED` (don't `db.mutationQueue.delete()`
   — keep the row for audit/diagnostics; Sub-plan 05 E2E asserts on it).

7. The dexie schema needs a new index `status` for the rejected lookups
   (existing `[status+createdAt]` covers it; verify).

8. Update `BackgroundSyncWorker`'s `notifySync({ type: 'MUTATION_REJECTED', ...})`
   to fire only when the categorization yields `REJECTED_USER_REVIEW` —
   transient failures shouldn't churn the syncMachine's `conflict` state.

**Tests required:**
- `RejectionPolicy.test.ts` — error-code → category mapping table.
- `MutationQueue.test.ts` — `markFailedAsPending` skips
  `REJECTED_USER_REVIEW`.
- `BackgroundSyncWorker` integration test — push a permanent-rejection
  mutation, run two cycles, assert the row stays `REJECTED_USER_REVIEW`
  and the syncMachine's `rejectedMutations` count is 1.
- `OfflineConflictPage.test.tsx` already mocks the service; no change.

**DoD:**
- Status enum includes `REJECTED_USER_REVIEW` and `REJECTED_DROPPED`.
- Permanent-rejection error codes are categorized in `RejectionPolicy`.
- A permanently-rejected mutation persists across N cycles unchanged.
- `ConflictResolutionService` queries the durable status, not `FAILED`.
- `discard()` is a soft-delete (sets `REJECTED_DROPPED`), not a hard
  `db.mutationQueue.delete()`.

**Estimated effort:** ~2h focused, including tests. Should land before any
Sub-plan 05 E2E asserts on conflict-resolution flow.

---

### T-IGH-04-PROFILE-SNAPSHOT (P1)

**Origin:** Sub-plan 04 Task 1b. Deferred from session 1 because ProfilePage takes 12+ props + 4 hooks (`useLanguage`, `useAuth`, `useFarmContext`, `useWorkerProfile`) + network calls (`inviteApi.{getFarmDetails,updateFarmBoundary,probeFarmWeather}`) + direct localStorage reads (`WEATHER_CONNECTED_KEY`). A real DOM snapshot demands a TestProviders fixture with mocks for each — ~2h focused work.

**Scope:**
1. Create `src/shared/test/TestProviders.tsx` wrapping `I18nextProvider`, a stub `AuthProvider`, a stub `DataSourceProvider`, and `AppFeatureContexts` minimally enough to render any Page. Use `vi.mock` for `inviteApi` and `useWorkerProfile`. Provide a `MemoryFakeDataSource` that returns deterministic empty crops + profile.
2. Create `src/pages/__snapshots__/ProfilePage.snapshot.test.tsx` matching the plan's example. Use `it.each` over the 8 tabs.
3. Snapshots live with the test file under `__snapshots__/`.
4. Keep this as Task 6's prerequisite — landing 6 without 1b means we lose the regression safety net for the 8-section split.

**DoD:** All 8 tab snapshots stable across 3 consecutive `npx vitest run` invocations. Snapshots include only DOM, not GSAP/animation transient state.

---

### T-IGH-04-PROFILE-DECOMPOSE (Plan Task 6, P1)

**Origin:** Sub-plan 04 Task 6. ProfilePage.tsx is 2491 lines; target is orchestrator ≤250 + 8 sections + 2 hooks per the layout in the plan.

**Pre-req:** T-IGH-04-PROFILE-SNAPSHOT (above) — without it, the split has no regression safety net.

**Scope:** the plan's task layout is correct. Sections to extract:
- IdentitySection, StructureSection, UtilitiesSection, PlanSection,
  MachinesSection, HealthSection, IntelligenceSection, PeopleSection
- Hooks: `useProfileData`, `useFarmStructure`
- Wizards extracted to `features/profile/components/`: `WaterSourceWizard`,
  `AddPlotWizard`, `AddMachineWizard`

**Watch-out:** ProfilePage takes large prop sets from `AppRouter`. Move these to `useProfileData`/`useFarmStructure` and consume from contexts. Some props (e.g., `onOpenScheduleLibrary`) should remain because they cross-cut into `AppRouter`'s navigation — leave them as-is for now; T-IGH-04-XSTATE-NAV migrates these later.

**DoD:** ProfilePage.tsx ≤ 250 lines. All 8 section files exist, each ≤ 500 lines. Snapshot tests still pass with no diffs (the move must be behavior-neutral). `node scripts/check-file-sizes.mjs` passes at MAX_LINES=800.

---

### T-IGH-04-SYNC-PULL-DECOMPOSE (Plan Task 7, P1)

**Origin:** Sub-plan 04 Task 7. SyncPullReconciler.ts is 1150 lines; target is orchestrator ≤250 + 10 reconcilers/helpers per the plan.

**Pre-req:** none — Task 1a (`SyncPullReconciler.behavior.test.ts`) shipped on this branch. The snapshot is already locked.

**Scope:** Per plan layout:
- `features/sync/pull/SyncPullReconciler.ts` (orchestrator)
- `features/sync/pull/reconcilers/{farm,plot,cropCycle,dailyLog,attachment,costEntry,plannedActivity,attentionBoard,referenceData,profile}Reconciler.ts`
- `features/sync/pull/helpers/{mapVerificationStatus,mapAttachmentStatus,normalizeActivityType,purveshDemoEnrichment}.ts`

**Migration step:** the existing localStorage allow-list entry for `infrastructure/sync/SyncPullReconciler.ts` will need to be re-pointed to the new path (or, ideally, the localStorage calls will be eliminated during the split via DexieCropsRepository / DexieProfileRepository — Task 2 unlocks this).

**DoD:** Each file ≤ 250 lines for the orchestrator, ≤ 500 for reconcilers. `SyncPullReconciler.behavior.test.ts` snapshot still passes with no diffs. localStorage allow-list shrinks by 1 (or the entry is re-pointed to the new path).

---

### T-IGH-04-ROUTER-DECOMPOSE (Plan Task 8, P1)

**Origin:** Sub-plan 04 Task 8. AppRouter.tsx is 1274 lines; AppContent.tsx is small but tangled. Target: routes-as-data + slim shell.

**Scope:**
- `core/navigation/routes.ts` — `ROUTES: ReadonlyArray<RouteEntry>` data, exported.
- `core/navigation/AppRouter.tsx` — ≤ 250 lines, switches to ROUTES table.
- `app/AppContent.tsx` — ≤ 250 lines, mounts `<AppRouter />` inside an `<AppShell />` and surfaces `<ConflictBadge />` (Task 5 left this unmounted; this task wires it).

**Watch-outs:**
- `useAgriLogApp` is a giant hook; the plan suggests splitting it into smaller hooks (`useAppNavigation`, `useAppData`, etc.). Many already exist; keep that work focused — only split what AppContent actually pulls in.
- `setCurrentRoute` is the navigation primitive today; wiring it through `<RouteEntry guard='auth'>` requires adding an auth-aware lookup. T-IGH-04-XSTATE-NAV will migrate this to a `navigationMachine`; for now keep the `setCurrentRoute` callback shape.

**DoD:** Both files ≤ 250 lines. ConflictBadge mounted in AppHeader's top-right slot with `onClick={() => setCurrentRoute('offline-conflicts')}`. All existing routes still navigate.

---

### T-IGH-04-FILE-DECOMPOSE (Plan Task 9, P1)

**Origin:** Sub-plan 04 Task 9. Verifier expanded the plan's named "ActivityCard only" to include 5 more files. A fresh worktree audit found 2 additional offenders.

**Current >800-line offenders (post-Tasks 6/7/8 they shrink to this set):**

| File | Lines | Plan source |
|---|---|---|
| `features/logs/components/ActivityCard.tsx` | 2025 | Plan Task 9 (named) |
| `pages/ReflectPage.tsx` | 1453 | Verifier-added |
| `features/logs/components/ManualEntry.tsx` | 1258 | Verifier-added |
| `infrastructure/api/AgriSyncClient.ts` | 1092 | Verifier-added |
| `pages/ComparePage.tsx` | 1014 | Verifier-added |
| `infrastructure/storage/DexieDatabase.ts` | 944 | Verifier-added |
| `features/analysis/components/CostAnalysisSection.tsx` | 865 | Newly found in worktree audit |
| `core/domain/LogFactory.ts` | 865 | Newly found in worktree audit |

**Decomposition pattern per file (re-use plan's ActivityCard recipe):**
1. Identify variant branches / responsibilities.
2. Move each variant to its own file (e.g., `features/logs/components/cards/{Irrigation,Spray,Nutrition,Observation,Harvest}Card.tsx`).
3. Original becomes a thin dispatcher (≤ 80 lines).
4. Snapshot test before/after to verify visual identity (where applicable).

**DexieDatabase.ts** is special: the version blocks v1–v14 are duplicative. Extract to `infrastructure/storage/dexie/versions/{v1..v14}.ts` with one `version(N).stores(...)` per file; `DexieDatabase.ts` orchestrates only.

**AgriSyncClient.ts** is the API SDK. Split by resource: `infrastructure/api/{auth,sync,attachments,ai}/*.ts`. Re-export from a slim `AgriSyncClient.ts` for backwards-compat during transition.

**LogFactory.ts** + **CostAnalysisSection.tsx** are smaller; trim is fine — extract internal helpers to colocated files.

**DoD:** `node scripts/check-file-sizes.mjs` with `MAX_LINES=800` reports no offenders. Snapshot tests for any decomposed UI components still pass.

**Parallelizable:** yes. Each of the 8 files is independent. Sub-agent per file is the recommended path.

---

### T-IGH-04-LOCALSTORAGE-MIGRATION (P1, drain Task 3 allow-list)

**Origin:** Task 3 shipped with 21 pre-existing violators allow-listed (`scripts/check-storage-discipline.mjs`). Each must be migrated through `useUiPref`, a Dexie repo, or a purpose-named storage adapter under `infrastructure/storage/`.

**Drain plan (group by area):**

| Area | Files | Migration target |
|---|---|---|
| pages/ | SettingsPage, OnboardingPermissions, JoinFarmLanding, Profile, Reflect | `useUiPref` hook |
| services/ | harvestService, procurementRepository | scheduled for **deletion** in Task 10 (no migration needed — drop with the file) |
| i18n/ | LanguageContext | `useUiPref('language', defaultLang)` |
| features/ | finance/financeService, onboarding/qr/farmInviteStore, voice/vocab/vocabStore | per-feature Dexie repos under `infrastructure/storage/` |
| core/ | data/LocalDB, navigation/AppRouter, session/FarmContext | `LocalDB.ts` is itself storage — relocate wholesale to `infrastructure/storage/`. `FarmContext`'s `shramsafal_current_farm_id` → new `infrastructure/storage/SessionStore.ts`. `AppRouter` deferred to T-IGH-04-ROUTER-DECOMPOSE. |
| infrastructure/sync | MutationQueue, SyncPullReconciler | MutationQueue: keep but isolate the localStorage line behind a method call to a new `infrastructure/storage/MutationQueueMeta.ts`. SyncPullReconciler: deferred to T-IGH-04-SYNC-PULL-DECOMPOSE. |
| infrastructure/api | AuthTokenStore | Move file wholesale to `infrastructure/storage/AuthTokenStore.ts` (one-line rename). |
| shared/ | services/NotificationService, components/ui/CollapsibleBlock | `useUiPref` hook |
| app/ | providers/DataSourceProvider | demo seed flags → new `infrastructure/storage/DemoModeStore.ts` |
| AppContent.tsx | top-level | `shramsafal_current_farm_id` → `SessionStore` |

**DoD:** Allow-list in `scripts/check-storage-discipline.mjs` is empty (or contains only entries with explicit infinite-future justifications, none expected). Storage gate runs in strict mode with no waivers.

**Parallelizable:** yes — each area is independent.

---

### T-IGH-04-LEGACY-SERVICES (P2, drop legacy services)

**Origin:** Plan Task 10's restricted-imports rule warns on `services/harvestService` and `services/procurementRepository` imports. After all consumers migrate to feature hooks, delete those two files. Pairs naturally with T-IGH-04-LOCALSTORAGE-MIGRATION (services/ row).

**DoD:** Files deleted; no remaining imports (grep zero).

---

### T-IGH-04-XSTATE-NAV (P2, plan-named follow-up)

**Origin:** Plan Task 11. AppRouter today does an ad-hoc switch on `currentRoute` string. Migrate to a `navigationMachine` actor mounted alongside `syncMachine` in `RootStore`.

**DoD:** AppRouter consumes `useSelector(rootStore.nav, ...)` instead of `setCurrentRoute`. All current navigation transitions still work.

---

### T-IGH-04-CONFLICT-EDIT (P2, plan-named follow-up)

**Origin:** Plan Task 11. Today OfflineConflictPage offers retry/discard. Add an "edit and retry" affordance — open a side sheet to mutate the payload before re-queueing.

**DoD:** Edit sheet renders for any of the canonical mutation types; saved edit re-queues with a new `clientRequestId`.

---

### T-IGH-04-CONFLICT-BADGE-MOUNT (P2, surfaced during Task 5)

**Origin:** Task 5 shipped `<ConflictBadge />` but didn't mount it in the app shell because AppHeader/AppContent are tangled with Task 8. Pairs with T-IGH-04-ROUTER-DECOMPOSE: when AppContent slims down, mount the badge in its top-right slot with `onClick={() => setCurrentRoute('offline-conflicts')}`.

**DoD:** Badge visible in app shell when there are unresolved conflicts; tap routes to `'offline-conflicts'`.

---

### T-IGH-04-LEGACY-STORAGE-CLEANUP (P3, post-soak)

**Origin:** Task 2 commit. After one release of soak, delete the legacy localStorage `crops` and `farmer_profile` keys (currently kept as a safety net by `LegacyLocalStorageMigrator` so the migration is reversible).

**DoD:** Two `localStorage.removeItem` calls added to `LegacyLocalStorageMigrator`'s post-migration step; flag bumped to `agrisync_legacy_storage_migrated_v2`.

---

### T-IGH-04-ESLINT-TIGHTEN (Plan Task 10, P1, depends on Tasks 6-9)

**Origin:** Plan Task 10. Drop `--max-warnings 9999` to `--max-warnings 50` (Sub-plan 05 tightens to 0). Add `no-restricted-imports` rules per plan §Task 10 step 2.

**Cannot ship yet:** until Tasks 6/7/8/9 land, the legacy imports the rule restricts (`*/services/harvestService*`, `*/services/procurementRepository*`, `../*pages/*`) are still in use.

**DoD:** ESLint passes with `--max-warnings 50`. Restricted-import rule errors on any new violation.

---

## Recommended execution order (next sessions)

```
Session A0 (BEFORE anything else):
            Rebase feature/ighardening-04-frontend onto current akash_edits
            (5e270b1) and re-run all four pre-flight gates. ~15 min.

Session A:  T-IGH-04-CONFLICT-STATUS-DURABILITY  (~2h, P0, sequential)
            ↑ Closes Task 5's architectural gap before anything else
              builds on the conflict UX.
            T-IGH-04-PROFILE-SNAPSHOT       (~2h, sequential)
            T-IGH-04-PROFILE-DECOMPOSE      (~3h, sequential, after snapshot)

Session B:  3 parallel sub-agents on
            - T-IGH-04-SYNC-PULL-DECOMPOSE  (~2h)
            - T-IGH-04-ROUTER-DECOMPOSE     (~2h)
            - T-IGH-04-FILE-DECOMPOSE       (~3h split across 8 sub-agents)

Session C:  T-IGH-04-LOCALSTORAGE-MIGRATION (~3h, parallel by area)
            T-IGH-04-LEGACY-SERVICES        (~30m, after migration)
            T-IGH-04-CONFLICT-BADGE-MOUNT   (~15m, after router decomp)

Session D:  T-IGH-04-ESLINT-TIGHTEN         (~30m, after Sessions A-C)
            DoD verification + finishing-a-development-branch handoff
            Master index update (after _COFOUNDER classification clears)

Backlog:    T-IGH-04-XSTATE-NAV             (P2)
            T-IGH-04-CONFLICT-EDIT          (P2)
            T-IGH-04-LEGACY-STORAGE-CLEANUP (P3, post-soak)
```

**Total remaining:** ~16-18 hours of focused work (Session A grew by ~2h
for T-IGH-04-CONFLICT-STATUS-DURABILITY), compressing to ~7-9h with
sub-agent parallelism in Sessions B and C.

---

## Master plan integration (when _COFOUNDER unlocks)

When the vault dirty-state is classified, update `_COFOUNDER/Projects/AgriSync/Operations/Plans/INDUSTRY_GRADE_HARDENING_2026-04-27/00_MASTER_INDEX.md` row for **04 Frontend Restructure**:

```
Status: PARTIAL_FOUNDATION — Tasks 1a, 2, 3, 4, 5 LANDED on
        feature/ighardening-04-frontend (worktree, 6 commits
        00a0670..e8b7334; doc edits in subsequent commits). Each landed
        task carries remaining work toward Plan 04 DoD:
          - Task 3: gate enforces NEW violations only; allow-list of 21
            entries drains in T-IGH-04-LOCALSTORAGE-MIGRATION.
          - Task 5: badge created but not mounted; rejected-state
            durability gap blocks DoD (T-IGH-04-CONFLICT-STATUS-DURABILITY,
            P0).
          - Tasks 1b, 6, 7, 8, 9, 10 and DoD verification deferred to
            follow-up sessions per docs/T-IGH-04-PENDING-TASKS.md.
        Branch base is b41e1c8; rebase onto 5e270b1 before next session.
```

Move this document into `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/` and update its `_INDEX.md`.

---

## Branch handling

- **Branch:** `feature/ighardening-04-frontend` is isolated in `.worktrees/ighardening-04-frontend/`.
- **Base:** branched from `akash_edits` at `b41e1c8` on 2026-05-01. **Out of date** — `akash_edits` head is now `5e270b1` (two new 05 PREP commits, see "Branch base divergence" at top). **Rebase before next Plan 04 session.**
- **Merge into `akash_edits`:** wait until at least T-IGH-04-CONFLICT-STATUS-DURABILITY (P0) lands plus Tasks 6 + 7 + 8 — the heaviest decompositions. Merging the foundation alone leaves Plan 04 DoD unfulfilled and the conflict UX architecturally racy.
- **Push to origin:** not done by this session. User decision; the verifier brief did not explicitly authorize push.
- **Plan 05 status:** PREP_READY only; the new local commits on `akash_edits` are 05 PREP continuation, not 05 green. Do not write specs against Plan 04 selectors/screens until Tasks 6-9 stabilize them. Do not assert E2E against the conflict UX until T-IGH-04-CONFLICT-STATUS-DURABILITY lands.
- **Pre-existing flake noted:** `SyncMutationCatalog.contract.test.ts > legacy module AgriSyncClient re-exports SyncMutationType from catalog` times out at 5s under cold full-suite vitest run (passes in 246ms isolated). Resolves naturally when AgriSyncClient is decomposed in T-IGH-04-FILE-DECOMPOSE.

---

*Originally authored 2026-05-01 by Claude Opus 4.7 in worktree session 1. Updated 2026-05-01 (same session, post-verifier round) to correct overclaimed wording — Tasks 1-5 are PARTIAL_FOUNDATION, not fully shipped against Plan 04 DoD; T-IGH-04-CONFLICT-STATUS-DURABILITY (P0) added; branch base divergence noted.*
