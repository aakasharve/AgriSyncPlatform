using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
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
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape + payout-amount
/// validation lives in <see cref="SettleJobCardPayoutValidator"/>;
/// job-card-existence + Owner-tier authorization lives in
/// <see cref="SettleJobCardPayoutAuthorizer"/>. When this handler is
/// resolved via the pipeline (see DI registration), both layers run
/// before the body executes; when resolved directly (legacy tests),
/// the body's inline guards continue to enforce the same invariants
/// as defense-in-depth (the JobCardInvalidState status check stays in
/// the body because it's an aggregate-state invariant).
/// </para>
/// </summary>
public sealed class SettleJobCardPayoutHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>
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
        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — labour payouts are manual by
        // definition (owner-initiated settlement of a verified job card); stamp
        // Provenance.Manual with the client app version from the command.
        CostEntry costEntry;
        var settlementAppVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? "unknown"
            : command.ClientAppVersion.Trim();
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
                createdAtUtc: clock.UtcNow,
                provenance: Provenance.Manual(settlementAppVersion));
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
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. The labour-payout CostEntry already lifted
        // settlementAppVersion onto its Provenance above; reuse it here for
        // the audit row so the two records line up.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.paid-out",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { costEntryId = costEntry.Id, amount = command.ActualPayoutAmount, currency = command.ActualPayoutCurrencyCode },
                farmId: jobCard.FarmId.Value,
                clientCommandId: command.ClientCommandId,
                appVersion: settlementAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new SettleJobCardPayoutResult(costEntry.Id, JobCardStatus.PaidOut));
    }

    private static bool IsEligibleToSettle(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;
}
