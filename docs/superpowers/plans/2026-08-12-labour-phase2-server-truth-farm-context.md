# LABOUR PHASE 2 — SERVER TRUTH & FARM CONTEXT PLAN

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes.

**Goal:** Make Labour Management independent of the device and truthful about farm context — the farmer records once, the server remembers permanently, and every authorised device reconstructs the same truth.

**Architecture:** `daily_logs` gains an explicit **scope discriminator** (`Plot` | `Farm`) alongside nullable `plot_id`/`crop_cycle_id`, so "the farmer said संपूर्ण शेत" is an assertion rather than an absence. Labour is projected back on the existing `/sync/pull` as a nested `LabourEngagementDto[]` on `DailyLogDto` (current truth only); correction history stays a separate on-demand read. A grantable labour-management capability is added as one column on the **existing** `farm_memberships`. **Stack:** .NET 10, EF Core (history `ssf.__ef_migrations`), PostgreSQL 16 (:5433), xUnit + FluentAssertions, React 19 + TypeScript + Vitest 4, Dexie.

**Change class + risk tier:** **Data-prod / `trust_tier: high`** — migrations, RLS, sync durability, and a permission surface.

**Spec ID:** `2026-07-13-labour-attendance-approval-design` (`_COFOUNDER/specs/_active/`)

**Baseline:** tag `labour-v1-green` = `69f022d6`. Suites at baseline, all controller-measured:
**Domain 1174 · Architecture 91 · BuildingBlocks 98 · RequiresPostgres 47 · mobile-web 719 / 99 files.**

---

## Global Constraints

Binding on every task.

1. **Entire Farm is a first-class context.** Never a fabricated plot, never an invented crop cycle, never a sentinel row, never "pick the first plot".
2. **Never fan a farm-wide log out into per-plot rows.** See §A3 — this already inflates headcount today.
3. **The server owns durable truth.** Dexie is capture, cache, outbox and optimistic UI only. Any design where the server cannot reconstruct the record is wrong.
4. **No second permission system.** Extend `farm_memberships`. No new roles (`Approver`/`Supervisor`/`Verifier` do not exist). No `IEntitlementPolicy` on labour — that is billing, not authorization, and would make labour a paid feature.
5. **Never expose raw entities as a read model.** No returning `LabourAssignment`/`FieldOperator` from an endpoint; no widening private setters; no general `Update`.
6. **All Labour V1 invariants are preserved.** Phase Rule; attribution never changes `WorkerCount`; `DurationHours` never travels without `TimeBasis`; corrections append-only; creator ≠ data subject; cross-farm mutation forbidden; headcount-only logging frictionless. **No V6 — patch the V1 plan in place if a fact changes.**
7. **Capture stays frictionless.** No new required field, warning, completion percentage or blocking prompt on the logging path.
8. **RLS proofs run as `agrisync_app`** with the superuser-vacuity guard asserted first. A proof as `postgres` is void.
9. **Never migrate `agrisync_dev_v2` from a test.** Scratch databases only.
10. **Nothing merged, nothing deployed** until the Founder Acceptance Gate is ticked.

---

## A. Current verified problem

Every fact below was measured this session against the live database or read from source at `69f022d6`. Nothing here is inherited from a previous plan.

### A1. The database reality — this is the cheapest moment this change will ever be

Queried live `agrisync_dev_v2` under `default_transaction_read_only=on`:

| Table | Rows |
|---|---|
| `ssf.labour_assignments` | **0** — and `duration_hours` / `time_basis` **do not exist yet** |
| `ssf.field_operators` / `field_operator_work_rows` / `labour_corrections` | **tables do not exist** |
| `ssf.daily_logs` | **135**, with **0 orphan `plot_id`** and **0 orphan `crop_cycle_id`** |
| `ssf.plots` / `crop_cycles` | 4 / 4 |
| `ssf.cost_entries` | 59, of which **14 are already `plot_id`-null** |

Migration head is `20260719074300`; **all five August 2026 Labour migrations are file-only and unapplied** (correct — this run never ran `database update`; the scratch-DB harness applied them).

> **VERDICT: MIGRATION-ONLY. No backfill.** Zero labour rows, zero orphans, no sentinel rows to unpick, and `DROP NOT NULL` is a catalog-only change — there is no FK, no index and no CHECK on `plot_id` anywhere in `ssf`. The only sequencing constraint is that the five unapplied migrations go on first.
>
> *Caution for whoever re-runs this:* querying as `agrisync_readonly` returns 0 for everything because of FORCE-RLS masking. That is not an empty database.

### A2. `plot_id` is `NOT NULL`, and so is a second column nobody names

`ssf.daily_logs.plot_id` **and** `crop_cycle_id` are both `NOT NULL` (`20260222080909_AddAuditEvents.cs:60-61`; `DailyLogConfiguration.cs:23-29`; `DailyLog.cs:45`). `CreateDailyLogHandler.cs:93-103` additionally hard-fails `PlotNotFound`/`CropCycleNotFound`, so a sentinel GUID is rejected too.

**`crop_cycle_id` is resolved *through the plot* on both client and server**, so it is a hidden second blocker. Any plan that frees only `plot_id` fails at the next line.

Consequence today: an "Entire Farm" log cannot be stored **at all**. `resolveSyncTarget` returns null (`logSyncMutationService.ts:280`), the log lands in `skippedLogIds` (`:318-326`), and **`skippedLogIds` has zero production consumers** — the farmer is shown success for a record that never left the phone.

### A3. Multi-plot logs already inflate headcount — CONTROLLER-VERIFIED

`log-factory-helpers.ts:76-92`, `allocateLabourForPlot`:

```ts
return {
    ...event,                                   // count / maleCount / femaleCount copied VERBATIM
    id: scopeChildId(event.id, plotId),
    totalCost: allocateOptionalAmount(event.totalCost, isShared, plotIndex, plotCount)
};                                              // only MONEY is divided
```

For a **shared** event the same object is treated two contradictory ways: the money is divided ("one pool, split") while the headcount is copied ("this many on *each* plot"). `GetLabourDataHandler.cs:237` then sums them, so **one 3-plot log of 8 workers reports ManDays = 24**. The money reads right; the people do not.

This is a live `P4`/`P7` violation, pre-existing and **not** introduced by V1. It is decisive here for two reasons: it disqualifies fan-out as an implementation of Entire Farm, and read-back will make it farmer-visible.

### A4. Nothing in this repo distinguishes "farm-level by intent" from "plot unknown"

Six tables already allow a null plot (`farm_operations`, `observation_events`, `weather_events`, `routine_patterns`, `weather_stamps`, `cost_entries`) and **all six use nullability alone**. The ambiguity is not theoretical — two files read the identical NULL to mean opposite things:

- `RoutinePattern.cs:49` — NULL means **"farm-wide pattern"**
- `DerivedEventKey.cs:24-25` — NULL means **"degenerate case"**

The only `scope` columns that exist (`disturbance_events.scope` / `affected_scope`) are *time* scopes (`FullDay`/`Partial`, `Event`/`Bucket`/`WholeDay`), not spatial.

### A5. Labour is written but never read back

No endpoint returns labour attached to a log. `DailyLogDto` has 13 fields and no labour; `SyncPullResponseDto` has 20 collections and no labour. `FieldOperatorPicker.tsx:169-177` says so in a source comment.

`logsReconciler.ts:235` unconditionally builds `selectedPlotIds: [source.plotId]` — for a farm-level log that yields **`[undefined]`, length 1, not 0** — which would silently make a farm-wide log look plot-scoped on round-trip. **This is a landmine for Phase 3 and must be fixed with the projection.**

`labour_assignments` has **no `modified_at_utc`**, and corrections mutate the row in place — so **a correction is invisible to any delta-based pull** unless the parent log's `ModifiedAtUtc` is bumped. A correction would persist perfectly and never reach a second device, with every test passing.

### A6. The app lies about success in 11 places (7 reachable)

The four `enqueueLogsForSync` call sites (`app/hooks/useLogCommands.ts:208, 272, 367, 426` — **not** under `features/`) discard the return value and fire success unconditionally; only `handleManualSubmit` has a live caller (`mainView.tsx:443`). Plus four in `ReviewSheet` (`'मंजूर ✓ — हजेरीही निश्चित'`, `'सगळं मंजूर ✓'`, `'शंका नोंदवा — कामगाराला विचारता येईल'`, and a `मंजूर केलं` overlay that fires **before** the enqueue), and `'जतन झाले → मंजुरीसाठी'` which writes nothing at all.

> **PATCHED 2026-08-12 (execution session) — four corrections of fact. Approved semantics unaffected.**
> 1. Site 4 fires `Logged once. Saved to N plots. Day closure: …`, not `Logged. Day closure`.
> 2. There is an unlisted **fifth** success toast at `useLogCommands.ts:346-349` — the `originalLogId` **edit** branch, which calls `logCommandService.updateLog(...)` and **never calls `enqueueLogsForSync` at all**. A fix that only touches the four `enqueueLogsForSync` sites leaves the edit path lying.
> 3. `'जतन झाले → मंजुरीसाठी'` is **not** in `ReviewSheet.tsx` — it is `LabourFeature.tsx:146`, and it sits behind `SHOW_ATTENDANCE_TILE = false` (`LabourHub.tsx:35`), so it is currently **unreachable**. "Writes nothing" is confirmed. Do not make it reachable in order to fix it.
> 4. The `मंजूर केलं` overlay firing before the enqueue is **deliberate** — it is a 380 ms animation plus a 3 s undo window (`ReviewSheet.tsx:75-76`, `:407-426`) so `पूर्ववत करा` can cancel before anything is enqueued, locked by 12 tests in `reviewApprove.test.ts`. **The fix is wording, never reordering** — reordering deletes the undo feature.

**Honesty UI already exists and is broken.** `OfflineBanner` and the conflict badge work.

> **PATCHED 2026-08-12 (execution session) — the original claim here was factually wrong.**
> `SyncStatusDrawer` does **not** observe `db.outbox`; it reads `db.mutationQueue` (`SyncStatusDrawer.tsx:19,55`). `SyncIndicator` is a **hybrid**: its *label* comes from `db.outbox` via `SyncStatusService.ts:31-33`, while its *badge counts* already come from `db.mutationQueue` (`AppHeader.tsx:181-182`) — so the chip can render `Sending... [0]`, a permanently-amber label beside a zero badge, because its two halves disagree by construction.
> `db.outbox` rows are written `PENDING` on every save and **never drained** — `markOutboxEventSent`, `markOutboxEventFailed` and `getPendingOutboxEvents` have **zero callers** — so the label latches `'Sending...'` (`SyncIndicator.tsx:58`, three ASCII dots) forever. It already defines `SAVED: 'Saved on Phone'` and **never emits it**.
> **Consequence: exactly one surface reads the dead outbox — `SyncStatusService`. Phase 1 is smaller than this section originally stated.**

### A7. Three live convergence hazards

1. **An accepted correction never reaches Dexie.** `updateLog` calls `setHistory` but never `repo.save`, so a server-accepted correction is lost on reload — and pull cannot repair it because the DTO carries no labour. This is the literal *"phone says 8, server says 6"*.
2. **Double-tap Save creates two logs.** `LogFactory` mints a fresh log id per call and the Save button has no in-flight lock, so two taps yield two `clientRequestId`s the server dedupe cannot catch — they look like genuinely different records.
3. **Retry gives up silently at `retryCount >= 5`**, and "Retry All" reapplies the same cap, making it a no-op for exactly those rows.

### A8. Permissions: no backend capability layer exists

`AppRole` + membership status is the only axis. `IEntitlementPolicy` is a **subscription/billing** gate (`PaidFeature`, `SubscriptionExpired`), and `JwtTokenIssuer.cs:43-48` states tokens are *"identity, not authorization"*. `MeCapabilitiesDto` is derived read-only from the role string.

**The frontend already has the toggle UI as a mock:** `OperatorCapability` (`farm.types.ts:262-268`, including `APPROVE_LOGS`) rendered as per-member pill switches in `TeamMemberCard.tsx:25-30, 87-105`, inside the "My Farm Team" card (`IdentitySection.tsx:416-490`). **Local state only, never sent to a server.**

**No grant / revoke / role-change endpoint exists at all.** `FarmMembership.ChangeRole` (`:250`) has zero production callers.

Five governed actions obey **three different rules** today:

| Action | Current gate |
|---|---|
| Create / Rename / Attach field operator | `callerRole is not null` — **any member, including Worker** |
| Correct labour | `PrimaryOwner or SecondaryOwner or Mukadam` |
| Approve / verify | **owner-tier only — Mukadam excluded** (`ShramSafal.Infrastructure/Auth/ShramSafalAuthorizationEnforcer.cs:62` — `OwnerRoles = [PrimaryOwner, SecondaryOwner]`) |

The third contradicts the founder's position that the Mukadam is exactly the person doing field verification.

---

## B. Founder decisions (already made — not reopened by this plan)

1. Entire Farm is real product behaviour, not an edge case. Do not remove it, do not map it to a real plot, do not fabricate a crop cycle.
2. The database must be able to distinguish *"the farmer said Entire Farm"* from *"the farmer chose Plot 1"* — five years later.
3. The server owns durable truth; the client is thin.
4. Labour read-back is a **launch requirement**, proven by a clean-device journey, not a unit test.
5. "Saved" must not mean "we hope to send this someday."
6. Demo people are **UI examples only** — zero fake `FieldOperator` rows.
7. Labour management is a **grantable capability on the existing access control**; the owner decides who is trusted.
8. Do not expand into marketplace, reputation or payments.

---

## C. Farm context — the model  [FOUNDER-APPROVED 2026-08-12, amended by O-2]

> **O-2 changed this section.** The founder ruled that **one shared engagement stays one engagement even when its context contains several plots**. A `Plot | Farm` discriminator cannot express that, so the model below supersedes the original C1/C2 recommendation. The original options are retained at C4 for provenance.

### C0. What three plots actually produce today — CONTROLLER-DIRECTED PROBE, VERIFIED

**Three logs, not one.** `LogFactory.ts:129` (manual) and `:502` (voice) both `targetPlotIds.forEach(...)`, emitting one `DailyLog` per plot → three `create_daily_log` mutations (`logSyncMutationService.ts:318-331`) → **three `ssf.daily_logs` + three `ssf.labour_assignments` rows, each `worker_count = 8`.**

**The client does NOT carry the whole selection onto a persisted log** — this was my hypothesis and it is **refuted**. Every persisted log hardcodes `selectedPlotIds: [plotId]` (`LogFactory.ts:137-144`, `:509-514`). The multi-plot set survives only in `LogScope.selectedPlotIds` and a display-only `currentLogContext` (`LogContext.tsx:113`), neither of which reaches the factory. **The split happens early, not late.**

**Both shapes the founder forbade are live today:**
- headcount broadcast `8/8/8` — `count` copied by spread (`log-factory-helpers.ts:88`)
- **invented cost allocation `3/3/2`** — `allocateAmountAcrossPlots` (`:215-224`)

It also mints **three unrelated `labourAssignmentId`s for one engagement**, so attribution and correction cannot address it as one thing.

> **Therefore a schema change is strictly required.** Merely stopping the split would silently drop plots B and C — trading an over-count for an under-count. `plot_id` is `uuid NOT NULL` (`20260222080909_AddAuditEvents.cs:60`) and `CreateDailyLogCommand.PlotId` is a non-nullable `Guid`.
>
> Favourable: **nothing depends on the column** — no FK, no index, no RLS policy, no matview grouping.

### C1-AMENDED. The approved representation

One engagement = one row, whose spatial assertion is a **set**:

```sql
ALTER TABLE ssf.daily_logs
    ADD COLUMN plot_ids uuid[]     NOT NULL DEFAULT '{}',
    ADD COLUMN scope    varchar(10) NOT NULL DEFAULT 'Plot',
    ALTER COLUMN plot_id       DROP NOT NULL,
    ALTER COLUMN crop_cycle_id DROP NOT NULL;

-- deterministic classification of the existing 135 rows (see §I)
UPDATE ssf.daily_logs SET plot_ids = ARRAY[plot_id], scope = 'Plot';

ALTER TABLE ssf.daily_logs
    ALTER COLUMN plot_ids DROP DEFAULT,
    ALTER COLUMN scope    DROP DEFAULT,
    ADD CONSTRAINT ck_daily_logs_scope CHECK (
        (scope = 'Plot'      AND cardinality(plot_ids) = 1  AND plot_id IS NOT NULL)
     OR (scope = 'MultiPlot' AND cardinality(plot_ids) >= 2 AND plot_id IS NULL AND crop_cycle_id IS NULL)
     OR (scope = 'Farm'      AND cardinality(plot_ids) = 0  AND plot_id IS NULL AND crop_cycle_id IS NULL)
    );
```

**`uuid[]` is an established convention in this repo**, not an invention: `day_ledgers.global_expense_ids` (`FinanceV2.cs:36`), `test_instances.attachment_ids` (`AddTestStackTables.cs:59`). It also matches the client's existing `string[]` shape, so the wire needs no reshaping.

**Why `scope` is stored even though cardinality could derive it.** The probe recommended cardinality alone (`{A}` / `{A,B,C}` / `{}`). I am keeping the explicit discriminator, and the reason is the founder's own requirement: *"never NULL whose meaning has to be guessed later."* An empty array is better than NULL — `NOT NULL` removes the "unknown" state — but a reader still has to **know the convention** that `{}` means farm-wide, which is precisely the `RoutinePattern` vs `DerivedEventKey` divergence in §A4. `scope='Farm'` is self-evident to a human reading a row five years from now. The CHECK constraint welds the two together so they **cannot** disagree, which answers the probe's objection to multiple representations. Cost: one `varchar(10)`.

**`plot_id` is retained, populated only when `scope='Plot'`.** This keeps every existing single-plot reader working untouched, which is what makes this change small. `plot_ids` is the canonical set; `plot_id` is a compatibility projection of the single-plot case.

**Multi-plot spanning different crop cycles is NOT solved here** (`crop_cycle_id` is as single-valued as `plot_id`). Under this model a `MultiPlot` log carries `crop_cycle_id IS NULL`. Cross-cycle attribution is **explicitly deferred** (§N) — recording it wrongly is worse than recording it as absent.

**What this is NOT.** No `FarmContext` service. No polymorphic anchor (`plot | farm | equipment | location`). No shared scope abstraction. Two columns and a CHECK on one table. **Build the seam, not the machinery.**

### C2-AMENDED. The client change that must accompany it

The schema alone does not deliver O-2. `LogFactory`'s per-plot `forEach` must stop producing N logs for one shared engagement, and `allocateLabourForPlot` / `allocateAmountAcrossPlots` must stop fabricating per-plot headcount and money. **One engagement → one log → one `labourAssignmentId` → one `worker_count`.**

Per-plot quantities are written **only** when the farmer supplied them (`targetPlotName` present on the event). Absent that evidence, no allocation is invented — which is the founder's rule stated as code.

### C4. Original options (superseded by O-2, retained for provenance)

| | **A — nullable only** | **B — nullable + scope discriminator** | **C — keep NOT NULL, fan out per plot** |
|---|---|---|---|
| **Meaning** | plot absent | plot absent **and** scope explicitly `Farm` | one event becomes N plot rows |
| **Schema** | `DROP NOT NULL` ×2 | `DROP NOT NULL` ×2 + `scope varchar(8) NOT NULL DEFAULT 'Plot'` + CHECK | none |
| **Contract** | `plotId`/`cropCycleId` optional | same + `scope` | none |
| **Existing readers** | audit for non-null assumptions | same | none |
| **Migration** | catalog-only, no backfill | catalog-only + one defaulted column | none |
| **Future farm-level events** | inherit ambiguity | inherit the discriminator free | cannot express a plot-less event |
| **Risk** | **fuses intent with ignorance permanently** | one column six tables do without | **inflates headcount by plot count (§A3)** |

### C4b. Why B alone was insufficient (the O-2 amendment)

Option B was correct about *Entire Farm* and silent about *multi-plot*. Once the founder ruled that a shared engagement stays one engagement, `Plot | Farm` could not express `{A,B,C}`, so B is subsumed by C1-AMENDED rather than discarded: the discriminator survives, the plot reference becomes a set.

### C2. Original recommendation — **Option B** *(superseded — see C1-AMENDED)*

**C is disqualified on evidence, not taste.** §A3 is verified: fan-out already triple-counts workers on a 3-plot log. Making every farm-wide log fan out would write that inflation into canonical rows permanently, and there is no backfill job anywhere in this system.

**A is the tempting one and it is the one to refuse.** It is what six tables already do, so it looks like convention. But the founder's requirement is explicit — *"not a null case"* — and §A4 proves the ambiguity is already causing real divergence inside this codebase: `RoutinePattern.cs:49` and `DerivedEventKey.cs:24-25` read the same NULL to mean opposite things. Adding a seventh table to that pattern imports a known defect.

**B costs one column and one CHECK constraint more than A**, and both A and B require *the same migration on the same table* — so B is not the expensive option, it is the honest one at near-identical cost. It is also the moment of minimum risk: **0 labour rows, 0 orphans, RLS provably independent of `plot_id`** (verified: no policy anywhere derives tenancy from it, and all four MIS matviews are farm-keyed).

**What B is NOT.** Do not build a `FarmContext` service, a polymorphic anchor (`plot | farm | equipment`), or a shared scope abstraction. Future farm-wide events inherit these two columns for free. **Build the seam, not the machinery.**

### C3. The shape

```sql
ALTER TABLE ssf.daily_logs
    ALTER COLUMN plot_id       DROP NOT NULL,
    ALTER COLUMN crop_cycle_id DROP NOT NULL,
    ADD COLUMN  scope varchar(8) NOT NULL DEFAULT 'Plot';
ALTER TABLE ssf.daily_logs DROP DEFAULT ... ;   -- after backfilling existing 135 rows to 'Plot'
ALTER TABLE ssf.daily_logs ADD CONSTRAINT ck_daily_logs_scope CHECK (
    (scope = 'Plot' AND plot_id IS NOT NULL AND crop_cycle_id IS NOT NULL)
 OR (scope = 'Farm' AND plot_id IS NULL     AND crop_cycle_id IS NULL)
);
```

The CHECK is what makes the discriminator load-bearing rather than decorative: a `Farm` row **cannot** carry a plot, and a `Plot` row **cannot** omit one. The existing 135 rows all satisfy `scope='Plot'` by construction (0 orphans, 0 nulls).

---

## D. Server read-back architecture

**Shape:** nest `LabourEngagementDto[]` on `DailyLogDto`, as a sibling of `Tasks` and `VerificationEvents` — reusing the pull machinery rather than adding a second channel.

**Why it can be this simple:** the client-minted `labourAssignmentId` **survives as the server primary key** — proven end-to-end over the real wire (`ensureLabourAssignmentIds` → `buildLabourPayloads` → zod `ZGuid` → `CreateDailyLogHandler.cs:276` → `ValueGeneratedNever()`; asserted at `SyncEndpointsTests.cs:1214/1252/1281`). So the picker and the correction path key on the same id after a round-trip, with no mapping layer.

**Field list (current truth only):**
```
labourAssignmentId, dailyLogId, engagementType,
workerCount?, maleCount?, femaleCount?,
wagePerPerson?, contractUnit?, contractQuantity?, totalCost?,
durationHours + timeBasis    (paired — NEVER one without the other),
shift?, task?, workerNames[], createdAtUtc, linkedActivityId?,
attributedOperators[{ fieldOperatorId, displayNameAtAttach }]
```

**Deliberately excluded:** a resolved `headcount` (already in `workerCount` — recomputing it in a projection is how `P7` breaks), any per-person money, and `notes` (no column exists — see §N).

**The current-truth / history boundary:** current truth = `LabourAssignment` (mutated in place) + the live `FieldOperatorWorkRow` set, delivered on the normal pull. History = `labour_corrections`, fetched **on demand only** via `GET /farms/{farmId}/labour/assignments/{id}/corrections`, **never in pull**. The domain already states this split verbatim (`LabourCorrection.cs:13-25`): readers see corrected truth *"without knowing corrections exist"*.

**The delta trap (§A5):** `labour_assignments` has no `modified_at_utc` and corrections mutate in place. `CorrectLabourHandler` **must bump the parent `DailyLog.ModifiedAtUtc`**, or corrections never propagate.

**The reconciler guard:** `preserveLocalOnlyFields` must be **revised, not deleted**, with the predicate **"the response carried a labour field"** — *not* "the array came back non-empty", which re-opens the data loss caught in V1's final review. **The projection and the guard flip must land in the same commit.**

---

## E. Offline → server convergence

Use existing conventions; build no distributed-sync framework.

> **PATCHED 2026-08-12 (execution session). The first two bullets below replace a self-contradiction in the original §E** — it said *"Outbox is authoritative for pending state"* and, in the same sentence, *"the three UI states derive from `mutationQueue`"*. Those are **two different Dexie tables** (`DexieDatabase.ts:657-658`). Repo truth decides it. **Approved semantics (§G's three states, O-1..O-5) are unaffected** — only the mechanism was wrong, so this is a `W2` PLAN DEFECT patched in place, not a reopened design.

- **`mutationQueue` is authoritative for pending state.** It is the only store with a server-ack contract (`BackgroundSyncWorker.ts:224-226`). The three UI states derive from it — **no Dexie version bump required** (its index string is unchanged v2 → v22).
- **Cut `db.outbox` out of the status path. Do NOT wire a drain for it.** `db.outbox` has **no sender at all** — nothing reads its rows except the status chip's label, which is why `markOutboxEventSent` / `markOutboxEventFailed` / `getPendingOutboxEvents` have zero callers: there is no code path that could call them. Wiring a drain would mean building a **second sync channel**, forbidden by Global Constraint 3 and by `P1`. The truthful and far smaller fix is to point `SyncStatusService` at `mutationQueue`. Retiring the `db.outbox` table itself is **deferred** (it needs a Dexie version bump; once nothing reads it, it is inert and harmless).
- **Surface the skip.** `enqueueLogsForSync` returns `skippedLogIds`; consume it at all four call sites.
- **Correction must reach Dexie.** `updateLog` must persist, not only `setHistory` (§A7.1).
- **Prevent the double-tap duplicate.** An in-flight lock on Save (§A7.2). *Note: this does not fix the underlying fresh-id defect, which stays deferred — it removes the reachable path.*
- **Retry cap must not be silent.** A row at the cap becomes `NEEDS_FIX`, visible and manually retryable (§A7.3).
- **Server dedupe stays the backstop** — `ISyncMutationStore.TryStoreSuccessAsync` on `(deviceId, clientRequestId)`.

---

## F. Permission extension

**Storage: one additive column on `farm_memberships`** — `can_manage_labour_records boolean NOT NULL DEFAULT false`. One `ALTER TABLE ADD COLUMN`, **no new RLS** (the existing `p_tenant_farm_memberships` is FOR ALL with a WITH CHECK), and **zero blast radius** on the 27 in-tree `IShramSafalRepository` implementors provided the new port member ships a default body.

Rejected: a `farm_member_capabilities` grant table (70–90 lines + two new policies, buying flexibility nothing needs); and extending `AppRole` (wrong — roles are identity-shaped and already over-loaded).

**Effective predicate** (one helper, used by all five governed actions):
```
PrimaryOwner or SecondaryOwner  →  always allowed
Mukadam                         →  allowed by default
any other role                  →  allowed ONLY if can_manage_labour_records
```

**Grant/revoke** needs a new farm-scoped endpoint (none exists) wired to the **already-built** `TeamMemberCard` toggles, replacing their local-only state.

**This plan makes the three inconsistent gates (§A8) uniform.** That includes bringing approve/verify — currently owner-only — under the same predicate, which **restores the Mukadam's ability to verify**. Flagged in §O as a behaviour change requiring explicit sign-off.

---

## G. UI honesty states

Three states, derived from the outbox, no schema change:

| State | Meaning | Marathi (field-testable) |
|---|---|---|
| `ON_PHONE` | captured locally, not yet sent | फोनवर सेव्ह ✓ |
| `ON_SERVER` | server acknowledged | पाठवलं ✓ |
| `NEEDS_FIX` | rejected, retry-capped, or never enqueued | अडकलं — तपासा |

`NEEDS_FIX` deliberately folds in the currently-silent cases: `REJECTED_USER_REVIEW`, `retryCount >= 5`, and never-enqueued (`skippedLogIds`). **No success wording may fire before acknowledgement** — including the `मंजूर केलं` overlay that currently fires before the enqueue.

> **PATCHED 2026-08-12 (execution session) — one of the three `NEEDS_FIX` cases was implemented differently, and this is the record of that deviation. It was found by the whole-phase review, not absorbed silently.**
>
> **`REJECTED_USER_REVIEW` and `retryCount >= 5` fold into `NEEDS_FIX` as written.** **Never-enqueued (`skippedLogIds`) does NOT.**
>
> **Why.** `अडकलं — तपासा` means *"the system is stuck and you can act."* A never-enqueued log is in **no queue at all** — `resolveSyncTarget` returns null and `enqueueLogsForSync` `continue`s before any row is written — so `BackgroundSyncWorker` will never retry it and the drawer cannot list it. Routing it to `NEEDS_FIX` would send the farmer to check a place where the record does not appear and no action exists. That is `P5` inverted: a door painted on a wall. (Same reasoning retired `तपासा` from the save toast — finding B3.)
>
> **What was built instead.** An unqueueable record **weakens the chip's claim** rather than strengthening its alarm: it suppresses `ON_SERVER` and falls back to `ON_PHONE`, which is true and provable (`confirmAndSave` wrote the log to `db.logs` before the enqueue was attempted) and is the **same** claim the toast and the panel badge already make about that record — so four surfaces say one thing (`features/sync/status/unqueueableLogs.ts`, commit `e290a4be`).
>
> **This closed a real, reachable contradiction.** `ON_SERVER` had required `acknowledgedCount > 0`, but `APPLIED` rows are **never pruned**, so on any device that has ever synced once the condition holds permanently — and `ON_SERVER` was again produced by the mere *absence* of open rows, which is exactly what a dropped record looks like. The farmer saw `पाठवलं ✓` in the sticky header directly above a badge reading `फोनवर सेव्ह ✓ — cannot be sent`, about the record they had just created.
>
> **KNOWN LIMIT — carried, not hidden.** The suppression is **session-scoped module state**. It is gone on reload, after which the chip again reads a queue the record was never in. Durable state needs a Dexie version bump Phase 1 is not permitted to make, and with no clearing path it would latch `ON_PHONE` forever. **Phase 2 changes the schema AND removes the dominant cause of these skips** (a farm-scoped log becomes storable), so the durable half belongs there. What is closed here is the window the farmer can actually see.

---

## H. Exact change surface

**DB (3 migrations, all approved).** ① `daily_logs`: `plot_ids uuid[]` + `scope` + nullability on `plot_id`/`crop_cycle_id` + deterministic classification of the 135 rows + CHECK. ② `farm_memberships.can_manage_labour_records`. ③ `labour_assignments.notes` (**now in scope — O-3 approved**).
No semantic backfill (§I).

**Backend — modified:** `DailyLog.cs` · `DailyLogConfiguration.cs` · `CreateDailyLogHandler.cs` (guards conditional on scope) · `CreateDailyLogCommand.cs` · `PushSyncBatchHandler.cs` (allow-list + mapping) · `LogsEndpoints.cs` · `DailyLogDto.cs` (+`LabourEngagementDto`) · the sync-pull query/projection · `CorrectLabourHandler.cs` (bump parent `ModifiedAtUtc`) · `FarmMembership.cs` + config · `IShramSafalRepository.cs` (default bodies) · `ShramSafalRepository.cs` · `InMemoryShramSafalRepository.cs` · `LabourEndpoints.cs` · `MembershipEndpoints.cs` (grant/revoke) · the four field-operator/correction handlers (uniform predicate) · `ShramSafalAuthorizationEnforcer.cs`.

**Contract:** `create_daily_log.zod.ts` (+`scope`, optional plot/cycle) → regenerate `CreateDailyLogPayload.cs` (**never hand-edit**) · the pull DTO shape.

**Frontend — modified:** `CropSelector.tsx` (scope intent) · **`LogFactory.ts:129` and `:502` — stop the per-plot `forEach` producing N logs for one shared engagement; carry the full `selectedPlotIds` onto the persisted log (`:137-144`, `:509-514`)** · **`log-factory-helpers.ts` — `allocateLabourForPlot:88` (headcount broadcast) and `allocateAmountAcrossPlots:215-224` (invented money split); both stop fabricating without farmer evidence** · `logSyncMutationService.ts` (`resolveSyncTarget`, `resolveLogFarmId`, `enqueueLogsForSync`, and the `[0]` plot pick at `:254`) · `logsReconciler.ts` (**`selectedPlotIds` §A5 landmine + guard revision**) · `useLogCommands.ts` ×4 · `UpdateLog.ts` (persist) · `ReviewSheet.tsx` · `SyncStatusService` / `SyncIndicator` / outbox drain · `TeamMemberCard.tsx` + `IdentitySection.tsx` (real grant) · `FieldOperatorPicker.tsx` (placeholder examples).

**Readers that must be audited for the un-split shape (O-2 blast radius, probe-verified).** Sharp: `logSyncMutationService.ts:254` (push takes `[0]`) · `logsReconciler.ts:235` (pull collapse) · `LedgerDerivationService.cs:82,88` (cost attribution) · `EvaluateComplianceHandler.cs:36` + `ShramSafalRepository.cs:337-345` (**false compliance breaches** if a multi-plot log stops appearing per-plot) · `appContentDailyCounts.ts:90` (day tiles triple-count today). Already tolerant, no change expected: `dayState.ts`, the four MIS matviews, the verification FSM, exports — and `costAnalysisHelpers.ts:153`, which **already pro-rates and was written for the un-split shape**.

**Tests:** a section is mandatory — see §K.

**Not touched:** `cost_entries`, `job_cards`, the five `LabourPersonDto` mirrors, prompt files, `outputContract.md`, the golden set.

---

## I. Migration / backfill strategy

- **No semantic or inferred historical backfill is required. Existing valid plot-scoped `DailyLogs` are deterministically classified as `scope='Plot'` with `plot_ids = ARRAY[plot_id]` during the migration.** We are not reconstructing missing farmer intent — we are classifying rows whose `plot_id` and `crop_cycle_id` already prove their meaning. Measured evidence supporting the determinism: **135 existing rows · 0 plot orphans · 0 crop-cycle orphans** (§A1).
- **Apply the five unapplied V1 migrations first** — that is the only sequencing constraint.
- **Measure live prod `ssf.daily_logs` before deploying.** The 135 figure is `agrisync_dev_v2`, not production. Measure, never predict.
- Every rehearsal on a throwaway `ssf_<purpose>_{Guid:N}` applied via `IntegrationMigrationChain`. Never `agrisync_dev_v2`. Never `make boot` (it swallows migration failure).
- Every `Down()` **executed**, not merely written; policies dropped before tables.

---

## J. Ordered execution phases

**Phase 0 — founder decisions (§O). No code.**

**Phase 1 — Honesty backstop.** Independent, ships first, de-risks everything after: consume `skippedLogIds`, **point the status chip at `mutationQueue` and cut the dead `db.outbox` out of the status path** *(patched 2026-08-12 — see §E)*, wire the three states, remove premature success wording, surface the retry cap. *A farmer stops being told "saved" for a dropped log even if the rest slips.*

**Phase 2 — Farm context durable (Plot / MultiPlot / Farm).** Migration ① + domain + conditional guards + contract regeneration + client scope intent + reader audit (§H list).

**Phase 2b — One engagement, one quantity (O-2).** Stop `LogFactory`'s per-plot split; stop `allocateLabourForPlot` broadcasting headcount and `allocateAmountAcrossPlots` inventing money; one `labourAssignmentId` per engagement. **Depends on Phase 2** — without `plot_ids`, not splitting would drop plots. Per-plot quantities persist **only** where the farmer supplied them.

**Phase 3 — Read-back.** Projection **and** reconciler-guard revision **and** the `selectedPlotIds` fix, **as one change**. Plus the `ModifiedAtUtc` bump.

**Phase 4 — Convergence.** Correction persists locally; in-flight lock; farm-wide correction path (note `resolveLogFarmId` resolves farm *through the plot*, so Gate B correction is dead for farm-wide logs until Phase 2 lands).

**Phase 5 — Capability.** Migration ② + uniform predicate + grant endpoint + real toggles. **Independent of 1–4; may run in parallel from the start.**

**Phase 6 — Instructional examples.** UI-only, last, no coupling.

---

## K. Test strategy

Index verification to **surfaces**, not tasks — then it is mechanical.

**Per commit (fast):** only the suite owning the changed layer. Domain-only → `DOMAIN`. Frontend-only → `npm test` scoped by path. `ARCH` on any commit adding a file under `src/apps/**`. Never `--reporter=basic`.

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

**Phase boundaries:** all five suites **plus** the runtime proofs — fresh-DB migration chain; RLS as `agrisync_app` with the vacuity guard first; both cross-farm directions; a real HTTP round trip against a running Bootstrapper; and **device-reset reconstruction** (clear Dexie → pull → labour present, correct headcount, correct basis). Run the full five twice only at a boundary that first executed a new migration.

Record **baseline → added → actual**. Never predict a total.

---

## L. Acceptance journeys

1. **Entire Farm** — select संपूर्ण शेत → 8 workers → save → server receives → reload → still Entire Farm, **and `scope='Farm'` with `plot_id IS NULL` in the row**; no fake plot or cycle anywhere.
2. **Clean device** — Phone A records → server acks → Phone B clean install → login → same workers, history, attribution, corrections, current truth.
3. **Offline** — no network → captured → farmer sees फोनवर सेव्ह, **never** पाठवलं → network returns → becomes पाठवलं → fresh device sees it.
4. **Correction** — 8 → 6 → reload → 6; **second device** → 6; history still explains 8 → 6 with actor and time.
5. **Permission** — ordinary member blocked → owner grants via the Team card → allowed → owner revokes → blocked. Farm-scoped: a grant on Farm A does nothing on Farm B.
6. **Examples** — new farmer sees placeholder guidance; **`SELECT count(*) FROM ssf.field_operators` = 0**.
7. **Headcount regression** — 8 workers + 3 attributed still reports **8**, asserted at the wire DTO, not only in the database.
8. **Multi-plot truth (MANDATORY — O-2).** The current system is *proven* to inflate this figure, so this journey is not optional:
```text
Select Plot A + B + C
→ report 8 workers as ONE shared engagement
→ save
→ server stores ONE canonical labour quantity = 8   (scope='MultiPlot', plot_ids={A,B,C})
→ reload                                    → still 8
→ clean second device                       → still 8
→ context still identifies A + B + C
→ NEVER 24
→ NO fabricated per-plot allocation (no 3/3/2 in headcount OR money)
→ ONE labourAssignmentId, addressable by attribution and correction
```

---

## M. Rollback strategy

- Every migration has an executed `Down()`. ① drops the CHECK, drops `scope`, restores `NOT NULL` — **safe only while no `scope='Farm'` rows exist**; once they do, rollback requires a documented decision about those rows. State that in the deployment runbook.
- RDS snapshot floor before any prod migration; snapshot re-verified at each gate transition.
- Schema and binary move together — no out-of-band DB change.
- Phase 1 is independently revertible and touches no schema.
- `labour-v1-green` remains the immutable comparison point.

---

## N. Deferred scope (explicit)

**Moved INTO scope by founder decision:** labour `notes` persistence (O-3) and multi-plot headcount/money truth (O-2) — both are now Phase 2b / migration ③.

Still deferred:
- **Cross-crop-cycle multi-plot attribution.** `crop_cycle_id` is as single-valued as `plot_id` was; a `MultiPlot` log spanning plots on different cycles carries `crop_cycle_id IS NULL`. Recording a cycle wrongly is worse than recording it as absent. Revisit only when a farmer journey demands it.
- A second-device **live** conflict UI beyond `NEEDS_FIX`.
- The `LogFactory` fresh-id re-confirm defect — Phase 4 removes the reachable double-tap path, not the root cause.
- Audit events on the field-operator handlers.
- Marketplace, reputation, payments, per-person settlement · `LinkedUserId` in any form · WTL v0 retirement.

---

## 🛑 Founder Acceptance Gate

- [x] **Founder reviewed and APPROVED this plan, 2026-08-12.**
- [x] **Founder answered all of §O** — decisions recorded below and reconciled into §C, §D, §H, §I, §J, §L, §N.
- [ ] Nothing merged, nothing deployed until the acceptance journeys in §L are demonstrated.

> **Architecture is CLOSED.** Do not re-open this through another architecture or verifier loop. Escalate **only** if repository evidence proves one of the approved semantics technically impossible.

---

## O. Founder decisions — ALL ANSWERED 2026-08-12

| | Decision | Reconciled into |
|---|---|---|
| **O-1** | **APPROVED — explicit scope + nullable plot/crop + DB constraint.** Entire Farm is an intentional domain assertion, never an arbitrary plot, fake cycle, sentinel, "first available plot", or a NULL whose meaning must be guessed. | §C1-AMENDED |
| **O-2** | **Option C semantics.** *One shared engagement stays one engagement even when its context contains multiple plots.* `8 workers across A+B+C` = `WorkerCount 8, context {A,B,C}` — **never** 8/8/8, and **never** an invented 3/3/2 unless the farmer supplied per-plot figures. | §C0, §C1-AMENDED, §C2-AMENDED, §H, §J Phase 2b, §L journey 8 |
| **O-3** | **APPROVED — persist labour notes server-side.** If the product lets a farmer enter a note, it must survive capture → write → read-back → clean-device reconstruction. No generic notes subsystem. Migration ③ is now in scope. | §H, §D, §N |
| **O-4** | **APPROVED — Owner always; Mukadam by default; others only when explicitly granted**, via the existing farm access-management experience. No second role system, no subscription entitlements. The approve/verify path that excludes Mukadam is therefore corrected. | §F |
| **O-5** | **APPROVED — `labour-v1-green` stays immutable; V1 does NOT merge to `main`.** The fresh session cuts `feat/labour-phase2-server-truth` from that checkpoint. | Handoff §13 |

### Original O text (provenance)

**O-1. Entire Farm representation.** Recommendation: **Option B** (nullable + explicit `scope`). Confirm, or choose A.

**O-2. The existing multi-plot headcount inflation (§A3).** A 3-plot log of 8 workers reports 24 man-days *today*. Options: **(a)** fix only farm-wide scope, leave multi-plot as-is; **(b)** allocate headcount the way money already is; **(c)** stop splitting a shared engagement per plot at all — one engagement scoped to the selection, the same shape Entire Farm needs. **(c) is the coherent end state and the largest change; it alters figures a farmer may already have seen.**

**O-3. Labour `notes`.** The farmer's note reaches the server and is discarded (no column). Add a nullable `notes` column, or stop sending it and say so honestly in the UI?

**O-4. Approve/verify currently excludes the Mukadam** (`ShramSafal.Infrastructure/Auth/ShramSafalAuthorizationEnforcer.cs:62` — `OwnerRoles = [AppRole.PrimaryOwner, AppRole.SecondaryOwner]`, controller-verified), contradicting your stated intent. Making the five actions uniform **restores** Mukadam verification. Confirm that behaviour change.

**O-5. Branch.** Confirm `feat/labour-phase2-server-truth` cut from `labour-v1-green`, with V1 **not** merged to `main` yet.
