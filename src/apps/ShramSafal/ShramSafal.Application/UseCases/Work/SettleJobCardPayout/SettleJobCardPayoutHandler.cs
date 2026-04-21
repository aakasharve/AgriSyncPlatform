using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.6.
/// Settles a labour payout for a VerifiedForPayout JobCard.
/// Creates a CostEntry of category "labour_payout" and transitions the JobCard to PaidOut.
/// Restricted to PrimaryOwner and SecondaryOwner only.
/// </summary>
public sealed class SettleJobCardPayoutHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<SettleJobCardPayoutResult>> HandleAsync(
        SettleJobCardPayoutCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Assert status == VerifiedForPayout.
        if (jobCard.Status != JobCardStatus.VerifiedForPayout)
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.JobCardInvalidState);

        // 3. Resolve caller role — must be PrimaryOwner or SecondaryOwner.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.Forbidden);

        if (!IsEligibleToSettle(callerRole.Value))
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // 4. Create the CostEntry for the labour payout.
        CostEntry costEntry;
        try
        {
            costEntry = CostEntry.CreateLabourPayout(
                id: idGenerator.New(),
                jobCardId: jobCard.Id,
                farmId: jobCard.FarmId,
                plotId: jobCard.PlotId,
                cropCycleId: jobCard.CropCycleId,
                amount: command.ActualPayoutAmount,
                currencyCode: command.ActualPayoutCurrencyCode,
                entryDate: DateOnly.FromDateTime(clock.UtcNow),
                createdByUserId: command.CallerUserId,
                createdAtUtc: clock.UtcNow);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.InvalidCommand);
        }

        await repository.AddCostEntryAsync(costEntry, ct);

        // 5. Transition the JobCard to PaidOut.
        try
        {
            jobCard.MarkPaidOut(
                costEntry.Id,
                new Money(command.ActualPayoutAmount, new Currency(command.ActualPayoutCurrencyCode)),
                clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<SettleJobCardPayoutResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 6. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.paid-out",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { costEntryId = costEntry.Id, amount = command.ActualPayoutAmount, currency = command.ActualPayoutCurrencyCode },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new SettleJobCardPayoutResult(costEntry.Id, JobCardStatus.PaidOut));
    }

    private static bool IsEligibleToSettle(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;
}
