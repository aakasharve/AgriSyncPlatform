# Fix F2 — REAL-Postgres :5433 machine-gate proof for the F1 ledger-derivation supersession + non-blocking fix

spec: ai-intelligence-plan-2026-06-25
Branch: `feat/ai-eval-golden-18`
baseCommit: `cbddd8e5` (the F1 fix — `fix(ssf): isolate non-blocking ledger derivation from the log commit`)

## What F2 proves

F2 is the machine-gate proof that the F1 fix (`CreateDailyLogHandler` two-phase persistence
+ `LedgerDerivationService` supersession write-ordering) holds against **REAL Npgsql on native
Postgres :5433** — NOT the EF-InMemory harness, and NOT Docker (founder directive: native only).

A single new integration test file was added; **no production code was changed** (the handler and
the derivation service are byte-for-byte identical to `cbddd8e5`):

- `src/tests/ShramSafal.Sync.IntegrationTests/LedgerDerivationSupersessionRealPostgresTests.cs`

It is tagged `[Trait("Category","RequiresPostgres")]` and self-skips cleanly if :5433 is
unreachable, so it never breaks the InMemory unit suite or the Docker-gated CI sweep. It creates
its **own scratch database** on :5433, applies the full migration chain to it (User → Accounts →
SSF-A → Analytics → SSF-B), seeds parents, runs the **real** `CreateDailyLogHandler` +
`LedgerDerivationService` + `ShramSafalRepository` + `ShramSafalDbContext`, and drops the scratch
DB on dispose. It **never touches `agrisync_dev` data.**

### Faithful reproduction of the prod SYNC write path

Production drives a sync mutation under an ambient transaction (`TenantTransactionMiddleware`) with
the tenant scope established by `CallerFarmTenantScope`: **admin-elevate** so
`TenantConnectionInterceptor` no-ops (avoiding the documented `SET LOCAL` write-rows-affected
desync, `reference_interceptor_setlocal_desyncs_ef_writes`), then set `agrisync.farm_id /
owner_account_id / user_id` via `set_config(...,true)` inside that transaction. The test opens
exactly that ambient transaction before invoking the handler, so
`dbContext.Database.CurrentTransaction` is non-null → the handler's `PersistSideCarAsync` takes the
**SYNC (SAVEPOINT-on-ambient-transaction) branch** — the branch that carries the supersession /
rollback bug F1 closes.

### RLS is genuinely in effect (not a superuser-vacuous pass)

The handler write path connects as **`agrisync_app`** — verified in-test to be a NON-superuser with
NO `BYPASSRLS`, so `FORCE ROW LEVEL SECURITY` on `farm_operations` / `daily_logs` / the five child
tables genuinely applies to its reads and writes. If the tenant GUC were not set the writes would be
RLS-denied. (Seeding is done separately as the `postgres` superuser, which correctly bypasses RLS.)

## The scenario

The farmer confirms the SAME voice draft (same `SourceAiJobId`) **twice** with DISTINCT
`clientRequestId`s (`req-A`, then `req-B`). Because the idempotency key is
`DeviceId:ClientRequestId`, the second confirm is NOT deduped — the handler runs fully again,
creating a second `DailyLog` and re-deriving the typed ledger. Both derivations recompute the SAME
`DerivedEventKey` (keyed on the AiJob id + span text + event type, NOT the log id), so the second
derivation must **supersede** the first current `FarmOperation`, never insert a second current row
against the partial-unique index `ix_farm_operations_current_key (farm_id, derived_event_key) WHERE
is_current_version`.

The seed voice blob exercises all six derived families: `inputs` (→ `farm_operations` +
2× `application_input_items`), `irrigation`, `labour`, `machinery`, `observations`, `disturbance`.

## Real :5433 output (verbatim)

```
Passed  LedgerDerivationSupersessionRealPostgresTests.Forced_derivation_failure_does_not_roll_back_the_log_on_real_postgres [1 s]
 [EVIDENCE] === F2 non-blocking proof (forced side-car failure, real Npgsql :5433) ===
 [EVIDENCE] handler result.IsSuccess               = True (expect True)
 [EVIDENCE] daily_log survives forced failure       = 1 (expect 1)
 [EVIDENCE] farm_operations after savepoint rollback = 0 (expect 0)
Passed  LedgerDerivationSupersessionRealPostgresTests.Confirming_twice_same_ai_job_supersedes_to_one_current_row_and_persists_both_logs_with_all_child_families [238 ms]
 [EVIDENCE] handler write path ran as role='agrisync_app', superuser_or_bypassrls=False
 [EVIDENCE] === F2 supersession proof (real Npgsql :5433) ===
 [EVIDENCE] current farm_operations per DerivedEventKey (max) = 1 (expect 1)
 [EVIDENCE] total CURRENT farm_operations              = 1 (expect 1)
 [EVIDENCE] SUPERSEDED farm_operations                 = 1 (expect 1)
 [EVIDENCE] daily_logs present (log1=1, log2=1)   (expect 1,1)
 [EVIDENCE] application_input_items on current op      = 2 (expect 2)
 [EVIDENCE] irrigation_entries / labour_assignments    = 2 / 2 (expect 2/2)
 [EVIDENCE] machinery_usages / observation_events      = 2 / 2 (expect 2/2)
 [EVIDENCE] disturbance_events                         = 2 (expect 2)
 [EVIDENCE] no 23505 raised across two confirms with same SourceAiJobId, distinct clientRequestId
Total tests: 2
     Passed: 2
```

## Per-assertion result (i)–(iv)

| # | Claim | Result | Real observed value |
|---|-------|--------|---------------------|
| (i) | Two confirms, same `SourceAiJobId`, distinct `clientRequestId` → EXACTLY ONE `is_current_version` `FarmOperation` per `DerivedEventKey`; no duplicate; no 23505 escaping | **PASS** | current-per-key(max)=1, total-current=1, superseded=1; no 23505 raised across both confirms |
| (ii) | The `daily_log` PERSISTS on BOTH confirms (never rolled back) | **PASS** | log1 present=1, log2 present=1 |
| (iii) | All child-table families get rows | **PASS** | `application_input_items`=2 (both mix items on the CURRENT op via `farm_operations`); `irrigation_entries`=2, `labour_assignments`=2, `machinery_usages`=2, `observation_events`=2, `disturbance_events`=2 (via `daily_logs`, one per confirmed log) |
| (iv) | A forced derivation failure does NOT roll back the log (non-blocking on real Postgres) | **PASS** | With a `BEFORE INSERT` trigger raising on `ssf.farm_operations`, handler returns `IsSuccess=True`, the `daily_log` survives (=1), and no half-derived `farm_operation` leaked (=0) |

**Conclusion: F1 is COMPLETE on real :5433. All four proofs pass with the exact expected row counts.**

## Adversarial verification (proof is not vacuous — and an accurate nuance about *which* mechanism carries the guarantee)

I ran two throwaway "disable-the-fix" probes to check whether the proof would still pass if F1's
mechanisms were removed (all production code was restored to pristine `cbddd8e5` afterward — the
committed handler/derivation service have zero diff vs HEAD, confirmed via `git diff`):

1. **Disabled the write-ordering flush** (`LedgerDerivationService` line 105,
   `SaveChangesAsync` between `MarkSuperseded` and the new-row `Add`). The supersession test STILL
   passed with no 23505. Captured EF command SQL shows why: **EF Core naturally emits the
   supersede-`UPDATE` before the new-current-`INSERT`** within the single `SaveChanges` for this
   entity/version stack, so the transient two-current-rows state never materialises even without the
   explicit flush. A raw-SQL probe confirmed the partial-unique index itself is real and
   non-deferrable (INSERT-before-UPDATE → `23505`; UPDATE-before-INSERT → OK).

2. **Disabled the handler's explicit `RollbackToSavepointAsync`** in `PersistSideCarAsync`. The
   forced-failure test STILL passed (log survived). Captured EF SQL shows why: **EF Core creates an
   automatic transaction savepoint around each `SaveChanges` when a user transaction is present and
   rolls back to it on failure** (`"Rolling back to transaction savepoint"` was emitted during the
   failing side-car `SaveChanges`, BEFORE the handler's own — disabled — rollback), which un-aborts
   the ambient transaction so the Phase-1 log survives.

**What this means (reported honestly, not a defect):** The **primary, load-bearing F1 guarantee is
the two-phase persistence** — committing the farmer's `DailyLog` on its OWN `SaveChanges` in Phase 1,
BEFORE the non-blocking side-car runs in Phase 2. That is what makes proofs (ii) and (iv) hold, and
it is directly demonstrated. F1's explicit write-ordering flush and explicit SAVEPOINT-rollback are
**belt-and-braces** — the fix's own commit message says so ("Belt-and-braces alongside the
write-ordering fix"). In the current EF Core + Npgsql stack they are redundant with EF's natural
batch ordering and EF's automatic per-`SaveChanges` savepoints, but they are correct to keep: they
guard the invariant against a future EF batch-reordering change or a stack where automatic
savepoints are disabled. None of this weakens the F2 verdict — the observable, RLS-gated,
real-Postgres end-state is exactly correct on every one of (i)–(iv).

## Mechanism / files

- New test: `src/tests/ShramSafal.Sync.IntegrationTests/LedgerDerivationSupersessionRealPostgresTests.cs`
  (self-contained inline seed helpers, scratch-DB lifecycle, `[Trait("Category","RequiresPostgres")]`,
  clean self-skip when :5433 is down).
- Reuses `IntegrationMigrationChain.ApplyAsync` (the project's canonical 4-phase interleaved chain).
- `PGPASSWORD` read from `src/AgriSync.Bootstrapper/appsettings.Development.json`
  (`ConnectionStrings:ShramSafalDb`, host `localhost`, port `5433`, db `agrisync_dev`); the password
  value was never printed.
- No new migration (index `ix_farm_operations_current_key` already exists and is correct).
- `IEntitlementPolicy` on the 3 AI handlers untouched.

## Test-suite hygiene

- Both F2 tests pass on :5433.
- The pre-existing InMemory `CreateDailyLogDerivationIsolationTests` still passes (no regression).
- The Sync integration project builds clean (the only warning is a pre-existing `CS0618` in
  `AiEndpointsTests.cs`, unrelated to this change).
