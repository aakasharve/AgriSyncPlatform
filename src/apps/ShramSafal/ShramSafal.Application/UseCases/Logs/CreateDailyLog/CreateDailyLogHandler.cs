using System.Text.Json;
using System.Text.Json.Nodes;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
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

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.FarmId != farmId)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.PlotNotFound);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null || cropCycle.FarmId != farmId || cropCycle.PlotId != command.PlotId)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.CropCycleNotFound);
        }

        if (!string.IsNullOrWhiteSpace(command.IdempotencyKey))
        {
            var existing = await repository.GetDailyLogByIdempotencyKeyAsync(command.IdempotencyKey, ct);
            if (existing is not null)
            {
                return Result.Success(existing.ToDto());
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

        var log = Domain.Logs.DailyLog.Create(
            command.DailyLogId ?? idGenerator.New(),
            command.FarmId,
            command.PlotId,
            command.CropCycleId,
            command.OperatorUserId,
            command.LogDate,
            command.IdempotencyKey,
            command.Location,
            clock.UtcNow,
            provenance: provenance,
            sourceAiJobId: validatedSourceAiJobId);

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

        await repository.AddDailyLogAsync(log, ct);

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
                    command.PlotId,
                    command.CropCycleId,
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
                plotId = command.PlotId,
                cropCycleId = command.CropCycleId,
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
            await ledgerDerivation.DeriveAsync(log, sourceJobForEvidence, idGenerator, clock, ct);
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
