# Co-Founder Execution Plan — Shared-Farm Foundation (Stage A)

**Status:** PLAN ONLY — nothing built, nothing branched. Awaiting founder approval.
**Author:** Claude · **Date:** 2026-08-30
**Companion documents:** `_COFOUNDER/specs/_inbox/2026-08-30-farm-workspace-multi-actor-model-IDEALOG.md`
(the three captured ideas + cross-verification), `2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md`.

---

# What I understood from the founder

1. You are **not** asking me to build the worker marketplace, worker profiles, ratings,
   reputation, matching, or an agronomist portal. Those are explicitly out.
2. You are asking me to protect **facts that cannot be reconstructed later**, before real
   farmers start creating history.
3. `feat/labour-v2-r1` must be treated as **untouchable** by this workstream — not modified,
   not rebased, not cherry-picked, and never treated as if it were already production.
4. I must branch from the **actual deployed production trunk**, not from whatever branch happens
   to be checked out.
5. Trunk-based: one short-lived branch → review → merge → deploy → verify → *then* the next
   workstream branches from the new truth.
6. Stage A builds only what is genuinely **independent** of Labour V2.
7. Stage B — worker attribution and identity integration — happens **only after** Labour V2 is
   genuinely merged and deployed, re-baselined against what actually shipped.
8. Deferring worker attribution is a **sequencing** decision, not a change of product requirement.
   The requirement stays locked.
9. Real farm reality must survive: 8 worked, 3 identifiable, 5 unresolved — preserve all three
   truths, invent nothing, never merge by name.
10. Multi-plot: the farmer speaks **once**, but the resulting facts must be independently
    addressable per plot, so plot-scoped access is possible later.
11. Raw voice evidence and derived structured truth may need different visibility. Do not build
    the policy now; do not make it impossible later.
12. Historical actor role must not change when someone's membership role changes later.
13. Legitimate concurrent work by multiple people must never be suppressed by duplicate-protection.
14. I must tell you plainly when the repository contradicts one of your assumptions.
15. Plan first. No implementation until you approve.

---

# 1. Current Reality

| Question | Answer | Evidence |
|---|---|---|
| Local HEAD | `3bc36ebf` on `task/file-size-cap` | `git rev-parse HEAD` |
| `origin/main` | **`a7784b18`** | `git rev-parse origin/main` |
| `main` vs `origin/main` | **0 / 0 — identical** | `git rev-list --left-right --count` |
| Deployed API | **`a7784b18`** — `/version` 200, `deployedAt=20260828T020959Z` | `DEPLOYMENT_TRACKER.md:75` |
| Deployed web | bundle `index-C9_2UdtS.js`, v1.0.9 / versionCode 17, built from main `6a579f64` | `DEPLOYMENT_TRACKER.md:76` |
| Prod compute | **HIBERNATED by design** — wake via `aws/hibernate/wake.sh` | tracker rules §5 |
| Prod migrations | 100, newest `20260828061500_WidenCorrectionEventPromptVersion` | tracker |

**Trunk and deployed API agree exactly.** `a7784b18` is an unambiguous branch point. The web
bundle is one PR behind (`6a579f64`), which is a frontend-only label bump and does not affect
this workstream.

### The multi-plot reality

`DailyLog.Scope` is a three-way enum — `Plot | MultiPlot | Farm` (`ShramSafal.Domain/Logs/DailyLog.cs`).

- **MultiPlot = ONE row** carrying `plot_ids >= 2`, with the compatibility `PlotId` NULL.
- Created from two paths: online `CreateDailyLogHandler.cs:190,405` and offline
  `PushSyncBatchHandler.cs:913`.
- Validation is strict and good: every plot is resolved and checked against the farm; duplicates
  and empties rejected.
- **Derived operations for a MultiPlot log get NO plot at all** —
  `LedgerDerivationService.cs:487` returns `null` for MultiPlot.

### Role at action time — largely already built

`AuditEvent.ActorRole` **exists and is populated** (`ShramSafal.Domain/Audit/AuditEvent.cs:97`).
The gap is **quality of what is written**, not absence of a field:

| Pattern | Examples |
|---|---|
| ✅ Real resolved role | `AcknowledgeSignalHandler:65`, `ResolveSignalHandler:66`, `CreatePlotHandler:91` |
| ⚠️ Client-supplied, unverified, defaulted | `CreateAttachmentHandler:65`, `UploadAttachmentHandler:69`, `CreateCropCycleHandler:113`, `UpdateFarmBoundaryHandler:102` — all `command.ActorRole ?? "unknown"` |
| 🔴 Hardcoded literal | `ParseVoiceInputHandler:389` → `"operator"`; `IssueFarmInviteHandler:115` → `"primaryowner"` |
| ✅ Legitimately constant | `EvaluateComplianceHandler:344` → `"system"` |

### Concurrency — safe today, unprotected

`daily_logs` unique index is on `IdempotencyKey` **only**. `(FarmId, LogDate)` is indexed, **not**
unique. Two actors on the same farm/day/plot correctly produce two rows. **No test pins this.**

### Existing correlation primitives

`DailyLog` already carries `IdempotencyKey`, `SourceAiJobId`, and `EvidenceRefs` jsonb
(`[{type:'voice', voice_capture_id: …}]`). Sync carries `DeviceId` + `ClientRequestId`.

---

# 2. Labour V2 Isolation Boundary

Files `feat/labour-v2-r1` modifies on the backend — **I will not touch any of these in Stage A**:

```
ShramSafal.Api/Endpoints/LabourEndpoints.cs
ShramSafal.Application/Contracts/Dtos/DailyLogDto.cs
ShramSafal.Application/Contracts/Dtos/DtoMappingExtensions.cs
ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs
ShramSafal.Application/Ports/IShramSafalRepository.cs
ShramSafal.Application/UseCases/AI/ParseVoiceInput/ParseVoiceInputHandler.cs
ShramSafal.Application/UseCases/Labour/GetLabourData/*  (4 files)
ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs
ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs      ← ⚠️
ShramSafal.Application/UseCases/Logs/CreateDailyLog/ILedgerDerivationService.cs
ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs    ← ⚠️
ShramSafal.Domain/Dfes/DayClassifier.cs
ShramSafal.Domain/Farms/LabourAssignment.cs
ShramSafal.Domain/Farms/LabourHeadcount.cs
ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs
```

Plus ~90 frontend files (labour hub, reflect, sync reconcilers, work pages, i18n).

**Why this boundary is the problem, not a formality:** the two files marked ⚠️ are precisely where
multi-plot logs are created and where their derived scope is decided.

---

# 3. 🔴 Founder assumptions contradicted by current code

## Contradiction 1 — Stage A as scoped is NOT independent of Labour V2

You asked me to verify independence before including items. I did. **Four of the five Stage A
items are not independent.**

| Item | Independent? | Why |
|---|---|---|
| A1 Multi-plot | ❌ **No** | Lives in `CreateDailyLogHandler.cs` + `LedgerDerivationService.cs` — both edited by V2 |
| A2 Capture correlation | ❌ **No** | Must be written at log creation — same handler; also touches `DailyLogDto` + sync |
| A3 Role at action time | ⚠️ **Partly** | The audit field exists. Fixing *most* writers is independent; the voice writer (`ParseVoiceInputHandler`) is edited by V2 |
| A4 Concurrency guard | ✅ **Yes** | Test-only. Touches no production file |
| A5 Evidence boundary | ✅ **Yes** *(as a written design constraint; no code)* | Design decision, not an implementation |

Building A1 and A2 now would mean editing the same two files V2 is editing — producing exactly
the merge/rework cost this instruction exists to avoid.

## Contradiction 2 — decision O-1 already ruled on splitting per plot

`LedgerDerivationService.cs` states, about MultiPlot logs:

> *"Picking the first plot, or writing one operation per plot, are the two fabrications **founder
> decision O-1 closed**."*

You have already ruled that **writing one derived record per plot is a fabrication** — and O-1's
stated justification is that *"the true scope stays recoverable from
`farm_operations.source_daily_log_id → daily_logs.plot_ids`."*

A1 would remove that anchor: if the DailyLog itself splits, `plot_ids` no longer holds the set,
and O-1's rationale no longer applies. **A1 therefore requires O-1 to be revisited**, not merely
implemented. This is a decision, not a task.

## Contradiction 3 — A3 is smaller than described

Role-at-action-time is not missing architecture. The column exists and is written. The real
defect is that several writers store `"unknown"`, a hardcoded literal, or an **unverified
client-supplied string**. That last one matters most: today a client can *tell* the server what
role it was acting in, and the server records it without checking.

---

# 4. Recommended sequencing — a change to your proposal

Your trunk-based rule is right. The **contents** you assigned to Stage A are the problem.

Given Labour V2 Phase 0 is **code-complete and blocked only on your acceptance gate**, the fastest
route to a clean, collision-free foundation is to let it land first:

```
NOW    Founder ticks Phase 0 acceptance gate            (your ~20 min, no build)
       Stage A0 runs in parallel — genuinely independent only
          - concurrency guard test
          - actor-role honesty fix (non-V2 writers)
          - evidence-boundary design decision, written
              |
       Labour V2 R1 completes its own lifecycle -> merge -> deploy -> verify
              |
              v
       NEW TRUNK  (V2 in production)
              |
       Stage A1 branches from that trunk
          - multi-plot correction  (needs the O-1 ruling)
          - capture correlation
              |
       merge -> deploy -> verify
              |
              v
       Stage B — worker attribution integration
```

**Stage A0 (now, ~1–2 days, zero collision):**
- **A4** concurrency guard test — pins that two genuine actors produce two records while a retry
  produces one. Test-only.
- **A3-partial** actor-role honesty — replace `"unknown"` defaults and hardcoded literals with
  the server-resolved role, in the writers V2 does not touch. Includes the
  `IssueFarmInviteHandler` `"primaryowner"` defect.
- **A5** written decision: source evidence vs derived structured truth, recorded so the later
  multi-plot design cannot foreclose it.

**Stage A1 (after V2 lands):** multi-plot + capture correlation, from the new trunk.

---

# 5. Stage A0 detail

### A4 — Multi-actor concurrency guard

- **Current behaviour:** two actors on the same farm/day/plot correctly produce two rows.
- **Problem:** nothing pins it. A future duplicate-cleanup could add a unique constraint and
  silently destroy multi-actor operation.
- **Minimum change:** integration test against real Postgres. Two distinct actors, same
  farm/date/plot ⇒ **two** rows. Same `ClientRequestId` retried ⇒ **one** row.
- **Independent because:** test-only; touches no production file.
- **Migration / sync / privacy impact:** none.
- **Rollback:** delete the test.

### A3-partial — Actor role honesty

- **Current behaviour:** `AuditEvent.ActorRole` populated inconsistently — real role in some
  paths, `"unknown"` or a hardcoded literal in others, unverified client input in others.
- **Problem:** an audit ledger that records a role nobody verified is not evidence. The
  `"primaryowner"` literal will actively lie once a SecondaryOwner can share the invite QR.
- **Minimum change:** resolve the role server-side (`GetUserRoleForFarmAsync`) at write time for
  the affected writers; stop accepting it from the client.
- **Scope limit:** only writers **not** in the V2 file list. `ParseVoiceInputHandler` is deferred.
- **Migration impact:** none — column exists.
- **Sync impact:** commands stop carrying `ActorRole`; server derives it. Pre-pilot, permitted by **D10**.
- **Privacy impact:** none.
- **Tests:** one per corrected writer asserting the stored role equals the server-resolved role,
  and that a client-supplied role is ignored.
- **Rollback:** revert; the column tolerates both.

### A5 — Evidence boundary (decision only, no code)

Record the rule: **derived structured facts may be shared at a narrower scope than the source
evidence that produced them.** No policy engine, no code. It exists so the Stage A1 multi-plot
design cannot accidentally make it impossible.

---

# 6. Branch and Deployment Strategy

| | |
|---|---|
| **Source SHA** | `a7784b18` (`origin/main`, == deployed API) |
| **Branch name** | `task/farm-foundation-a0` |
| **Contents** | A4 + A3-partial + A5 only |
| **Commits** | one per item, conventional format |
| **Merge gate** | `gate` CI green; no file from the V2 isolation list touched (mechanically checked with `git diff --name-only`) |
| **Deploy gate** | **None.** CTO ruling 2026-08-31: this change does not earn its own deploy — it alters the content of an audit column with zero farmer-visible effect. It rides the next routine backend deploy (the one carrying Labour V2) as a passenger. No production wake, no `DEPLOYMENT_TRACKER.md` row |
| **Verification** | `/version` = new SHA; `/health` 200; audit rows show resolved roles |
| **Risk tier** | Low — no schema change, no farmer-facing surface |

Stage A1 gets a **fresh branch from the post-V2 trunk**. No long-running mega-branch.

---

# 7. Stage B Re-Baseline Gate — how "Labour V2 is live" gets decided

Not by a document, a branch, or a completed plan. All four must hold:

1. `git merge-base --is-ancestor feat/labour-v2-r1 origin/main` succeeds — the work is genuinely on trunk.
2. `DEPLOYMENT_TRACKER.md` carries a row whose `/version` SHA contains that merge.
3. `https://api.shramsafal.in/version` returns that SHA — live, not claimed.
4. Any V2 migration is present in prod, migration count reconciled.

If any fails: **STOP**, report *"Labour V2 is still not production truth"*, and defer.

---

# 8. Deferred Integration Plan Outline (Stage B — questions only, not a design)

To be re-answered **from the deployed implementation**, not from the V2 plan:

- What attendance entities actually shipped, and at what grain?
- Did `FieldOperator` gain the D15 fields (nullable mobile, nullable `introduced_by`)?
- How is a known worker linked to a day — and is that per-log or per-day?
- How are unresolved workers represented alongside known ones?
- What survives the offline path, and what is reconstructable server-side without the device?
- Does anything shipped conflict with the plot-level model from Stage A1?
- **The open ruling:** does today's brief §2 reverse `D9.11` (Layer C cut), or does it mean
  `D9.10` item 5 (minimum durable identity)? Still unresolved.

---

# 9. Definition of Done before pilot

**True after Stage A0:** legitimate concurrent multi-actor work is protected by a test that will
fail if anyone breaks it · the audit ledger records a role the server verified, not one a client
asserted · the evidence-visibility boundary is a written constraint.

**True after Stage A1:** one farmer utterance produces plot-addressable facts · those facts remain
traceable to one capture · plot-scoped access is *possible* (not yet built).

**Deliberately still unfinished:** worker attribution · durable worker identity fields · attendance
composition · plot-scoped authorization enforcement · any worker-facing product.

---

# 10. FOUNDER RULINGS RECEIVED — 2026-08-30. Plan APPROVED.

Full text in the IDEA LOG under **FOUNDER RULINGS**.

| # | Ruling | Effect |
|---|---|---|
| **R1** | Resequencing **APPROVED** | §4 stands; Stage A0 proceeds now; isolation-list check retained |
| **R2** | O-1 principle **preserved**, storage conclusion **revised** | One operation stays one operation; its facts may be stored at the smallest truthful access scope, provably joined by one capture identity. A1 only after V2 is live |
| **R3** | D9.11 **superseded — Layer C back IN** | Mandatory pre-pilot; implementation deferred to Stage B. Do not reopen *whether*, only *how* |
| **R4** | Partial identification is normal | Preserve total quantity + known identities + unresolved remainder; no fabricated identities, no name merges |
| **R5** | Stage gates strict | Fresh branch per stage; verify V2 genuinely live before A1, else **STOP** |
| **R6** | Final principle | *Do not manufacture operations for database convenience, and do not combine access scopes for domain convenience.* |

## 10.1 NEW — Worker-side confirmation (IDEA 4)

Accepted as a **Stage B extension**; **not** in A0 or A1. Two bindings on earlier stages:

**(a) Stage B design constraint, effective now.** Do not build `worker_id attached to work` and
only later discover the model cannot preserve **which version the worker acknowledged**. Stage B
must support independent acknowledgement of a *specific version* of a *specific worker's* work
fact, with `direct` / `proxy` / `pending` / `issue raised` / `unable to contact` kept as different
truths — never collapsed into "verified".

**(b) A1 becomes a hard prerequisite.** Ramesh confirming Plot A must not expose Santosh's wage or
Plot B. Confirmation is only safe once one capture yields plot-addressable facts.

**Future doctrine recorded:** confirmation is *evidence*, never *entitlement to wages*.
ShramSafal claims corroboration, never proof. **Not decided:** channel and cadence.

**Execution plan:** `docs/superpowers/plans/2026-08-30-stage-a0-foundation.md`
