# T-IGH-04 Sub-plan 04 Frontend Restructure — Pending Tasks (post-rebase)

> **Branch:** `feature/ighardening-04-frontend` (parent repo).
> **Worktree:** `.worktrees/ighardening-04-frontend/`.
> **Status:** **PARTIAL_FOUNDATION** — rebase done, P0 conflict durability landed. Tasks 6–10 remain.
> **Why this doc lives here:** the `_COFOUNDER` private vault is dirty with unrelated work, so per the verifier instruction we did not write into `_COFOUNDER/.../Pending_Tasks/`. Move this document there once the vault is classified.

---

## Execution stance (Akash, 2026-05-01, unchanged)

**Plan 04 continues now. Do not wait for full Plan 03 completion.**

Plan 04's direct frontend dependencies are stable on `akash_edits`: sync mutation catalog, error/problem details, degraded headers, cursor-freeze behavior, backend CI baseline, and (newly landed) Plan 03 Task 9 analytics migration (`e75960f`).

**Continue:** T-IGH-04-PROFILE-DECOMPOSE, T-IGH-04-SYNC-PULL-DECOMPOSE, T-IGH-04-ROUTER-DECOMPOSE, T-IGH-04-FILE-DECOMPOSE, T-IGH-04-LOCALSTORAGE-MIGRATION, T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE.

**Do NOT claim:** Plan 03 REMOTE_GREEN, Plan 04 DONE, Plan 05 final E2E green, master plan complete.

The label stays **PARTIAL_FOUNDATION / READY_WITH_CAVEATS** until both Plan 04 DoD and Plan 03 Task 11 (OTel smoke) close.

---

## Branch state (current)

`feature/ighardening-04-frontend` has eight commits on top of `akash_edits` head `930742e`:

```
d558843 refactor(sync): T-IGH-04-SYNC-PULL-DECOMPOSE — extract 6 helper modules from SyncPullReconciler
2168dd5 docs(plan-04): rewrite handoff for post-rebase + P0 landed state
20c765a test(sync): worker-flow integration for T-IGH-04-CONFLICT-STATUS-DURABILITY
acb8208 feat(sync): T-IGH-04-CONFLICT-STATUS-DURABILITY (P0) — durable rejected_user_review state
c60c0d3 test(deps): add @testing-library/{user-event,jest-dom} + per-file jsdom directive (T-IGH-04 Task 5 finalize)
34be159 feat(sync): T-IGH-04 Task 5 — OfflineConflictPage + ConflictResolutionService + ConflictBadge
87b5430 feat(state): T-IGH-04 Task 4 — XState root store + syncMachine + worker bridge
2be44a9 ci(storage): T-IGH-04 Task 3 — strict localStorage discipline gate + useUiPref hook
```

**Worktree gates (verified `20c765a`):**
- `tsc --noEmit` silent (exit 0)
- `vitest run` **12 files / 55 tests green**
- `check:storage-discipline` OK (21 allow-listed, unchanged)
- `check:file-sizes` OK at 2600 cap (tighten in Task 10)

**Important:** the previous worktree branch tip (`b3d57e6`) is preserved at the tag `pre-rebase-snapshot-2026-05-01` for emergency recovery. It is no longer the canonical head.

---

## What landed on this branch (vs upstream)

| Commit | Task | Tests added | Net diff |
|---|---|---|---|
| `2be44a9` | Task 3 — strict localStorage gate + `useUiPref` hook + CI wiring | 0 | +151 |
| `87b5430` | Task 4 — XState `RootStore` + `syncMachine` (4 states) + worker bridge | +8 | +365 / −6 |
| `34be159` | Task 5 — `OfflineConflictPage` + `ConflictResolutionService` + `ConflictBadge` + `'offline-conflicts'` route | +3 | +373 |
| `c60c0d3` | Test infra finalize: `@testing-library/{user-event,jest-dom}` + per-file `// @vitest-environment jsdom` directive | 0 | +66 |
| `acb8208` | **P0 conflict status durability** — extend `MutationQueueStatus` to `\| REJECTED_USER_REVIEW \| REJECTED_DROPPED`, add `RejectionPolicy.ts`, branch worker on category, soft-delete on discard | +17 | +515 / −38 |
| `20c765a` | P0 worker integration — full state-machine lock end-to-end | +4 | +260 |
| `d558843` | **Sync pull helper extraction** — 6 helpers pulled out, SyncPullReconciler 1150 → 721 lines (below 800 cap) | 0 (snapshot still green) | +549 / −449 |

**Test count progression (on this branch):** 30 baseline → 55 (+25 new tests). Test count unchanged after `d558843` (pure refactor).

**Line-count progression for files this branch touches:**

| File | Pre-rebase | Now | Cap | Status |
|---|---|---|---|---|
| `infrastructure/sync/SyncPullReconciler.ts` | 1150 | **721** | 800 | ✅ below cap |
| Other Plan 04 god-files | unchanged | unchanged | 800 | ⏳ pending — see `T-IGH-04-FILE-DECOMPOSE` below |

---

## What this rebase chose (design reconciliation)

`akash_edits` head moved from `b41e1c8` → `930742e` while the original worktree was active. Several upstream commits **duplicated** the worktree's Task 1a + Task 2 work (synthetic snapshot baseline + Dexie schema + repos + migrator). Two design choices landed upstream and the rebase resolves in their favor:

1. **Vitest env: per-file `// @vitest-environment jsdom`, not global jsdom.** Upstream `19a31b9` keeps `vitest.config.ts` global env as `'node'` so the existing 8 contract tests stay fast on cold start. React-rendering tests opt into jsdom with the per-file directive. The rebase dropped the worktree's global-env switch and added the directive to `OfflineConflictPage.test.tsx`.
2. **Task 1 baseline snapshots: shipped narrowly upstream, not by the worktree.** Upstream `c5c1640` (SyncPullReconciler) and `9569047` (ProfilePage smoke) shipped the baselines using vi.mock for the heavyweight subcomponent tree. The worktree's Task 1a commit was dropped. Per `9569047`'s commit message, **per-tab ProfilePage snapshots are explicitly deferred to Task 6** (each section becomes a leaf component that's cheap to mock and snapshot meaningfully).
3. **Task 2 cutover: Path-1-narrow.** Upstream's `930742e` lands `LegacyLocalStorageMigrator` as a tested but **dormant** module. The cutover (DexieDataSource swap + DataSourceProvider wiring + SyncPullReconciler localStorage-write retirement) is deferred to `T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE` (see pending task below). The worktree's Task 2 commit was dropped because it conflicted with this scoping.

---

## Pending Tasks

### T-IGH-04-CONFLICT-STATUS-DURABILITY (DONE on this branch — no longer P0 follow-up)

**Origin:** 2026-05-01 verifier round (P0 architectural gap).

**What shipped (`acb8208` + `20c765a`):**
- `MutationQueueStatus` extended with `REJECTED_USER_REVIEW` and `REJECTED_DROPPED`.
- `infrastructure/sync/RejectionPolicy.ts` categorizes server rejections as `RETRYABLE` vs `PERMANENT`. Permanent codes: `CLIENT_TOO_OLD`, `CLIENT_OUTDATED`, `MUTATION_TYPE_UNKNOWN`, `MUTATION_TYPE_UNIMPLEMENTED`, `PAYLOAD_SCHEMA_MISMATCH`, `INVALID_COMMAND`, `INVALID_PAYLOAD`, `VALIDATION_FAILED`, `FORBIDDEN`, `UNAUTHORIZED`, `CONFLICT`, `DUPLICATE_KEY`, `NOT_FOUND`, `GONE`. Empty inputs and unknown codes fall back to `RETRYABLE` (fail-safe toward retry, not park).
- `BackgroundSyncWorker.pushPendingMutations` branches on category. Permanent → `markRejectedUserReview` + `notifySync MUTATION_REJECTED`. Transient → existing `markFailed` (auto-retry path).
- `MutationQueue.markFailedAsPending` filters strictly by `status === 'FAILED'`; durable rows are NEVER auto-retried.
- `ConflictResolutionService.list()` queries `getRejectedUserReview()`. `discard()` soft-deletes via `markRejectedDropped()` (keeps row for audit + Sub-plan 05 E2E assertion).
- 17 new unit + 4 integration tests lock the contract.

**Followups:** `T-IGH-04-CONFLICT-EDIT` (P2, edit-and-retry affordance), `T-IGH-04-CONFLICT-BADGE-MOUNT` (P2, mount badge in app shell).

---

### T-IGH-04-PROFILE-SNAPSHOT (SUPERSEDED by upstream amendment)

**What changed:** Originally filed as a P1 prerequisite for Task 6 (decompose ProfilePage). Upstream `9569047` shipped the structure-tab smoke snapshot with the explicit amendment: *"per-tab snapshots are deferred to Task 6 where each section becomes a leaf component cheap to snapshot meaningfully."*

**Action:** Don't extend the smoke test to all 8 tabs in a separate task. Land the per-section snapshots inside Task 6 as each tab moves to its own file.

---

### T-IGH-04-PROFILE-DECOMPOSE (Plan Task 6, P1)

ProfilePage.tsx is 2491 lines; target is orchestrator ≤ 250 + 8 sections + 2 hooks (`useProfileData`, `useFarmStructure`). Use the existing `initialTab` seam from `fadfe86` and `TestProviders` from `b1a4095`. Each section becomes a leaf component that gets its own snapshot test on the way through.

**Watchouts:** ProfilePage takes 12+ props from AppRouter. Keep the cross-cutting ones (e.g., `onOpenScheduleLibrary`) as callback props — `T-IGH-04-XSTATE-NAV` will migrate them to the navigationMachine later.

---

### T-IGH-04-SYNC-PULL-DECOMPOSE (Plan Task 7, P1) — PARTIALLY DONE

**What landed in session 2 (`d558843`):** Helper extraction phase. Six modules pulled out of `SyncPullReconciler.ts`:

| Helper | Lines | Source |
|---|---|---|
| `helpers/mapVerificationStatus.ts` | 38 | extracted verbatim |
| `helpers/mapAttachmentStatus.ts` | 24 | extracted verbatim |
| `helpers/normalizeActivityType.ts` | 44 | normalize + 4 isXActivity predicates |
| `helpers/operatorRole.ts` | 49 | mapOperatorRole + capabilitiesForRole |
| `helpers/cropIdentity.ts` | 61 | toCropId + pickIconName + normalizeCropTypeKey + readCropTypeReferences |
| `helpers/plotSchedule.ts` | 94 | defaultPlotSchedule + ensureCrop + upsertPlot + CROP_COLORS |
| `helpers/purveshDemoEnrichment.ts` | 175 | isPurveshDemoOwner + buildDefaults + fillMissing + enrichCrops |

**Result:** SyncPullReconciler.ts went from **1150 → 721 lines** (below the 800 cap). Upstream `c5c1640` snapshot test still green; all 55 vitest tests pass.

#### T-IGH-04-SYNC-PULL-DECOMPOSE-PHASE-2 (remaining)

The plan's full target was orchestrator + **10 per-resource reconciler files** under `features/sync/pull/reconcilers/`. The composite helpers (`buildProfileFromSync`, `toDailyLog`, `readExistingProfile/writeProfile`, `readExistingCrops/writeCrops`) and the orchestrator body still live inline in `SyncPullReconciler.ts`. Splitting them into per-resource reconciler functions (farmReconciler, plotReconciler, cropCycleReconciler, dailyLogReconciler, attachmentReconciler, costEntryReconciler, plannedActivityReconciler, attentionBoardReconciler, referenceDataReconciler, profileReconciler) is the next phase.

Pairs naturally with `T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE` — the per-resource reconciler split is the natural place to redirect each `localStorage.setItem` call to its Dexie repo. Doing both at once avoids two separate touches of the reconciler.

---

### T-IGH-04-ROUTER-DECOMPOSE (Plan Task 8, P1)

AppRouter.tsx is 1274 lines (massive `currentRoute === '...'` if-cascade). Target: `core/navigation/routes.ts` data table + slim `AppRouter.tsx` ≤ 250 lines. Pairs with `T-IGH-04-CONFLICT-BADGE-MOUNT` (mount the badge in AppHeader's top-right slot once `AppContent` slims down).

---

### T-IGH-04-FILE-DECOMPOSE (Plan Task 9, P1)

Verifier-expanded set of 8 god-files needing decomposition (last audit 2026-05-01, lines may have drifted slightly post-rebase):

| File | Lines (last audit) |
|---|---|
| `features/logs/components/ActivityCard.tsx` | 2025 |
| `pages/ReflectPage.tsx` | 1453 |
| `features/logs/components/ManualEntry.tsx` | 1258 |
| `infrastructure/api/AgriSyncClient.ts` | 1092 |
| `pages/ComparePage.tsx` | 1014 |
| `infrastructure/storage/DexieDatabase.ts` | 944 |
| `features/analysis/components/CostAnalysisSection.tsx` | 865 |
| `core/domain/LogFactory.ts` | 865 |

Each is independent — sub-agent parallel.

#### T-IGH-04-FILE-DECOMPOSE-ACTIVITYCARD (sub-task scope)

**Inventory (lines from current branch):**

```
21–50    interface ActivityCardProps                  30 lines
51–233   const BucketItem = (...) => { ... }          183 lines  (leaf)
234–279  const InventorySuggestions = (...) => {...}  46 lines   (leaf)
280–659  const InputDetailSheet = (...) => {...}      380 lines  (uses BucketItem)
660–738  const ExpenseDetailSheet = (...) => {...}    79 lines
739–1177 const DetailSheet = (...) => {...}           439 lines  (uses BucketItem)
1178–1312 const WorkDetailSheet = (...) => {...}      135 lines
1313–2024 const ActivityCard: React.FC<...> = ...     712 lines
2025     export default ActivityCard;
```

**Decomposition plan (target layout under `features/logs/components/activity-card/`):**

```
activity-card/
  ActivityCard.tsx             (orchestrator, ≤ 250)
  ActivityCardProps.ts         (interface)
  components/
    BucketItem.tsx             (leaf)
    InventorySuggestions.tsx   (leaf)
  sheets/
    DetailSheet.tsx            (labour/irrigation/machinery)
    InputDetailSheet.tsx
    ExpenseDetailSheet.tsx
    WorkDetailSheet.tsx
```

**Each sheet is self-contained** — looking at `DetailSheet`'s signature, every consumer prop is passed in (data, defaults, profile, currentPlot, callbacks). No closure-captured state from ActivityCard's body. So each sheet can move file-by-file with `import` updates only — no prop ballooning.

**Order:** extract `BucketItem` first (it's the dep of two sheets), then sheets one at a time, then slim ActivityCard. After `BucketItem` + 4 sheets land, ActivityCard.tsx ≈ 763 lines (below 800).

**Verification:** the codebase has no existing ActivityCard test; behavioral parity rests on visual review during Sub-plan 05 E2E. Worth adding a smoke render test in this task using TestProviders + a minimal CropActivityEvent fixture, even if not snapshot-detailed — at least catches "does it mount" regressions during the sheet moves.

**Why deferred:** session 2 ran out of context after the SyncPullReconciler decomp + the rebase reconciliation work; ActivityCard's 6-sheet move is a clean 60–90 min focused session.

#### T-IGH-04-FILE-DECOMPOSE-EASY-WINS

`CostAnalysisSection.tsx` (865) and `LogFactory.ts` (865) are each only 65 lines over the 800 cap. Each needs a single small extraction (e.g., one helper or one sub-component) to clear the gate. ~15 min each. Lowest-effort wins in this set.

#### T-IGH-04-FILE-DECOMPOSE-DEXIEDB

`DexieDatabase.ts` (944) carries v1–v14 `version(N).stores({...})` blocks — each a structurally similar declaration. Extract to `infrastructure/storage/dexie/versions/{v1..v14}.ts` and have `DexieDatabase.ts` orchestrate via a single import + register loop. Per-version files become ≤ 60 lines each. ~30 min.

#### T-IGH-04-FILE-DECOMPOSE-AGRISYNCCLIENT

`AgriSyncClient.ts` (1092) is the API SDK. Split by resource: `infrastructure/api/{auth,sync,attachments,ai}/*.ts`. Re-export from a slim `AgriSyncClient.ts` for backwards-compat during transition. ~45 min.

#### T-IGH-04-FILE-DECOMPOSE-PAGES

The four `pages/*` god-files (`ReflectPage`, `ManualEntry`, `ComparePage` — note `ManualEntry` lives under `features/logs/components/` not `pages/`, but same pattern) each follow the per-section split pattern from Plan §Task 6. Estimated 60–90 min each.

---

### T-IGH-04-LOCALSTORAGE-MIGRATION (P1, drain Task 3 allow-list)

The Task 3 gate enforces NEW violations only. The 21 pre-existing entries in `scripts/check-storage-discipline.mjs` ALLOWLIST must drain to zero per Plan 04 DoD. Migration plan by area is the same as the previous version of this doc:

- `pages/` → `useUiPref` hook
- `services/` → deletion (legacy services slated for removal)
- `i18n/LanguageContext` → `useUiPref('language', defaultLang)`
- `features/finance/financeService`, `features/onboarding/qr/farmInviteStore`, `features/voice/vocab/vocabStore` → per-feature Dexie repos under `infrastructure/storage/`
- `core/data/LocalDB` → relocate wholesale to `infrastructure/storage/`
- `core/session/FarmContext` → new `infrastructure/storage/SessionStore.ts`
- `core/navigation/AppRouter` → deferred to T-IGH-04-ROUTER-DECOMPOSE
- `infrastructure/sync/MutationQueue` → isolate the localStorage line behind `infrastructure/storage/MutationQueueMeta.ts`
- `infrastructure/sync/SyncPullReconciler` → deferred to T-IGH-04-SYNC-PULL-DECOMPOSE / T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE
- `infrastructure/api/AuthTokenStore` → relocate wholesale to `infrastructure/storage/AuthTokenStore.ts`
- `shared/services/NotificationService`, `shared/components/ui/CollapsibleBlock` → `useUiPref`
- `app/providers/DataSourceProvider` → demo seed flags into `infrastructure/storage/DemoModeStore.ts`
- `AppContent.tsx` → `shramsafal_current_farm_id` into `SessionStore`

**DoD:** allow-list empty, gate runs in pure strict mode.

---

### T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (P1, blocked by upstream Task 2 narrow scope)

**Origin:** Upstream's `930742e` LegacyLocalStorageMigrator commit message names this task explicitly. The migrator + Dexie repos are dormant; the actual cutover (DexieDataSource swap + DataSourceProvider wiring + SyncPullReconciler localStorage-write retirement) lands here.

**Why deferred to its own task:** SyncPullReconciler still writes `crops` and `farmer_profile` to localStorage. Switching DexieDataSource to read from Dexie BEFORE migrating SyncPullReconciler creates silent divergence — UI reads Dexie while sync writes localStorage. Either both sides flip together, or the cutover gets a temporary dual-write contract.

**Pairs with:** T-IGH-04-SYNC-PULL-DECOMPOSE (the per-resource reconciler split is the natural place to redirect each write).

---

### T-IGH-04-CONFLICT-EDIT (P2)

Add an "edit and retry" affordance to OfflineConflictPage. Today: retry/discard. Add: open an inline editor for the payload, save, re-queue with a fresh `clientRequestId`. Pairs with REJECTED_USER_REVIEW lifecycle from the P0 work.

---

### T-IGH-04-CONFLICT-BADGE-MOUNT (P2)

Mount `<ConflictBadge />` in AppHeader's top-right slot with `onClick={() => setCurrentRoute('offline-conflicts')}`. Held until `T-IGH-04-ROUTER-DECOMPOSE` slims AppContent.

---

### T-IGH-04-XSTATE-NAV (P2, plan-named follow-up)

Replace ad-hoc `currentRoute` switch in AppRouter with a `navigationMachine` actor mounted alongside `syncMachine` in RootStore.

---

### T-IGH-04-LEGACY-SERVICES (P2)

After all consumers migrate to feature hooks (see T-IGH-04-LOCALSTORAGE-MIGRATION), delete `services/harvestService.ts` and `services/procurementRepository.ts`. The Task 10 ESLint `no-restricted-imports` rule already warns on them.

---

### T-IGH-04-LEGACY-STORAGE-CLEANUP (P3, post-soak)

After one release of soak, delete the legacy `crops` and `farmer_profile` localStorage keys (currently kept as a safety net by `LegacyLocalStorageMigrator`). Bump flag to `agrisync_legacy_storage_migrated_v2`.

---

### T-IGH-04-ESLINT-TIGHTEN (Plan Task 10, P1, depends on Tasks 6–9)

Drop `--max-warnings 9999` to `50` (Sub-plan 05 will tighten to 0). Add `no-restricted-imports` rules per plan §Task 10. Cannot ship until decompositions land.

---

## Recommended execution order (next sessions)

```
Session B:  3 parallel sub-agents on
            - T-IGH-04-PROFILE-DECOMPOSE     (~3h)
            - T-IGH-04-SYNC-PULL-DECOMPOSE   (~2h)
            - T-IGH-04-ROUTER-DECOMPOSE      (~2h)
            - T-IGH-04-FILE-DECOMPOSE        (~3h split across 8 sub-agents)

Session C:  T-IGH-04-LOCALSTORAGE-MIGRATION  (~3h, parallel by area)
            T-IGH-04-LEGACY-SERVICES         (~30m, after migration)
            T-IGH-04-CONFLICT-BADGE-MOUNT    (~15m, after router decomp)
            T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (~1.5h, pairs with sync-pull decomp)

Session D:  T-IGH-04-ESLINT-TIGHTEN          (~30m, after Sessions B-C)
            DoD verification + finishing-a-development-branch handoff
            Master index update (after _COFOUNDER classification clears)

Backlog:    T-IGH-04-XSTATE-NAV              (P2)
            T-IGH-04-CONFLICT-EDIT           (P2)
            T-IGH-04-LEGACY-STORAGE-CLEANUP  (P3, post-soak)
```

**Total remaining:** ~12-14 hours, compressing to ~5-7h with sub-agent parallelism.

---

## Master plan integration (when _COFOUNDER unlocks)

Update `_COFOUNDER/Projects/AgriSync/Operations/Plans/INDUSTRY_GRADE_HARDENING_2026-04-27/00_MASTER_INDEX.md` row for **04 Frontend Restructure**:

```
Status: PARTIAL_FOUNDATION — Tasks 3, 4, 5 + P0 conflict durability
        landed on feature/ighardening-04-frontend (worktree, 6 commits
        2be44a9..20c765a on top of akash_edits 930742e). Plan 04 DoD
        items still pending (Tasks 6, 7, 8, 9, 10 + LOCALSTORAGE
        drain + DEXIE cutover bridge). T-IGH-04-PROFILE-SNAPSHOT
        superseded by upstream 9569047 amendment (per-tab snapshots
        deferred to Task 6).

        Test count delta on the feature branch: 30 baseline → 55 (+25).
        Local gates green at 20c765a; not pushed; not merged.
        See docs/T-IGH-04-PENDING-TASKS.md for remaining task scopes.
```

Move this document into `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/` and update its `_INDEX.md`.

---

## Branch handling

- **Branch:** `feature/ighardening-04-frontend` is isolated in `.worktrees/ighardening-04-frontend/`.
- **Base:** `akash_edits` head `930742e`. Already rebased once during this session; will need re-rebase if `akash_edits` advances further.
- **Parked:** earlier 05 PREP commits (`ffa9352`, `5e270b1`) live on `parked/sub-plan-05-bot-commits`, not on `akash_edits`. Do not graft them onto this feature branch.
- **Recovery tag:** `pre-rebase-snapshot-2026-05-01` points at the pre-rebase tip (`b3d57e6`) for emergency rollback.
- **Merge into `akash_edits`:** wait until at least Tasks 6 + 7 + 8 land. Merging foundation alone leaves Plan 04 DoD unfulfilled.
- **Push to origin:** not done by this session. User decision; verifier brief did not authorize push.
- **Plan 05 status:** PREP_READY only. Parked PREP commits are not 05 green. Do not write specs against Plan 04 selectors/screens until Tasks 6-9 stabilize them. Do not assert E2E against the conflict UX — its semantics are now durable, but tests should land alongside the badge mount in `T-IGH-04-CONFLICT-BADGE-MOUNT`.

---

*Originally authored 2026-05-01 by Claude Opus 4.7 in worktree session 1. Updated through four post-verifier rounds: (1) PARTIAL_FOUNDATION reframing + P0 durability gap surfaced. (2) Branch base correction `b41e1c8 → b1a4095`. (3) Branch base re-correction `b1a4095 → 19a31b9` + vitest-env design tension surfaced. (4) **Current**: rebase executed onto `930742e`, T-IGH-04-CONFLICT-STATUS-DURABILITY P0 shipped (`acb8208` + `20c765a`), T-IGH-04-PROFILE-SNAPSHOT superseded by upstream amendment, doc rewritten to reflect new state. Six commits on the feature branch; 12 files / 55 tests green; Plan 04 stays PARTIAL_FOUNDATION.*
