# Stage A0 — Claimed Files. Read this before editing, Labour V2.

**For the agent working `feat/labour-v2-r1`.** Written 2026-08-31 from the actual branches, not from prose.

**Why you are reading this.** Stage A0 (`task/farm-foundation-a0`, branched from `a7784b18`) runs a guard that recomputes *your* changed-file set live and refuses to touch anything on it. That protects A0 from you. **Nothing protects you from A0**, and nothing stops you from later editing a file A0 has already committed — which would make A0's guard fail on work it did legitimately, and block it. This file closes that loop.

Full context: `docs/superpowers/plans/2026-08-30-stage-a0-foundation.md` (Revision 3) and `docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md`.

---

## The one-line summary of what A0 does

It records the actor's role **on the farm being acted on** in the audit ledger, instead of the single global role their login token carries. Plus a schema-invariant test and one architecture document. **No migration. No labour code. No farmer-facing change. No deploy of its own** — it rides your deploy as a passenger.

---

## 🔴 Files A0 claims — please do not edit these

### Already committed on `task/farm-foundation-a0`

```
ops/stage-a0/check-labour-v2-isolation.sh
```

### Will be edited by A0 Tasks 3–8 (planned, not yet committed)

**Highest collision risk — this one is on your side of the house:**
```
src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs
```
A0 edits **only** lines ~826-836 and ~1844-1853 — converting two positional command constructions to named arguments, then removing one `ActorRole:` argument from each. It touches nothing else in that 1900-line file. **You do not touch it today** (verified 2026-08-31), but it is the sync path and your work is about labour persistence, so it is the one to watch. If you need it, say so before editing and A0 will re-sequence.

**Application — handlers and their command records:**
```
.../UseCases/Farms/UpdateFarmBoundary/UpdateFarmBoundaryHandler.cs
.../UseCases/Farms/UpdateFarmBoundary/UpdateFarmBoundaryCommand.cs
.../UseCases/CropCycles/CreateCropCycle/CreateCropCycleHandler.cs
.../UseCases/CropCycles/CreateCropCycle/CreateCropCycleCommand.cs
.../UseCases/Attachments/CreateAttachment/CreateAttachmentHandler.cs
.../UseCases/Attachments/CreateAttachment/CreateAttachmentCommand.cs
.../UseCases/Attachments/UploadAttachment/UploadAttachmentHandler.cs
.../UseCases/Attachments/UploadAttachment/UploadAttachmentCommand.cs
.../UseCases/Memberships/IssueFarmInvite/IssueFarmInviteHandler.cs
```

**Api:**
```
src/apps/ShramSafal/ShramSafal.Api/Endpoints/FarmEndpoints.cs          (:227, :296)
src/apps/ShramSafal/ShramSafal.Api/Endpoints/AttachmentEndpoints.cs    (:62, :145)
```

**Tests — all NEW files, no conflict possible:**
```
src/tests/ShramSafal.Domain.Tests/Audit/RoleRecordingRepositoryStub.cs
src/tests/ShramSafal.Domain.Tests/Audit/ActorRoleIsFarmScopedTests.cs
src/tests/ShramSafal.Sync.IntegrationTests/Concurrency/MultiActorLogConcurrencyRealPostgresTests.cs
```

**One existing test file:**
```
src/tests/ShramSafal.Sync.IntegrationTests/Tenancy/FarmBoundaryRlsRealPostgresTests.cs   (:625 only)
```

**Docs:**
```
docs/superpowers/specs/2026-08-30-evidence-vs-derived-truth-boundary.md   (new)
docs/superpowers/plans/2026-08-30-*.md
```

---

## ✅ What A0 will NOT touch — your territory, guaranteed by a script

A0's guard recomputes your changed-file set on every run and fails closed. As of 2026-08-31 that is **123 files** at your tip `2cb19456`, including all of:

- every `Labour/**` use case, `LabourAssignmentFactory`, `LabourAssignment`, `LabourHeadcount`
- `CreateDailyLogHandler`, `LedgerDerivationService`, `ILedgerDerivationService`
- `ParseVoiceInputHandler`, `DayClassifier`
- `IShramSafalRepository`, `ShramSafalRepository`
- `DailyLogDto`, `DtoMappingExtensions`, `LabourDataDto`, `LabourEndpoints`
- **`src/tests/ShramSafal.Domain.Tests/Work/Handlers/StubShramSafalRepository.cs`** — A0 subclasses it in a new file rather than appending to it, precisely because you append 37 lines at its EOF
- all 18 test files you touch
- every frontend file you touch

**A0 also will not:** add a migration · change any labour behaviour · touch attendance · touch worker identity · touch `FieldOperator` · implement Layer C · change multi-plot · wake production.

---

## Two things A0 found that affect you

**1. A live latent defect, not introduced by A0.** The analytics `actor_role` column is `varchar(16)` (`AnalyticsEventConfiguration.cs:53-56`), and `AppRole.FpcTechnicalManager` lowercases to `"fpctechnicalmanager"` — **19 characters**. `CreatePlotHandler:115` already writes a dynamic lowercase role into that column in production today. That is a 22001 waiting to happen — the same failure class as the `varchar(20)` correction ledger on 2026-08-26. **If your work writes any `AppRole` into an analytics `actor_role`, bound it explicitly.** A0 uses a 3-way mapping (`primaryowner` / `secondaryowner` / `unknown`, all ≤14 chars) rather than a raw role.

**2. Removing a mid-record parameter from a command silently rebinds positional call sites.** `ActorRole` sits between same-typed neighbours in `CreateCropCycleCommand` and `CreateAttachmentCommand`, and `PushSyncBatchHandler` constructs both **fully positionally**. Deleting it shifts every later argument one slot left, string into string — **compiles clean, tests pass, wrong data written**. A0 makes those call sites named first, as a separate commit, before removing anything. **If you remove or reorder any command-record parameter, check for positional construction first.** The compiler is not your safety net here.

---

## If you need a file A0 claims

Say so before editing. A0 has not started Tasks 3–8, so re-sequencing is nearly free right now and expensive later. The whole point of Stage A0 was to avoid rework between these two branches — a five-minute conversation beats a merge conflict in `PushSyncBatchHandler`.

**Sequencing already agreed by the founder (rulings R1/R5):** A0 merges first (it is small and independent), then Labour V2 completes its own lifecycle and deploys, then Stage A1 branches fresh from the new trunk for multi-plot work. There is no long-running combined branch, and A0 does not wait on you.
