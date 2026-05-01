# T-IGH-04 Sub-plan 04 Frontend Restructure — Pending Tasks

> **Branch:** `feature/ighardening-04-frontend` (parent repo).
> **Worktree:** `.worktrees/ighardening-04-frontend/`.
> **Status:** Tasks 1a, 2, 3, 4, 5 SHIPPED on this branch. Tasks 1b, 6, 7, 8, 9, 10, 11 PENDING (this document).
> **Why this lives here:** the `_COFOUNDER` private vault was dirty with unrelated work when this branch was cut, so per the verifier's instruction we did not write into `_COFOUNDER/.../Pending_Tasks/`. Move this document there once the vault is classified.

---

## What shipped (this branch, 5 commits)

| Commit | Task | Summary |
|---|---|---|
| `00a0670` | 1a — SyncPullReconciler snapshot + test infra | jsdom + fake-indexeddb + testing-library; deterministic snapshot of post-pull Dexie + localStorage state with frozen clock. |
| `d4201c2` | 2 — Crops/Profile/uiPrefs in Dexie | DexieDatabase v13→v14, DexieCropsRepository, DexieProfileRepository, LegacyLocalStorageMigrator (idempotent) wired into DataSourceProvider init. 10 new tests. |
| `e36a3d2` | 3 — localStorage architecture gate | `scripts/check-storage-discipline.mjs` (strict; 21 pre-existing violators allow-listed and tagged with this pending task code), `useUiPref` hook, CI wired in `eslint.yml` mobile-web-lint job. |
| `4e1f237` | 4 — XState root store + syncMachine + worker bridge | xstate@5.31, @xstate/react@6.1; syncMachine (idle/syncing/conflict/offline) with 8 tests; RootStore singleton; BackgroundSyncWorker emits TRIGGER / MUTATION_REJECTED / SYNC_DONE. |
| `8ffbcd7` | 5 — OfflineConflictPage + ConflictResolutionService + ConflictBadge | Marathi-first UX, retry/discard via mutationQueue, badge subscribed to syncMachine. New AppRoute `'offline-conflicts'` wired into AppRouter. 3 new tests. |

**Worktree gates (verified `8ffbcd7`):** `tsc --noEmit` clean · `vitest run` 8 files / 32 tests · `check:storage-discipline` OK (21 allow-listed) · `check:file-sizes` OK (still at 2600 cap; tighten in Task 10).

---

## Pending Tasks

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
Session A:  T-IGH-04-PROFILE-SNAPSHOT       (~2h, sequential)
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

**Total remaining:** ~14-16 hours of focused work, compressing to ~6-8h with sub-agent parallelism in Sessions B and C.

---

## Master plan integration (when _COFOUNDER unlocks)

When the vault dirty-state is classified, update `_COFOUNDER/Projects/AgriSync/Operations/Plans/INDUSTRY_GRADE_HARDENING_2026-04-27/00_MASTER_INDEX.md` row for **04 Frontend Restructure**:

```
Status: PARTIAL — Tasks 1a, 2, 3, 4, 5 SHIPPED on feature/ighardening-04-frontend
        (worktree, 5 commits 00a0670..8ffbcd7). Tasks 1b, 6, 7, 8, 9, 10
        and DoD verification deferred to follow-up sessions per
        docs/T-IGH-04-PENDING-TASKS.md.
```

Move this document into `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/` and update its `_INDEX.md`.

---

## Branch handling

- **Branch:** `feature/ighardening-04-frontend` is isolated in `.worktrees/ighardening-04-frontend/`.
- **Merge into `akash_edits`:** wait until at least Tasks 6 + 7 + 8 land — these are the heaviest decompositions and merging the foundation alone leaves the master-plan DoD unfulfilled.
- **Push to origin:** not done by this session. User decision; the verifier brief did not explicitly authorize push.
- **Pre-existing flake noted:** `SyncMutationCatalog.contract.test.ts > legacy module AgriSyncClient re-exports SyncMutationType from catalog` times out at 5s under cold full-suite vitest run (passes in 246ms isolated). Resolves naturally when AgriSyncClient is decomposed in T-IGH-04-FILE-DECOMPOSE.

---

*Authored 2026-05-01 by Claude Opus 4.7 in worktree session 1. Five Plan 04 tasks landed; remaining work documented for future-session continuity.*
