using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Application.UseCases.Finance.ApproveCostEntry;

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

        // spec: plr-d10 lane BILL-1 — read under the bill's row hold (the approval door's read): a correction makes a new
        // version of the bill, so it and an approval in flight never both read the version the other is about to move.
        var entry = await repository.GetCostEntryForChangeAsync(command.CostEntryId, ct);
        if (entry is null)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.CostEntryNotFound);
        }

        // spec: plr-d10 lane BILL-1 fix round 1 (review H1) — THE place rule the read side uses, for every seat it narrows: an
        // own-records seat (स्वतःचं काम, कामगार) holding review money corrects only his own money, a chosen-plots seat only his
        // plots' (or his own). A bill his pull never sends him is not there: not found, as a bill of another farm.
        if (await CostEntryPlaceGate.HiddenFromAsync(repository, entry, command.CorrectedByUserId, clock.UtcNow, ct))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.CostEntryNotFound);
        }

        // spec: plr-d10 lane PRV fix pass 1 (H2) — a money record kept from him is not his to correct.
        if (!await Services.RecordAudienceGate.MaySeeCostAsync(repository, entry, command.CorrectedByUserId, clock.UtcNow, ct))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.RecordAudienceClosed);
        }

        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b — correcting a cost is the
        // review-money-entries authority (stored as AddCost; it needs see money), at this moment.
        // Founder D-22 / D-26: a label — सहमालक included — grants nothing by itself, so the old
        // owner-tier floor is gone; the primary account holder always may.
        var actorRole = await repository.GetUserRoleForFarmAsync((Guid)entry.FarmId, command.CorrectedByUserId, ct);
        if (actorRole is null
            || !await FarmAuthorityGate.HoldsAsync(
                repository, (Guid)entry.FarmId, command.CorrectedByUserId, FarmAuthority.ReviewMoney, clock.UtcNow, ct))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedActorRole = actorRole.Value;

        // spec: plr-d10 lane BILL-1b (founder D-105 (b), 2026-11-08) — an APPROVED bill keeps its price: only the primary account
        // holder changes it. Any stamp counts (the stamp rows are append-only; an older version's stamp is still "approved once").
        // Asked after the authority gates (a stranger learns nothing about a bill's state) and under the bill's row hold (an
        // approval in flight finishes first, so this sees it). The owner's change goes on; the pull then marks the bill
        // "मालकाने बदलला" (BillOwnerChange) for everyone, the owner included. Round 2 (founder, 2026-11-08): and his change counts
        // as approved straight away - below, his own stamp for the new version is staged with the correction.
        var isPrimaryHolder = await FarmAuthorityGate.IsPrimaryAccountHolderAsync(
            repository, (Guid)entry.FarmId, command.CorrectedByUserId, ct);
        var billWasApproved = (await repository.GetCostEntryApprovalsAsync([entry.Id], ct))
            .Any(a => a.CostEntryId == entry.Id && a.FarmId == entry.FarmId);
        if (billWasApproved && !BillApprovalRules.MayChangeApprovedPrice(isPrimaryHolder))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.BillPriceLockedAfterApproval);
        }

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

        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

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
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        // spec: plr-d10 lane FIX-1 round 2 (founder, 2026-11-08) — the main owner's change of an already-approved price counts as
        // approved straight away: his OWN stamp for the version he just made (the same append-only stamp an approval makes: who,
        // the moment of the change, which version), with the same audit row an approval writes. The old stamp stays in the history
        // and the bill keeps its "मालकाने बदलला" mark. A bill nobody approved gets no stamp: unchanged.
        if (BillApprovalRules.OwnerChangeCountsAsApproval(billWasApproved, isPrimaryHolder))
        {
            var ownerStamp = BillApprovalRules.OwnerChangeStamp(
                entry, idGenerator.New(), new UserId(command.CorrectedByUserId), correction.CorrectedAtUtc,
                command.ClientCommandId, appVersion);
            await repository.AddCostEntryApprovalAsync(ownerStamp, ct);
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "CostEntry",
                    entityId: entry.Id,
                    action: ApproveCostEntryHandler.ApprovedAction,
                    actorUserId: command.CorrectedByUserId,
                    actorRole: resolvedActorRole.ToString(),
                    payload: new
                    {
                        costEntryId = entry.Id,
                        approvalId = ownerStamp.Id,
                        billVersion = ownerStamp.BillVersion,
                        effectiveAmount = correction.CorrectedAmount,
                        correction.CurrencyCode,
                        financeCorrectionId = correction.Id,
                        trigger = BillApprovalRules.OwnerChangeTrigger,
                    },
                    farmId: entry.FarmId,
                    clientCommandId: command.ClientCommandId,
                    appVersion: appVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);
        }

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
