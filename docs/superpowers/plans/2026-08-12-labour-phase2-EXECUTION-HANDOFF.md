# LABOUR PHASE 2 — EXECUTION HANDOFF

**Written 2026-08-12 at the end of the planning session. The reader is the implementation agent in a fresh session. You do not need the conversation that produced this — everything decided is here or in the approved plan.**

**Status: plan APPROVED by the founder. Architecture is CLOSED.**

---

## 1. Final domain representation — Plot / MultiPlot / Farm

One engagement = one row. The spatial assertion is a **set**, and `scope` names the farmer's intent explicitly.

| Farmer did | `scope` | `plot_ids` | `plot_id` | `crop_cycle_id` |
|---|---|---|---|---|
| chose one plot | `Plot` | `{A}` | `A` | set |
| chose several plots | `MultiPlot` | `{A,B,C}` | `NULL` | `NULL` |
| chose संपूर्ण शेत | `Farm` | `{}` | `NULL` | `NULL` |

A CHECK constraint welds `scope` to cardinality so they cannot disagree (plan §C1-AMENDED).

**`plot_ids uuid[]`** follows an existing repo convention (`day_ledgers.global_expense_ids`, `test_instances.attachment_ids`) and matches the client's existing `string[]`.
**`plot_id` is retained** and populated only when `scope='Plot'` — a compatibility projection that keeps every existing single-plot reader working untouched. That is what makes this change small.
**`scope` is stored, not derived.** Cardinality could imply it, but a reader would have to *know* that `{}` means farm-wide — the exact ambiguity that has `RoutinePattern.cs:49` and `DerivedEventKey.cs:24-25` reading the same NULL to mean opposite things today.

**Never:** a fabricated plot, an invented crop cycle, a sentinel row, "first available plot", or a NULL whose meaning must be guessed.
**Never:** a `FarmContext` service, a polymorphic anchor, or a generalisation to equipment/location/resource. Two columns and a CHECK on one table.

**One engagement → one log → one `labourAssignmentId` → one `worker_count`.** Per-plot quantities are written **only** where the farmer supplied them (`targetPlotName` present). Absent that evidence, invent nothing.

---

## 2. Exact change surface

See plan §H. Additions that O-2 introduced, called out because they are easy to miss:

- `LogFactory.ts:129` (manual) and `:502` (voice) — the per-plot `forEach` that produces N logs must stop for a shared engagement; the persisted log must carry the full selection instead of hardcoding `selectedPlotIds: [plotId]` (`:137-144`, `:509-514`).
- `log-factory-helpers.ts:88` — headcount broadcast; `:215-224` `allocateAmountAcrossPlots` — invented money split. Both stop fabricating.
- `logSyncMutationService.ts:254` — push currently takes `plot[0]`.

**Readers to audit (probe-verified).** Sharp: `logsReconciler.ts:235` · `LedgerDerivationService.cs:82,88` · `EvaluateComplianceHandler.cs:36` + `ShramSafalRepository.cs:337-345` (**false compliance breaches** if a multi-plot log stops appearing per-plot) · `appContentDailyCounts.ts:90` (triple-counts today). Already tolerant: `dayState.ts`, the four MIS matviews, the verification FSM, exports, and `costAnalysisHelpers.ts:153` which already pro-rates.

**Do not touch:** `cost_entries`, `job_cards`, the five `LabourPersonDto` mirrors, prompt files, `outputContract.md`, the golden set.

---

## 3. Migrations (three, all approved)

① `daily_logs` — add `plot_ids uuid[]` + `scope varchar(10)`, drop `NOT NULL` on `plot_id`/`crop_cycle_id`, deterministically classify the existing rows, add the CHECK.
② `farm_memberships.can_manage_labour_records boolean NOT NULL DEFAULT false`.
③ `labour_assignments.notes` (nullable).

**Sequencing: apply the five unapplied V1 migrations first.** That is the only ordering constraint.

**Backfill wording matters.** There is **no semantic or inferred historical backfill**. Existing valid plot-scoped logs are **deterministically classified** as `scope='Plot'`, `plot_ids = ARRAY[plot_id]`, because their `plot_id` and `crop_cycle_id` already prove their meaning. Measured: **135 rows · 0 plot orphans · 0 crop-cycle orphans**.

**Measure live prod `ssf.daily_logs` before deploying.** 135 is `agrisync_dev_v2`, not production.

Full `dotnet ef` form (both flags are required — `--context` because several DbContexts are reachable, `--configuration Release` because a running dev API locks Debug output and the failure is disguised as a bare *"Build failed"*):
```
dotnet ef migrations add <Name> --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext --configuration Release
```
**Never run `dotnet ef database update`. Never migrate `agrisync_dev_v2`.** Scratch DBs only, via `IntegrationMigrationChain`. Never `make boot` (it swallows migration failure).

---

## 4. Task dependency order

```
Phase 1  Honesty backstop        independent — SHIP FIRST
   |
Phase 2  Farm context durable    migration ① + domain + guards + contract + client scope
   |
Phase 2b One engagement (O-2)    needs Phase 2 — without plot_ids, not splitting DROPS plots
   |
Phase 3  Read-back               projection + reconciler guard + selectedPlotIds fix — ONE change
   |                              + CorrectLabourHandler bumps parent ModifiedAtUtc
Phase 4  Convergence             correction persists locally; in-flight lock; farm-wide correction
   |
Phase 6  Instructional examples   UI only, last

Phase 5  Capability              INDEPENDENT of 1-4 — may run in parallel from the start
```

**Phase 1 first is deliberate and founder-endorsed:** even if everything after slips, the product stops telling a farmer "done" when the record is only local, rejected or stuck.

**Hidden dependency:** `resolveLogFarmId` resolves the farm *through the plot*, so Gate B correction is dead for farm-wide logs until Phase 2 lands.

---

## 5. Targeted test ownership

| Change | Suite |
|---|---|
| Domain only | `DOMAIN` |
| Frontend only | `npm test` scoped by path (`-- src/features/labour src/features/sync`) |
| Any new file under `src/apps/**` | + `ARCH` (cheap; it holds the pins) |

Never pass `--reporter=basic` (removed in vitest 4 — the run dies before any test).

---

## 6. Phase-boundary gates

**Mandatory full five — no judgement — when the diff touches any of:**
```
**/Persistence/Migrations/**  ·  any *Configuration.cs
any file naming an agrisync.* GUC, an RLS policy, or RlsIdentityScope
CreateDailyLogHandler.cs · PushSyncBatchHandler.cs · LedgerDerivationService.cs
sync-contract/** or generated payloads
src/clients/mobile-web/src/features/sync/pull/reconcilers/**
any IShramSafalRepository member
any correction/attribution handler · LabourEndpoints.cs · MembershipEndpoints.cs
```

**At every phase boundary:** all five suites **plus** the runtime proofs —
1. fresh scratch DB, full migration chain,
2. RLS as **`agrisync_app`** with `SELECT rolsuper OR rolbypassrls …` asserted **false first** (a proof as `postgres` is void),
3. both cross-farm directions,
4. a real HTTP round trip against a running Bootstrapper,
5. **device-reset reconstruction** — clear Dexie → pull → labour present, headcount correct, basis correct.

Run the full five twice only at a boundary that first executed a new migration. Record **baseline → added → actual**; never predict a total.

**Baselines at `labour-v1-green`:** Domain **1174** · Arch **91** · BuildingBlocks **98** · RequiresPostgres **47** · mobile-web **719 / 99 files**.

---

## 7. Server read-back flow

```
ssf.labour_assignments (+ field_operator_work_rows)
   -> LabourEngagementDto[]  nested on DailyLogDto, sibling of Tasks/VerificationEvents
   -> existing /sync/pull    (no second channel)
   -> logsReconciler         (guard revised — see below)
   -> Dexie                  (cache, not truth)
   -> LabourHub / ReviewSheet / picker / correction
```

Field list and the current-truth vs history split: plan §D. **History (`labour_corrections`) is fetched on demand only and never rides the pull** — the everyday labour view must not consume an audit ledger.

**Two traps that will pass every test if missed:**
- `labour_assignments` has **no `modified_at_utc`** and corrections mutate in place, so `CorrectLabourHandler` **must bump the parent `DailyLog.ModifiedAtUtc`** or a correction never reaches a second device.
- `preserveLocalOnlyFields` must be **revised, not deleted**, with the predicate **"the response carried a labour field"** — *not* "the array came back non-empty", which re-opens the V1 data loss. **Projection and guard flip land in the same commit.**

The client-minted `labourAssignmentId` **survives as the server PK** (proven end-to-end at `SyncEndpointsTests.cs:1214/1252/1281`), so no mapping layer is needed.

---

## 8. Offline convergence behaviour

Server-owned truth does **not** mean online-only. Offline capture stays fully supported.

- Outbox is authoritative for pending state; the three UI states derive from `mutationQueue` — **no Dexie version bump**.
- **Drain the outbox** — `markOutboxEventSent` / `markOutboxEventFailed` / `getPendingOutboxEvents` have **zero callers**, which is why `SyncIndicator` latches on "Sending…" forever. It already defines `SAVED: 'Saved on Phone'` and never emits it.
- **Consume `skippedLogIds`** at all four `enqueueLogsForSync` call sites (zero production consumers today).
- **`updateLog` must persist to Dexie**, not only `setHistory` — this is the live *"phone says 8, server says 6"*.
- **In-flight lock on Save** — removes the reachable double-tap duplicate (root-cause fresh-id defect stays deferred).
- **Retry cap must not be silent** — a row at `retryCount >= 5` becomes `NEEDS_FIX`, visible and manually retryable.
- Server dedupe remains the backstop: `TryStoreSuccessAsync(deviceId, clientRequestId)`.

**States:** `ON_PHONE` (फोनवर सेव्ह ✓) · `ON_SERVER` (पाठवलं ✓) · `NEEDS_FIX` (अडकलं — तपासा). Marathi is field-testable; the state model is not. **No success wording before the system has evidence for that level of success** — including the `मंजूर केलं` overlay that currently fires *before* the enqueue.

---

## 9. Labour permission flow

```
Primary Owner / Secondary Owner  -> always allowed
Mukadam                          -> allowed by default (field verification IS the role)
any other member                 -> allowed ONLY if can_manage_labour_records
```

Storage: **one additive column on `farm_memberships`** — no new RLS (the existing `p_tenant_farm_memberships` is FOR ALL with a WITH CHECK), zero blast radius on the 27 in-tree `IShramSafalRepository` implementors **provided the new port member ships a default body** (an abstract member yields ~135 compile errors).

Governs: correcting labour count · managing FieldOperator identity · changing attribution · reviewing/approving labour · correcting duration.

Grant/revoke needs a **new farm-scoped endpoint** (none exists — `FarmMembership.ChangeRole` has zero production callers), wired to the **already-built** `TeamMemberCard` toggles (`TeamMemberCard.tsx:25-30, 87-105`) which are currently local-state-only mock UI.

**Correct the approve/verify path** — `ShramSafal.Infrastructure/Auth/ShramSafalAuthorizationEnforcer.cs:62` is `OwnerRoles = [PrimaryOwner, SecondaryOwner]`, which excludes the Mukadam. Founder-approved change.

**Never:** a second role system, invented roles, a capability keyed on user rather than farm × user, or `IEntitlementPolicy` (that is billing — it would make labour a paid feature).

---

## 10. Acceptance journeys

All eight in plan §L. The two that are non-negotiable proofs of this phase:

**Clean device** — Phone A records → server acks → Phone B clean install → login → same workers, history, attribution, corrections, current truth. *A passing unit test is not this proof.*

**Multi-plot truth (O-2)** — A+B+C, 8 shared workers → one canonical quantity of **8** → reload 8 → clean second device 8 → context still A+B+C → **never 24** → no fabricated 3/3/2 in headcount or money → one `labourAssignmentId`. Mandatory because the system is *proven* to inflate this today.

---

## 11. Rollback strategy

- Every migration has an **executed** `Down()`, not merely written; policies dropped before tables.
- ① rolls back cleanly **only while no `MultiPlot`/`Farm` rows exist**. Once they do, rollback requires a documented decision about those rows — state this in the deployment runbook.
- RDS snapshot floor before any prod migration, re-verified at each gate transition.
- Schema and binary move together — no out-of-band DB change.
- Phase 1 is independently revertible and touches no schema.
- `labour-v1-green` is the immutable comparison point.

---

## 12. Deferred scope (explicit)

Cross-crop-cycle multi-plot attribution (a `MultiPlot` log carries `crop_cycle_id IS NULL`; recording a cycle wrongly is worse than absent) · a second-device **live** conflict UI beyond `NEEDS_FIX` · the `LogFactory` fresh-id re-confirm root cause · audit events on field-operator handlers · marketplace, reputation, payments, per-person settlement · `LinkedUserId` in any form · WTL v0 retirement.

---

## 13. Fresh-session implementation prompt

Give the next agent exactly this:

---

> You are the **IMPLEMENTATION AGENT** for Labour Phase 2. You are not the architect. **The architecture is approved and closed.**
>
> **Read first, in order:**
> 1. `docs/AGRISYNC-DOCTRINE.md` — binding product principles
> 2. `docs/superpowers/plans/2026-08-12-labour-phase2-server-truth-farm-context.md` — the approved plan
> 3. `docs/superpowers/plans/2026-08-12-labour-phase2-EXECUTION-HANDOFF.md` — this handoff
> 4. `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md` — V1 invariants you must preserve
>
> **Before touching anything:** cut `feat/labour-phase2-server-truth` from tag `labour-v1-green` (`69f022d6`). **Do not merge Labour V1 to `main`.** Confirm the five V1 migrations are the applied head before adding migration ①.
>
> **Execution order:** Phase 1 (honesty backstop) → 2 → 2b → 3 → 4 → 6, with Phase 5 (capability) in parallel from the start. §4 above.
>
> **You must NOT:**
> - reopen the architecture, or produce another plan version — patch in place for factual corrections only
> - fabricate a plot, crop cycle, sentinel row, or "first available plot"
> - fan a shared engagement out into per-plot rows, or invent per-plot headcount or money without farmer evidence
> - treat Dexie as durable truth
> - build a second permission system, invent roles, or put `IEntitlementPolicy` on labour
> - expose raw entities as a read model, widen `LabourAssignment`'s private setters, or add a general `Update`
> - add a required field, warning or blocking prompt to the capture path
> - run `dotnet ef database update`, or migrate `agrisync_dev_v2` from anywhere
> - merge to `main` or deploy
>
> **Environment traps, all learned the hard way:** new `.cs` files must be **CRLF** or the `dotnet format` pre-commit hook rejects them with misleading `error WHITESPACE` · PowerShell 5.1 mangles `git commit -m @'…'@` containing double quotes — use `git commit -F` · the pre-commit ESLint gate runs `--max-warnings 0`, so a file with pre-existing warnings blocks any commit touching it · hydrate `REQUIRES_POSTGRES_ROOT_CONN` and `AGRISYNC_TEST_APP_ROLE_PASSWORD` from User scope into every shell · use `--configuration Release` for ARCH/PG/BuildingBlocks **and `dotnet ef`** while a dev API is running · every new integration test class needs `[Trait("Category","RequiresPostgres")]` or it silently does not run.
>
> **Verification rhythm:** §5 and §6 above. Targeted tests per commit; the mandatory-full-five file list is not a judgement call; runtime proofs at every phase boundary. Record baseline → added → actual; never predict a total.
>
> **When implementation evidence contradicts the plan, stop that task only and report:**
> ```
> EXECUTION BLOCKER
> Task:
> Expected:
> Actual:              (file:line, command output, or SQL)
> Smallest correction:
> Approved semantics affected: YES / NO
> ```
> If **YES**, stop and wait for the founder — escalate only if repo evidence proves an approved semantic technically **impossible**. If **NO**, patch the plan in place, note it, continue.
>
> Start with **Phase 1**. Report when Phase 1 is green.

---

**Plan first. Approved. Now execute — do not redesign.**

> The farmer records once. The server remembers. Every authorised device reconstructs the same truth. And the system never invents where or how many people worked.
