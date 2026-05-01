using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
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
    IAnalyticsWriter analytics)
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

        var log = Domain.Logs.DailyLog.Create(
            command.DailyLogId ?? idGenerator.New(),
            command.FarmId,
            command.PlotId,
            command.CropCycleId,
            command.OperatorUserId,
            command.LogDate,
            command.IdempotencyKey,
            command.Location,
            clock.UtcNow);

        await repository.AddDailyLogAsync(log, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "DailyLog",
                log.Id,
                "Created",
                command.OperatorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    log.Id,
                    command.FarmId,
                    command.PlotId,
                    command.CropCycleId,
                    command.LogDate,
                    command.Location
                },
                command.ClientRequestId,
                clock.UtcNow),
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
}
