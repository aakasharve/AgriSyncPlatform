using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

/// <summary>
/// Adds a <see cref="Domain.Finance.CostEntry"/> with duplicate
/// detection, high-amount flagging, audit, save, and analytics.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): caller-shape validation
/// (incl. labour-payout routing rule) lives in
/// <see cref="AddCostEntryValidator"/>; farm-existence + farm-
/// membership authorization lives in <see cref="AddCostEntryAuthorizer"/>.
/// When this handler is resolved via the pipeline, both run before the
/// body. The body retains its own farm-lookup + membership re-check
/// as defense-in-depth for direct (non-pipeline) consumers — those
/// checks remain the only auth gate when callers bypass the pipeline.
/// The endpoint (POST /finance/cost-entry) gets the canonical
/// <c>InvalidCommand → UseSettleJobCardForLabourPayout →
/// FarmNotFound → Forbidden → (entitlement) → PlotNotFound /
/// CropCycleNotFound → body</c> ordering through the pipeline; the
/// sync entry path (PushSyncBatchHandler.HandleAddCostEntryAsync)
/// was intentionally NOT migrated in this pass per the rollout's
/// "only-with-tests" guardrail (sync still resolves the raw handler
/// and runs its own pre-flight membership check before invoking the
/// body).
/// </para>
/// </summary>
public sealed class AddCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
    : IHandler<AddCostEntryCommand, AddCostEntryResultDto>
{
    private const int DuplicateWindowMinutes = 120;
    private const decimal HighAmountThreshold = 25000m;
    private const string HighAmountFlagReason = "High amount: >= 25000 INR";

    public async Task<Result<AddCostEntryResultDto>> HandleAsync(AddCostEntryCommand command, CancellationToken ct = default)
    {
        var farmId = new FarmId(command.FarmId);

        // Caller-shape validation (empty IDs / blank Category /
        // non-positive Amount / labour_payout routing rule /
        // explicit-but-empty CostEntryId) lives in
        // AddCostEntryValidator; farm-existence + farm-membership
        // authorization lives in AddCostEntryAuthorizer. Both run as
        // pipeline behaviors before this body when the handler is
        // resolved through the pipeline. The body still re-checks
        // farm + membership below as defense-in-depth — that path is
        // the only auth gate for direct (non-pipeline) consumers.

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.FarmNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CreatedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.Forbidden);
        }

        // Phase 5 entitlement gate (PaidFeature.EditFinance).
        var gate = await EntitlementGate.CheckAsync<AddCostEntryResultDto>(
            entitlementPolicy, new UserId(command.CreatedByUserId), farmId,
            PaidFeature.EditFinance, ct);
        if (gate is not null) return gate;

        if (command.PlotId is not null)
        {
            var plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farmId)
            {
                return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.PlotNotFound);
            }
        }

        if (command.CropCycleId is not null)
        {
            var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farmId)
            {
                return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var candidateId = command.CostEntryId ?? idGenerator.New();
        var entry = Domain.Finance.CostEntry.Create(
            candidateId,
            command.FarmId,
            command.PlotId,
            command.CropCycleId,
            command.Category,
            command.Description,
            command.Amount,
            command.CurrencyCode,
            command.EntryDate,
            command.CreatedByUserId,
            command.Location,
            clock.UtcNow);

        var duplicateCandidates = await repository.GetCostEntriesForDuplicateCheck(
            farmId,
            command.PlotId,
            command.Category,
            clock.UtcNow.AddMinutes(-DuplicateWindowMinutes),
            ct);

        var isPotentialDuplicate = Domain.Finance.DuplicateDetector.IsPotentialDuplicate(
            duplicateCandidates,
            entry,
            DuplicateWindowMinutes);

        if (entry.Amount >= HighAmountThreshold)
        {
            entry.Flag(HighAmountFlagReason);
        }

        await repository.AddCostEntryAsync(entry, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "CostEntry",
                entry.Id,
                "Created",
                command.CreatedByUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    entry.Id,
                    command.FarmId,
                    command.PlotId,
                    command.CropCycleId,
                    command.Category,
                    command.Amount,
                    command.CurrencyCode,
                    command.EntryDate,
                    command.Location
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);
        await repository.SaveChangesAsync(ct);

        // Analytics (Phase 2 Batch D): emit after the final SaveChangesAsync.
        // OwnerAccountId is null now; Phase 4 backfill resolves it from Farm.
        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.CostEntryAdded,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.CreatedByUserId),
            FarmId: farmId,
            OwnerAccountId: null,
            ActorRole: command.ActorRole ?? "operator",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                costEntryId = entry.Id,
                farmId = command.FarmId,
                plotId = command.PlotId,
                cropCycleId = command.CropCycleId,
                amount = entry.Amount,
                currencyCode = entry.CurrencyCode,
                category = entry.Category,
                dateIncurred = entry.EntryDate,
                hasReceipt = false
            })), ct);

        return Result.Success(new AddCostEntryResultDto(entry.ToDto(), isPotentialDuplicate));
    }
}
