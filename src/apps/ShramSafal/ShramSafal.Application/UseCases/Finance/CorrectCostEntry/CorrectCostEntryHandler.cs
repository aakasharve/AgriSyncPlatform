using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

public sealed class CorrectCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
{
    private const decimal MaxSupportedAmount = 999_999_999m;

    public async Task<Result<FinanceCorrectionDto>> HandleAsync(CorrectCostEntryCommand command, CancellationToken ct = default)
    {
        if (command.CostEntryId == Guid.Empty ||
            command.CorrectedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (IsAmountOutOfRange(command.CorrectedAmount))
        {
            return Result.Failure<FinanceCorrectionDto>(CreateInvalidAmountError());
        }

        if (command.FinanceCorrectionId.HasValue && command.FinanceCorrectionId.Value == Guid.Empty)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.InvalidCommand);
        }

        var entry = await repository.GetCostEntryByIdAsync(command.CostEntryId, ct);
        if (entry is null)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.CostEntryNotFound);
        }

        var actorRole = await repository.GetUserRoleForFarmAsync((Guid)entry.FarmId, command.CorrectedByUserId, ct);
        if (actorRole is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedActorRole = actorRole.Value;

        // Phase 5 entitlement gate (PaidFeature.EditFinance).
        var gate = await EntitlementGate.CheckAsync<FinanceCorrectionDto>(
            entitlementPolicy, new UserId(command.CorrectedByUserId), entry.FarmId,
            PaidFeature.EditFinance, ct);
        if (gate is not null) return gate;

        var correction = Domain.Finance.FinanceCorrection.Create(
            command.FinanceCorrectionId ?? idGenerator.New(),
            entry.Id,
            entry.Amount,
            command.CorrectedAmount,
            command.CurrencyCode,
            command.Reason,
            command.CorrectedByUserId,
            clock.UtcNow);

        entry.MarkCorrected(correction.Id, correction.CorrectedAmount, correction.CurrencyCode, correction.CorrectedAtUtc);

        // Repository add methods only stage entities; the single SaveChangesAsync call below is
        // the atomic EF Core commit point for both the correction and its audit event.
        await repository.AddFinanceCorrectionAsync(correction, ct);
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Corrections are owner-initiated (manual) — no
        // SourceAiJobId.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "CostEntry",
                entityId: entry.Id,
                action: "Corrected",
                actorUserId: command.CorrectedByUserId,
                actorRole: resolvedActorRole.ToString(),
                payload: new
                {
                    costEntryId = entry.Id,
                    financeCorrectionId = correction.Id,
                    correction.OriginalAmount,
                    correction.CorrectedAmount,
                    correction.CurrencyCode,
                    correction.Reason
                },
                farmId: entry.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        // Analytics (Phase 2 Batch D): emit after the final SaveChangesAsync.
        // ActorRole is the role resolved via GetUserRoleForFarmAsync, lowercased.
        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.CostEntryCorrected,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.CorrectedByUserId),
            FarmId: entry.FarmId,
            OwnerAccountId: null,
            ActorRole: resolvedActorRole.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                costEntryId = entry.Id,
                farmId = (Guid)entry.FarmId,
                financeCorrectionId = correction.Id,
                correctionReason = correction.Reason,
                priorAmount = correction.OriginalAmount,
                newAmount = correction.CorrectedAmount,
                currencyCode = correction.CurrencyCode
            })), ct);

        return Result.Success(correction.ToDto());
    }

    private static bool IsAmountOutOfRange(decimal amount) =>
        amount <= 0 || amount > MaxSupportedAmount;

    private static Error CreateInvalidAmountError() =>
        new("ShramSafal.InvalidAmount", "Amount must be greater than zero and no more than 999999999.");
}
