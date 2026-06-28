using System.Text.Json;
using System.Text.Json.Nodes;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
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
    IAiJobRepository aiJobRepository)
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
        if (command.SourceAiJobId is { } sourceJobId && sourceJobId != Guid.Empty)
        {
            var sourceJob = await aiJobRepository.GetByIdAsync(sourceJobId, ct);
            if (sourceJob is null)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.AiParsingFailed);
            }

            provenance = new Provenance(
                source: Source.Voice,
                modelVersion: sourceJob.Provenance.ModelVersion,
                promptVersion: sourceJob.Provenance.PromptVersion,
                promptContentHash: sourceJob.Provenance.PromptContentHash,
                appVersion: stampedAppVersion);

            // W1.P2 T3 — capture source job so we can extract per-field provenance below.
            sourceJobForEvidence = sourceJob;
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
            sourceAiJobId: command.SourceAiJobId);

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
        // AuditContextAccessor. SourceAiJobId is lifted from the command (set
        // on the voice-Confirm path; null on true-manual).
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
                sourceAiJobId: command.SourceAiJobId),
            ct);
        await repository.SaveChangesAsync(ct);

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
