using System.Text.Json;
using System.Text.Json.Nodes;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// Creates a <see cref="Domain.Logs.DailyLog"/> row for a given
/// (Farm, Plot, CropCycle) on a given date, idempotent on the device-
/// scoped client request id, then emits an audit row and a
/// <c>LogCreated</c> analytics event.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateDailyLog): caller-shape validation
/// lives in <see cref="CreateDailyLogValidator"/>; farm-existence +
/// farm-membership authorization lives in
/// <see cref="CreateDailyLogAuthorizer"/>. When this handler is
/// resolved via the pipeline, both run before the body. The body
/// retains its own farm-lookup + membership re-check as defense-in-
/// depth for direct (non-pipeline) consumers — those checks remain
/// the only auth gate when callers bypass the pipeline. The endpoint
/// path (POST /logs) gets the canonical
/// <c>InvalidCommand → FarmNotFound → Forbidden</c> ordering through
/// the pipeline; the sync entry path (PushSyncBatchHandler.
/// HandleCreateDailyLogAsync) was intentionally NOT migrated in this
/// pass per the rollout's "only-with-tests" guardrail (sync still
/// resolves the raw handler and runs its own pre-flight membership
/// check before invoking the body).
/// </para>
/// </summary>
public sealed class CreateDailyLogHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics,
    IAiJobRepository aiJobRepository,
    ILogger<CreateDailyLogHandler> logger,
    ILedgerDerivationService ledgerDerivation,
    IDailyRichnessDerivationService dailyRichnessDerivation,
    // Fix F1 — optional so unit tests that exercise the handler against an
    // in-memory repository (no EF) can pass null. When resolved through DI the
    // scoped DbContext is injected (registered in Infrastructure DI as
    // AddScoped<DbContext>). Used ONLY to reach Database.CurrentTransaction so
    // the non-blocking side-car (weather + derivation) can be wrapped in a
    // SAVEPOINT on the SYNC path's ambient transaction — see PersistSideCarAsync.
    DbContext? dbContext = null)
    : IHandler<CreateDailyLogCommand, DailyLogDto>
{
    public async Task<Result<DailyLogDto>> HandleAsync(CreateDailyLogCommand command, CancellationToken ct = default)
    {
        // ── Labour V1 Task 6.1 — the ONLY two ways structured labour may be
        // rejected. Both fail BEFORE any write is staged, so a rejected command
        // leaves zero DailyLog, zero AuditEvent and zero LabourAssignment.
        //
        // (a) RETRY IDENTITY IS MANDATORY once labour is canonical. Labour rows
        //     are staged in PHASE 1 (below), inside the same unit of work as the
        //     log. A blank ClientRequestId means no idempotency key, which means
        //     a retried submit is NOT deduped at :105 and produces a SECOND
        //     DailyLog *and* a second canonical labour set. We deliberately do
        //     NOT server-generate a key here: a server-minted key is unique per
        //     attempt, so it would dedupe nothing and merely hide the duplicate.
        //     Logs WITHOUT structured labour keep today's optional-ClientRequestId
        //     contract exactly as it was.
        //
        // (b) STRUCTURALLY MALFORMED PAYLOAD — a missing / Guid.Empty
        //     LabourAssignmentId. The id is the row's primary key and the client's
        //     retry identity for that row; there is nothing to write without it.
        //
        // NOTHING ELSE MAY REJECT THE LOG (plan Constraint 7 / doctrine P9).
        // Unrecognised engagement/shift/contract strings map tolerantly (Task 3's
        // maps are TOTAL and never throw) and an absent/zero/negative duration
        // falls back to LabourTime.ServerAssumed() — see the staging block below.
        // "आज ८ मजूर होते" must complete its record with zero names, warnings or nags.
        if (command.Labour is { Count: > 0 } incomingLabour)
        {
            if (string.IsNullOrWhiteSpace(command.ClientRequestId))
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
            }

            if (incomingLabour.Any(item => item.LabourAssignmentId == Guid.Empty))
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
            }
        }

        var farmId = new FarmId(command.FarmId);

        // Caller-shape validation (empty FarmId/PlotId/CropCycleId/
        // RequestedByUserId/OperatorUserId, explicit-but-empty
        // DailyLogId) lives in CreateDailyLogValidator; farm-existence
        // + farm-membership authorization lives in
        // CreateDailyLogAuthorizer. Both run as pipeline behaviors
        // before this body when the handler is resolved through the
        // pipeline. The body still re-checks farm + membership below
        // as defense-in-depth — that path is the only auth gate for
        // direct (non-pipeline) consumers (e.g. the sync entry path,
        // and LogHandlerAnalyticsTests).

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.FarmNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.OperatorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        // Phase 5 entitlement gate (PaidFeature.WriteDailyLog). Plan §4.5.
        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.OperatorUserId), farmId,
            PaidFeature.WriteDailyLog, ct);
        if (gate is not null) return gate;

        // ── LABOUR_PHASE2 P2.2 — the spatial guard, conditional on what the
        //    farmer actually asserted ──────────────────────────────────────────
        //
        // Placed HERE, after farm-existence + membership + entitlement and
        // BEFORE the idempotency early-return below, for three reasons:
        //   1. a scope-conditional branch can never become an authorization
        //      bypass, because authorization has already run;
        //   2. a rejected command still leaves zero rows staged, matching the
        //      contract stated at the top of this method;
        //   3. the crop-cycle check cross-checks the cycle against the PLOT, so
        //      it belongs inside the plot-scoped branch and nowhere else.
        //
        // This runs on BOTH entry paths. CreateDailyLogValidator enforces the
        // same shape on the HTTP pipeline, but /sync/push resolves this handler
        // RAW and never executes that behaviour — so the body, not the
        // validator, is what makes the two paths agree.
        //
        // It is also in the COMMITTED phase (doctrine P1). Where the farmer says
        // the work happened is farmer-asserted truth, not something the system
        // inferred, so it is resolved and written with its parent — never in the
        // best-effort side-car below, which swallows every exception.
        if (command.Scope == Domain.Logs.DailyLogScope.Plot)
        {
            // A plot-scoped log without a plot or a cycle is a malformed command,
            // not a missing row. Reaching GetPlotByIdAsync with a fabricated
            // Guid.Empty to "keep the old error code" would be inventing a plot
            // reference the caller never supplied.
            if (command.PlotId is not { } plotId || command.CropCycleId is not { } cropCycleId)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
            }

            // Unchanged from Labour V1, deliberately: same lookups, same farm
            // cross-checks, same two error codes, same order. This is the
            // regression that matters most.
            var plot = await repository.GetPlotByIdAsync(plotId, ct);
            if (plot is null || plot.FarmId != farmId)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.PlotNotFound);
            }

            var cropCycle = await repository.GetCropCycleByIdAsync(cropCycleId, ct);
            if (cropCycle is null || cropCycle.FarmId != farmId || cropCycle.PlotId != plotId)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.CropCycleNotFound);
            }
        }
        else
        {
            // MultiPlot / Farm: there is no single plot and no crop cycle. If the
            // caller sent one anyway the command contradicts itself — reject it
            // rather than ignore the field, so a client bug can never quietly
            // discard part of what the farmer said.
            if (command.PlotId.HasValue || command.CropCycleId.HasValue)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
            }

            if (command.Scope == Domain.Logs.DailyLogScope.MultiPlot)
            {
                var scopedPlotIds = command.PlotIds;
                if (scopedPlotIds is not { Count: >= 2 }
                    || scopedPlotIds.Any(id => id == Guid.Empty)
                    || scopedPlotIds.Distinct().Count() != scopedPlotIds.Count)
                {
                    return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
                }

                // Founder decision O-1: EVERY plot in the set is resolved and
                // checked against this farm. Validating only the first would let
                // a caller smuggle another farm's plot into the set behind a
                // legitimate one — and would make the row assert something the
                // server never verified. Cost is one lookup per plot the farmer
                // selected (a handful), all before any write is staged.
                foreach (var scopedPlotId in scopedPlotIds)
                {
                    var scopedPlot = await repository.GetPlotByIdAsync(scopedPlotId, ct);
                    if (scopedPlot is null || scopedPlot.FarmId != farmId)
                    {
                        return Result.Failure<DailyLogDto>(ShramSafalErrors.PlotNotFound);
                    }
                }
            }
            else if (command.Scope == Domain.Logs.DailyLogScope.Farm)
            {
                // संपूर्ण शेत. Nothing spatial to resolve — the farm was already
                // proven to exist and to be one this user may write to. A
                // non-empty plot set contradicts the scope.
                if (command.PlotIds is { Count: > 0 })
                {
                    return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
                }
            }
            else
            {
                // An out-of-range enum value (only reachable via a cast) must not
                // fall through into any of the three real scopes.
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
            }
        }

        if (!string.IsNullOrWhiteSpace(command.IdempotencyKey))
        {
            var existing = await repository.GetDailyLogByIdempotencyKeyAsync(command.IdempotencyKey, ct);
            if (existing is not null)
            {
                // FIX (dfes-companion-2026-07-11, "the derivation is never
                // invoked" bug): this branch fires on ANY resend of an
                // already-committed log (same device+clientRequestId) — a
                // routine, expected occurrence on the offline-first SYNC path
                // (at-least-once delivery: the client retries until it sees a
                // clean ack). Before this fix it returned immediately, which
                // meant that if the ORIGINAL attempt's non-blocking side-car
                // (PersistSideCarAsync) never reached the richness recompute —
                // e.g. a mid-request disconnect/cancellation between the two
                // phases, or any other structural reason — NO later resend
                // ever gave it a second chance. The gap was invisible because
                // nothing here ever threw: it was a silent, non-exceptional
                // skip, not a caught failure, so PersistSideCarAsync's
                // "rolled back to savepoint" warning never fired either.
                //
                // The catch-up call re-runs ONLY the richness recompute (the
                // log row + typed ledger already exist from the original
                // attempt, so there is nothing else to redo). Safe to repeat
                // any number of times: DailyRichnessDerivationService.
                // RecomputeAsync rebuilds the WHOLE day's aggregate from
                // scratch from every persisted log on that (farm, date), so a
                // second/third run overwrites in place — it can never double-
                // count or corrupt the aggregate.
                logger.LogInformation(
                    "CreateDailyLog idempotent resend for {LogId} (farm {FarmId}, date {LogDate}); " +
                    "re-running the richness side-car in case the original attempt's Phase 2 never ran.",
                    existing.Id, existing.FarmId.Value, existing.LogDate);
                await PersistRichnessRecomputeSideCarAsync(existing.FarmId.Value, existing.LogDate, ct);
                return Result.Success(existing.ToDto());
            }
        }

        // -- Labour V1 Task 6.1, THIRD gate (2026-08-27 prod incident) ----------
        // A labourAssignmentId is that row's PRIMARY KEY, it is CLIENT-MINTED
        // (LabourAssignmentConfiguration, ValueGeneratedNever), and it is unique
        // GLOBALLY -- not per log.
        //
        // The phone mints it ONCE per LabourEvent object and never re-mints
        // (ensureLabourAssignmentIds is idempotent by design), while LogFactory
        // mints a FRESH dailyLogId on every call and carries the labour array BY
        // REFERENCE. So a re-confirm of the same draft produces a NEW log that
        // re-asserts an ALREADY-COMMITTED engagement id. On 2026-08-27 that
        // reached Postgres as 23505 on PK_labour_assignments; PushSyncBatchHandler
        // translated it to the generic "ShramSafal.SyncMutationStoreError", the
        // phone read that as RETRYABLE, and it re-sent identical bytes four times
        // (19:15:19/27/42/57) before parking FAILED.
        //
        // REFUSE IT HERE, before anything is staged, and say what it is.
        //   - We do NOT reparent the row: that would move an already-recorded
        //     engagement off the log it actually belongs to.
        //   - We do NOT re-mint the id: that would record the same workers twice
        //     (P4) and show the farmer a day of work nobody did.
        //   - We do NOT return success: the log genuinely was not saved, and P10
        //     runs in both directions.
        //
        // A GENUINE REPLAY NEVER REACHES THIS LINE. clientRequestId is
        // `create_daily_log:<dailyLogId>`, so a resend of the SAME log
        // short-circuits at the idempotency return above, and on /sync/push at the
        // sync_mutations dedup before this handler is called at all. Only a NEW log
        // re-using an OLD engagement id gets here.
        //
        // SCOPE, STATED: this compares against command.DailyLogId, so it fires only
        // for a DIFFERENT owning log -- the incident shape. The same-log shape (a
        // resend under a rotated deviceId, which misses both idempotency layers) is
        // a daily_logs_pkey collision and is deliberately left on the existing
        // generic path: it means "already saved", not "conflict".
        if (command.Labour is { Count: > 0 } assertedLabour)
        {
            var ownerLogIds = await repository.GetLabourAssignmentOwnerLogIdsAsync(
                assertedLabour.Select(item => item.LabourAssignmentId).ToArray(), ct);

            foreach (var item in assertedLabour)
            {
                // command.DailyLogId is null only when the SERVER will mint the id,
                // in which case the log is brand new and ANY pre-existing
                // engagement id is by definition on a different log. Guid? != Guid
                // lifts correctly: null != <any guid> is true.
                if (ownerLogIds.TryGetValue(item.LabourAssignmentId, out var ownerLogId)
                    && ownerLogId != command.DailyLogId)
                {
                    return Result.Failure<DailyLogDto>(ShramSafalErrors.LabourAssignmentConflict);
                }
            }
        }

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — voice-from-Confirm vs. true-manual.
        // If the client passed SourceAiJobId (the AiJob id from the original voice
        // parse), lift Voice provenance from that job and stamp the client app
        // version onto it. Otherwise stamp a Manual provenance with the same
        // client app version. The job's lookup goes through IAiJobRepository
        // (existing read port) — no Domain -> Infrastructure leak.
        var stampedAppVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? "unknown"
            : command.ClientAppVersion.Trim();

        Provenance provenance;
        Domain.AI.AiJob? sourceJobForEvidence = null;

        // FINDING 1 (F1) + residual foreign-reference fix. The client-supplied
        // SourceAiJobId is only trustworthy once we've PROVEN this farm owns the
        // referenced AiJob. `validatedSourceAiJobId` is that proven value: it is
        // non-null ONLY when the guard below accepted ownership. It is what gets
        // persisted onto daily_logs.source_ai_job_id AND the audit row — NEVER the
        // raw command value — so a caller who supplies another farm's AiJob id (on
        // the RLS-bypassed sync/admin path) can no longer make this farm's log
        // reference a foreign job. Null here mirrors the true-manual path: Manual
        // provenance, no derivation, no foreign back-reference.
        Guid? validatedSourceAiJobId = null;
        if (command.SourceAiJobId is { } sourceJobId && sourceJobId != Guid.Empty)
        {
            var sourceJob = await aiJobRepository.GetByIdAsync(sourceJobId, ct);

            // SECURITY (FINDING 1 — cross-farm SourceAiJobId injection).
            // The SYNC entry path (PushSyncBatchHandler) is admin-elevated /
            // RLS-BYPASSED, and AiJobRepository.GetByIdAsync is unfiltered EF
            // that relies entirely on RLS — so on sync a caller can fetch an
            // AiJob belonging to ANOTHER farm. Guard it in the APPLICATION layer
            // (works regardless of RLS posture): if the fetched job's FarmId does
            // not match this command's FarmId, treat it as ABSENT so no foreign
            // parse is lifted into provenance/evidence or derived into this
            // farm's ledger. Mirrors the null-source path below: the log still
            // commits with Manual provenance and derives nothing.
            if (sourceJob is null || sourceJob.FarmId != command.FarmId)
            {
                provenance = Provenance.Manual(stampedAppVersion);
            }
            else
            {
                provenance = new Provenance(
                    source: Source.Voice,
                    modelVersion: sourceJob.Provenance.ModelVersion,
                    promptVersion: sourceJob.Provenance.PromptVersion,
                    promptContentHash: sourceJob.Provenance.PromptContentHash,
                    appVersion: stampedAppVersion);

                // W1.P2 T3 — capture source job so we can extract per-field provenance below.
                sourceJobForEvidence = sourceJob;

                // Ownership proven → this id is safe to persist as a back-reference.
                validatedSourceAiJobId = sourceJobId;
            }
        }
        else
        {
            provenance = Provenance.Manual(stampedAppVersion);
        }

        // LABOUR_PHASE2 P2.2 — pick the factory that matches what the farmer
        // asserted. P2.1 deliberately gave each scope its OWN factory rather than
        // one Create() taking a scope: CreateForFarm has no plot or cycle
        // parameter at all and CreateForMultiPlot has no single-plot parameter,
        // so an invalid scope/plot pairing cannot be EXPRESSED here, let alone
        // constructed. The guard above has already proven every id this passes.
        var newLogId = command.DailyLogId ?? idGenerator.New();
        var log = command.Scope switch
        {
            Domain.Logs.DailyLogScope.Farm => Domain.Logs.DailyLog.CreateForFarm(
                newLogId,
                command.FarmId,
                command.OperatorUserId,
                command.LogDate,
                command.IdempotencyKey,
                command.Location,
                clock.UtcNow,
                provenance: provenance,
                sourceAiJobId: validatedSourceAiJobId),

            Domain.Logs.DailyLogScope.MultiPlot => Domain.Logs.DailyLog.CreateForMultiPlot(
                newLogId,
                command.FarmId,
                // Non-null and >= 2 distinct real plots: proven by the guard.
                command.PlotIds!,
                command.OperatorUserId,
                command.LogDate,
                command.IdempotencyKey,
                command.Location,
                clock.UtcNow,
                provenance: provenance,
                sourceAiJobId: validatedSourceAiJobId),

            // Plot — the Labour V1 call, byte-for-byte, with the two ids the
            // guard proved are present and real.
            _ => Domain.Logs.DailyLog.Create(
                newLogId,
                command.FarmId,
                command.PlotId!.Value,
                command.CropCycleId!.Value,
                command.OperatorUserId,
                command.LogDate,
                command.IdempotencyKey,
                command.Location,
                clock.UtcNow,
                provenance: provenance,
                sourceAiJobId: validatedSourceAiJobId),
        };

        // W1.P2 T3 — persist per-field provenance into EvidenceSourcesJson.
        // The AiJob's NormalizedResultJson carries "provenance" keys on each
        // event-item array entry (stamped by ApplyTranscriptIntegrityCorrections
        // when Ai:DomainKnowledgeLayer:Enabled is ON; absent when OFF).
        // Extract the per-field provenance map and write it into the existing
        // EvidenceSourcesJson jsonb column (schemaless — no migration needed).
        // When the flag was OFF the NormalizedResultJson has no provenance keys
        // so ExtractFieldProvenanceJson returns "[]" and EvidenceSourcesJson
        // stays at its "[]" default — byte-identical to pre-W1.P2 behaviour.
        if (sourceJobForEvidence?.NormalizedResultJson is { } normalizedJson
            && !string.IsNullOrWhiteSpace(normalizedJson))
        {
            var evidenceJson = ExtractFieldProvenanceJson(normalizedJson);
            log.SetEvidenceSourcesJson(evidenceJson);
        }

        // ── spec: dfes-companion-2026-07-11 (wave-3.10), founder decision 8 ──────
        // The farmer's own statement about the DAY, stamped onto the log itself so
        // PersistedDayRootBuilder (layer 5) can read it back and the scorer can finally
        // see a typed "no work today". Copied verbatim; absent stays absent.
        //
        // 🛑 It is stamped HERE — before AddDailyLogAsync and the PRIMARY save — and
        // deliberately not inside PersistSideCarAsync. The side-car is non-blocking by
        // contract: it runs in its own savepoint and a failure there is logged and
        // swallowed. A declaration is canonical data the farmer supplied, and canonical
        // data never lives in a best-effort side-car; on the side-car path a rolled-back
        // savepoint would silently discard the only record that his day was a rest day.
        log.SetDayOutcome(command.ManualDraft?.DayOutcome);

        // ── spec: dfes-companion-2026-07-11 (wave-1.3) ───────────────────────────
        // THE SERVER HALF of the owner-confirm fix. The device stamps the owner's own
        // log approved on save (wave-1.1), but verification is a SERVER-derived value —
        // DailyLog.CurrentVerificationStatus folds the verification events and both
        // status properties are builder.Ignore()d, so there is no column the device
        // could ever write. Create emits no verification event, so every log came back
        // Draft on the next pull and the reconciler (logsReconciler.ts: "Verification is
        // a server-side FSM; the device never wins it") overwrote the device's answer.
        // The farmer logged his work and his score dropped again, one sync later.
        //
        // The role is read from the DATABASE (farm ownership / non-terminal membership),
        // never from command.ActorRole — that string arrives from the caller, and a
        // client that can assert its own approval authority defeats the entire point of
        // the verification FSM. GetUserRoleForFarmAsync is the same server-side
        // derivation VerifyLogHandler already trusts for the explicit verify path.
        //
        // Non-owner roles get nothing here: TrySelfVerifyAsCreator refuses any role that
        // does not hold BOTH FSM edges, so a Mukadam's log still lands on Draft and still
        // needs an owner. No FSM edge was added or widened.
        var creatorRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId, command.OperatorUserId, ct);
        AppRole? selfAttestedAs = null;
        if (creatorRole is { } role
            && log.TrySelfVerifyAsCreator(idGenerator.New(), idGenerator.New(), role, clock.UtcNow))
        {
            selfAttestedAs = role;
            logger.LogInformation(
                "DailyLog {LogId} self-verified on create: operator {OperatorUserId} holds {Role} on farm {FarmId}, " +
                "which carries both Draft->Confirmed and Confirmed->Verified.",
                log.Id, command.OperatorUserId, role, command.FarmId);
        }

        await repository.AddDailyLogAsync(log, ct);

        // ── Labour V1 Task 6.2 — CANONICAL LABOUR IS PHASE-1 DATA ────────────
        // THE PHASE RULE (doctrine P1): Phase 1 stores what the farmer CONFIRMED;
        // Phase 2 derives what the system INFERRED. Neither may impersonate the
        // other, and canonical data must NEVER live in a best-effort side-car.
        //
        // These rows are staged HERE — after AddDailyLogAsync, strictly before the
        // Phase-1 SaveChangesAsync below — so they share the log's unit of work and
        // are atomic with it: either the farmer's log AND their labour commit, or
        // neither does and the submit fails loudly and is retryable.
        //
        // They must NEVER be moved into PersistSideCarAsync. All three of that
        // method's isolation branches catch Exception, log a warning and return
        // normally, so a failure there is SILENT — the log would commit, the labour
        // rows would vanish, and the idempotency early-return above would hand back
        // the existing log on every retry, so the side-car would never be reached
        // again. There is no backfill job, reconciliation worker or re-derive
        // endpoint in this system: the farmer's labour record would simply cease to
        // exist behind a success message.
        //
        // LabourAssignmentFactory.FromParsed is the SOLE production construction
        // site (pinned by LabourAnchorRules) — the voice/AI derivation path in
        // LedgerDerivationService goes through the very same call, so the same
        // real-world engagement can never be recorded two different ways depending
        // only on how the farmer entered it.
        if (command.Labour is { Count: > 0 } labour)
        {
            var labourCreatedAtUtc = clock.UtcNow;
            foreach (var item in labour)
            {
                var assignment = LabourAssignmentFactory.FromParsed(
                    // The client owns the row id (it is also the retry identity for
                    // this row); the 6.1 guard above already rejected Guid.Empty.
                    id: item.LabourAssignmentId,
                    dailyLogId: log.Id,
                    // TOTAL map — unrecognised strings fall back to Hired, never throw.
                    engagementType: LabourAssignmentFactory.MapLabourEngagement(item.EngagementType, null),
                    maleCount: item.MaleCount,
                    femaleCount: item.FemaleCount,
                    // Silence stays NULL — the factory resolves the canonical headcount
                    // and preserves "we were not told" rather than asserting zero.
                    workerCount: item.WorkerCount,
                    wagePerPerson: item.WagePerPerson,
                    contractUnit: LabourAssignmentFactory.MapContractUnit(item.ContractUnit),
                    contractQuantity: item.ContractQuantity,
                    // NO-MULTIPLY (ADR 0023 §1/§3.2d): only an EXPLICIT stated total,
                    // stored exactly as supplied — never rate x count.
                    totalCost: item.TotalCost,
                    linkedActivityId: item.LinkedActivityId,
                    createdAtUtc: labourCreatedAtUtc,
                    // Task 4 time truth. A duration the farmer actually stated is
                    // Explicit; anything else is honestly Assumed at the one server
                    // default. The `> 0` arm is REQUIRED, not defensive padding:
                    // LabourTime.Explicit throws on a non-positive value, and doctrine
                    // P9 forbids an optional field from ever rejecting a record — an
                    // absent, zero or negative durationHours is NOT an error, it is
                    // simply an unstated duration.
                    time: item.DurationHours is { } h && h > 0
                        ? Domain.Farms.LabourTime.Explicit(h)
                        : Domain.Farms.LabourTime.ServerAssumed(),
                    // Descriptive only — never touches the money fields above.
                    shift: LabourAssignmentFactory.MapLabourShift(item.Shift),
                    task: item.Task,
                    // LABOUR_PHASE2 migration ③ (founder decision O-3). `notes`
                    // has been on the wire since Labour V1 Task 5
                    // (create_daily_log.zod.ts) and was DROPPED HERE, on this
                    // exact line, because no column existed to hold it. The
                    // farmer typed it, the phone sent it, the server threw it
                    // away. It now reaches ssf.labour_assignments.notes and
                    // comes back on /sync/pull.
                    notes: item.Notes);

                await repository.AddLabourAssignmentAsync(assignment, ct);
            }
        }

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. SourceAiJobId uses the OWNERSHIP-VALIDATED value
        // (null when the F1 guard rejected the client-supplied id) so the audit
        // row never records a back-reference to another farm's AiJob either.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: "Created",
                actorUserId: command.OperatorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    log.Id,
                    command.FarmId,
                    // LABOUR_PHASE2 P2.2 — read from the LOG, not the command, and
                    // include the scope. Without it the audit row cannot tell
                    // "the farmer said संपूर्ण शेत" apart from "a plot was
                    // omitted", which is the whole point of storing scope at all.
                    // ToString() because AuditEventFactory's serializer has no
                    // enum converter — a bare `2` in an audit row would need a
                    // convention to read, and ssf.daily_logs.scope stores the
                    // literal member name anyway.
                    Scope = log.Scope.ToString(),
                    log.PlotIds,
                    log.PlotId,
                    log.CropCycleId,
                    command.LogDate,
                    command.Location
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientRequestId,
                appVersion: stampedAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: validatedSourceAiJobId),
            ct);

        // ── spec: dfes-companion-2026-07-11 (wave-1.3) — I1 ──────────────────────
        // THE ATTESTATION MUST LEAVE A TRACE. Above, an owner's own log acquires TWO
        // verification events — "I recorded this" and "I vouch for it" — without any
        // human pressing an approve button. The explicit approve path
        // (VerifyLogHandler) writes a VerificationChanged audit row for exactly one
        // such act; this path was writing only "Created" for two.
        //
        // Verification events are themselves persisted, so the state is not lost —
        // but the AUDIT LEDGER is what answers "who claimed authority over this day,
        // from which device, on which app version, under which role", and an audit row
        // that was never written at the moment of the act can never be reconstructed
        // afterwards. A pilot's worth of self-attestations with no audit row is an
        // unrepairable gap, which is why this is written here and not deferred.
        //
        // Provenance arguments are IDENTICAL to the Created row above (same request,
        // same device, same app version, same AI-job back-reference), because it is
        // the same act. The payload carries the SERVER-DERIVED role — the actual
        // authority the attestation rested on — separately from actorRole, which (like
        // every other row here) records what the caller CLAIMED to be.
        if (selfAttestedAs is { } attestedRole)
        {
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "VerificationChanged",
                    actorUserId: command.OperatorUserId,
                    actorRole: command.ActorRole ?? "unknown",
                    payload: new
                    {
                        logId = log.Id,
                        from = Domain.Logs.VerificationStatus.Draft.ToString(),
                        to = Domain.Logs.VerificationStatus.Verified.ToString(),
                        selfAttested = true,
                        role = attestedRole.ToString(),
                        reason = Domain.Logs.DailyLog.SelfAttestationReason
                    },
                    farmId: command.FarmId,
                    clientCommandId: command.ClientRequestId,
                    appVersion: stampedAppVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: validatedSourceAiJobId),
                ct);
        }

        // ── Fix F1: TWO-PHASE persistence ────────────────────────────────────
        // PHASE 1 — commit the farmer's DailyLog + its audit row on their OWN
        // SaveChanges, so the log is durable INDEPENDENTLY of the non-blocking
        // side-car (weather stamp + typed-ledger derivation). Previously the log
        // and the side-car shared one SaveChanges: a side-car DB error (e.g. a
        // transient 23505 on the current-version partial-unique index during an
        // offline re-confirm) aborted the whole transaction — and on the SYNC
        // path that rolled back PushSyncBatchHandler's ambient transaction, so
        // the farmer's log AND the derivation both vanished and sync recorded a
        // failure. Committing the log first removes that coupling entirely.
        await repository.SaveChangesAsync(ct);

        // PHASE 2 — the side-car, best-effort and isolated. A weather-stamp or
        // derivation failure here must NEVER discard the (already-committed) log.
        await PersistSideCarAsync(log, command, sourceJobForEvidence, ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.LogCreated,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.OperatorUserId),
            FarmId: farmId,
            OwnerAccountId: null, // Phase 2: null. Phase 4 will backfill via a BG job.
            ActorRole: command.ActorRole ?? "operator",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                logId = log.Id,
                // LABOUR_PHASE2 P2.2 — plotId stays for every existing consumer
                // and is simply NULL when the farmer named no plot; `scope` is
                // what makes that null readable. Sourced from the log so these
                // props can never disagree with the committed row.
                scope = log.Scope.ToString(),
                plotId = log.PlotId,
                cropCycleId = log.CropCycleId,
                // Phase 3 will populate these via IScheduleComplianceService.
                scheduleSubscriptionId = (Guid?)null,
                matchedTaskId = (Guid?)null,
                deltaDaysVsSchedule = (int?)null,
                complianceOutcome = (string?)null
            })
        ), ct);

        return Result.Success(log.ToDto());
    }

    // ── Fix F1: isolated side-car persistence ────────────────────────────────
    // Stages the client weather snapshot and runs the confirm-time typed-ledger
    // derivation, then commits them — but ISOLATED from the farmer's already-
    // committed DailyLog so a failure here can never discard the log.
    //
    // Postgres semantics: once ANY statement errors inside a transaction the
    // WHOLE transaction is aborted, so merely catching the exception does not
    // rescue an already-flushed log that shares the transaction. Therefore:
    //   • SYNC path (ambient transaction from PushSyncBatchHandler): wrap the
    //     side-car in a SAVEPOINT. On failure RollbackToSavepoint un-aborts the
    //     transaction, discarding ONLY the side-car; the log's Phase-1 writes
    //     survive to the outer commit. (Belt-and-braces alongside the write-
    //     ordering fix in LedgerDerivationService, which already makes the
    //     supersession path itself unable to raise 23505.)
    //   • HTTP path (no ambient transaction): the side-car gets its OWN
    //     transaction so a mid-way failure (after the derivation's supersession
    //     SaveChanges) rolls back the side-car atomically without touching the
    //     already-committed log.
    //   • Unit tests (dbContext null / non-relational): plain try/catch around
    //     the staged writes.
    private async Task PersistSideCarAsync(
        Domain.Logs.DailyLog log,
        CreateDailyLogCommand command,
        Domain.AI.AiJob? sourceJobForEvidence,
        CancellationToken ct)
    {
        // Phase 2 (dfes-companion-2026-07-11): the daily richness aggregate is
        // recomputed for EVERY confirmed log, so the side-car always runs (even
        // when there is no weather stamp and no voice derivation) — no more
        // early-return gate on hasWeather/hasDerivation.
        var relational = dbContext?.Database.IsRelational() == true;
        var ambientTx = relational ? dbContext!.Database.CurrentTransaction : null;

        // SYNC path — savepoint on the ambient transaction.
        if (ambientTx is not null)
        {
            const string savepoint = "ssf_daily_log_sidecar";
            await ambientTx.CreateSavepointAsync(savepoint, ct);
            try
            {
                await StageAndSaveSideCarAsync(log, command, sourceJobForEvidence, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Side-car (weather/derivation) rolled back to savepoint for daily log {LogId} (non-blocking); log is durable.",
                    log.Id);
                // Un-abort the ambient transaction: discards ONLY the side-car,
                // then drop any half-staged side-car entities from the tracker so
                // the outer commit doesn't try to re-save them.
                await ambientTx.RollbackToSavepointAsync(savepoint, ct);
                dbContext!.ChangeTracker.Clear();
            }

            return;
        }

        // HTTP path — the side-car gets its own transaction (when relational).
        if (relational)
        {
            await using var sideCarTx = await dbContext!.Database.BeginTransactionAsync(ct);
            try
            {
                await StageAndSaveSideCarAsync(log, command, sourceJobForEvidence, ct);
                await sideCarTx.CommitAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Side-car (weather/derivation) rolled back for daily log {LogId} (non-blocking); log is durable.",
                    log.Id);
                await sideCarTx.RollbackAsync(ct);
                dbContext!.ChangeTracker.Clear();
            }

            return;
        }

        // Unit-test / non-relational path — plain isolation.
        try
        {
            await StageAndSaveSideCarAsync(log, command, sourceJobForEvidence, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Side-car (weather/derivation) skipped for daily log {LogId} (non-blocking); log is durable.",
                log.Id);
        }
    }

    // ── FIX (dfes-companion-2026-07-11): idempotent-resend richness catch-up ──
    // Same non-blocking isolation contract as PersistSideCarAsync (savepoint on
    // the SYNC path's ambient transaction / own transaction on the HTTP path /
    // plain try-catch for non-relational unit tests), but scoped to ONLY the
    // richness recompute — called from the idempotency-key early return above,
    // where the log + typed ledger already exist and there is nothing else to
    // redo. A failure here is logged and swallowed exactly like the primary
    // side-car: it must never turn an idempotent "already applied" resend into
    // a caller-visible failure, and it must never be silent — hence the
    // explicit LogWarning on every failure branch (the whole point of this fix
    // is that a skipped scorer must never again look like success).
    private async Task PersistRichnessRecomputeSideCarAsync(Guid farmId, DateOnly logDate, CancellationToken ct)
    {
        var relational = dbContext?.Database.IsRelational() == true;
        var ambientTx = relational ? dbContext!.Database.CurrentTransaction : null;

        if (ambientTx is not null)
        {
            const string savepoint = "ssf_daily_log_sidecar_resend";
            await ambientTx.CreateSavepointAsync(savepoint, ct);
            try
            {
                await dailyRichnessDerivation.RecomputeAsync(farmId, logDate, ct);
                await repository.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Richness recompute (idempotent-resend catch-up) rolled back to savepoint for farm {FarmId} date {LogDate} (non-blocking).",
                    farmId, logDate);
                await ambientTx.RollbackToSavepointAsync(savepoint, ct);
                dbContext!.ChangeTracker.Clear();
            }

            return;
        }

        if (relational)
        {
            await using var sideCarTx = await dbContext!.Database.BeginTransactionAsync(ct);
            try
            {
                await dailyRichnessDerivation.RecomputeAsync(farmId, logDate, ct);
                await repository.SaveChangesAsync(ct);
                await sideCarTx.CommitAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Richness recompute (idempotent-resend catch-up) rolled back for farm {FarmId} date {LogDate} (non-blocking).",
                    farmId, logDate);
                await sideCarTx.RollbackAsync(ct);
                dbContext!.ChangeTracker.Clear();
            }

            return;
        }

        try
        {
            await dailyRichnessDerivation.RecomputeAsync(farmId, logDate, ct);
            await repository.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Richness recompute (idempotent-resend catch-up) skipped for farm {FarmId} date {LogDate} (non-blocking).",
                farmId, logDate);
        }
    }

    // Stage the weather snapshot + typed-ledger derivation, then commit them.
    // Any throw propagates to PersistSideCarAsync's isolation wrapper.
    private async Task StageAndSaveSideCarAsync(
        Domain.Logs.DailyLog log,
        CreateDailyLogCommand command,
        Domain.AI.AiJob? sourceJobForEvidence,
        CancellationToken ct)
    {
        // Track B B2.8 — persist the client-captured weather snapshot to
        // ssf.weather_stamps. NON-BLOCKING by contract (isolated in the caller).
        if (command.WeatherStamp is { } ws)
        {
            var stamp = Domain.Farms.WeatherStamp.Create(
                Guid.NewGuid(), log.Id, ws.PlotId,
                ParseTimestamp(ws.TimestampLocal), ParseTimestamp(ws.TimestampProvider),
                MapWeatherProvider(ws.Provider),
                ws.TempC, ws.Humidity, ws.WindKph, ws.PrecipMm, ws.CloudCoverPct,
                ws.ConditionText, ws.IconCode, ws.RainProbNext6h,
                ws.WindGustKph, ws.SoilMoistureVolumetric0To10, ws.UvIndex,
                ws.Alerts is { Count: > 0 } alerts ? System.Text.Json.JsonSerializer.Serialize(alerts) : null,
                DateTime.UtcNow);
            await repository.AddWeatherStampAsync(stamp, ct);
        }

        // AI Intelligence Plan WP-2c (Track B) — confirm-time server-side
        // derivation of the typed ssf ledger. Parses the source AiJob's
        // NormalizedResultJson into typed rows. The supersession path inside
        // DeriveAsync flushes the current-row UPDATE before the new-row INSERT
        // (Fix F1 write-ordering) so it can never raise a transient 23505.
        if (command.SourceAiJobId is { } && sourceJobForEvidence is not null)
        {
            // Labour V1 Task 6.3 — suppress ONLY the labour branch when this confirm
            // already carried structured labour[] (staged as canonical Phase-1 rows
            // above). Everything else in the blob — farm operations, inputs,
            // irrigation, machinery, observations, disturbance — still derives.
            await ledgerDerivation.DeriveAsync(
                log, sourceJobForEvidence, idGenerator, clock,
                deriveLabour: command.Labour is not { Count: > 0 },
                ct: ct);
        }
        else if (ManualDraftNormalizer.Normalize(command.ManualDraft) is { } manualWireJson)
        {
            // spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — THE
            // manual-entry defect. Reaching this branch means no AI job was derived
            // from, so `provenance` above is Provenance.Manual and the farmer's own
            // typed draft is the only account of the day we have. Until now it was
            // simply dropped: no typed children were written, DfesLensExtractor saw an
            // empty day, and a farmer who had described his whole day was told ०/१०.
            //
            // The two branches are mutually exclusive by construction, so a log can
            // never be derived twice or acquire two lineages. The draft rides the SAME
            // derivation body as voice (DeriveFromManualDraftAsync) — one writer, one
            // set of rules — stamped manual and keyed to the log id so a re-save
            // supersedes rather than duplicates.
            // The log's OWN AppVersion, so the derived rows and the log they came from
            // can never disagree about which client wrote them.
            await ledgerDerivation.DeriveFromManualDraftAsync(
                log, manualWireJson, log.Provenance.AppVersion, idGenerator, clock, ct);
        }

        await repository.SaveChangesAsync(ct);

        // Phase 2 — recompute the daily richness aggregate from the now-persisted
        // spine. Runs inside the same savepoint/transaction isolation as the rest
        // of the side-car, so a recompute failure rolls back to the savepoint and
        // never discards the already-durable DailyLog (Fix F1 contract).
        await dailyRichnessDerivation.RecomputeAsync(log.FarmId.Value, log.LogDate, ct);
        await repository.SaveChangesAsync(ct);
    }

    // Track B B2.8 — tolerant timestamp parse for the weather stamp. Falls back
    // to UtcNow on an unparseable value so a malformed timestamp never blocks
    // the log (the outer try/catch also guards against everything else).
    private static DateTime ParseTimestamp(string s)
        => DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var dt)
            ? dt : DateTime.UtcNow;

    // Track B B2.8 — map the wire provider string to the domain enum. Unknown
    // providers fall back to Mock rather than throwing.
    private static Domain.Farms.WeatherProvider MapWeatherProvider(string p) => p switch
    {
        "tomorrow.io" => Domain.Farms.WeatherProvider.TomorrowIo,
        "open_weather" => Domain.Farms.WeatherProvider.OpenWeather,
        _ => Domain.Farms.WeatherProvider.Mock,
    };

    // W1.P2 T3 — extract the per-field provenance map from a NormalizedResultJson
    // blob and serialise it as an EvidenceSourcesJson payload.
    // Walks the known event-item arrays, finds any item that carries a
    // "provenance" key, and emits a compact map of
    //   { "type": "field_provenance", "fields": [ { "array": "...", "index": N, "provenance": "spoken"|"derived" }, ... ] }
    // inside the array.  When no provenance keys are present (flag-OFF parse)
    // returns "[]" so EvidenceSourcesJson stays at its default.
    private static readonly string[] EvidenceArrayKeys =
    [
        "labour", "inputs", "irrigation", "observations",
        "plannedTasks", "cropActivities", "machinery", "activityExpenses"
    ];

    private static string ExtractFieldProvenanceJson(string normalizedResultJson)
    {
        try
        {
            var root = JsonNode.Parse(normalizedResultJson)?.AsObject();
            if (root is null)
            {
                return "[]";
            }

            var fields = new JsonArray();
            foreach (var arrayKey in EvidenceArrayKeys)
            {
                if (root[arrayKey] is not JsonArray items)
                {
                    continue;
                }

                for (var i = 0; i < items.Count; i++)
                {
                    if (items[i] is not JsonObject item)
                    {
                        continue;
                    }

                    if (item["provenance"]?.GetValue<string>() is { } prov
                        && !string.IsNullOrWhiteSpace(prov))
                    {
                        fields.Add(new JsonObject
                        {
                            ["array"] = arrayKey,
                            ["index"] = i,
                            ["provenance"] = prov
                        });
                    }
                }
            }

            if (fields.Count == 0)
            {
                return "[]";
            }

            var entry = new JsonObject
            {
                ["type"] = "field_provenance",
                ["fields"] = fields
            };

            return new JsonArray { entry }.ToJsonString();
        }
        catch (JsonException ex)
        {
            // Malformed NormalizedResultJson — fall back to empty evidence.
            // Activity event for observability (static helper; no ILogger).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "CreateDailyLog.MalformedNormalizedResultJson",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return "[]";
        }
    }
}
