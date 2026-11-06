using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.5.
/// Marks a Completed JobCard as VerifiedForPayout after checking:
///   - The linked DailyLog is in Verified status (CEI-I9)
///   - The caller holds an eligible role: PrimaryOwner, SecondaryOwner, Agronomist, or FpcTechnicalManager
/// </summary>
public sealed class VerifyJobCardForPayoutHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>
{
    /// <summary>The audit action of a card made ready to pay (read back by the farm's job-card list, lane L4b M-2).</summary>
    public const string VerifiedForPayoutAction = "jobcard.verified-for-payout";

    public async Task<Result<VerifyJobCardForPayoutResult>> HandleAsync(
        VerifyJobCardForPayoutCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardNotFound);

        // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots writes only on his plots (REST and sync alike).
        if (await Services.PlotScopeGate.RefuseAsync(
                repository, jobCard.FarmId.Value, jobCard.PlotId, command.CallerUserId.Value, clock.UtcNow, ct) is { } outsidePlots)
            return Result.Failure<VerifyJobCardForPayoutResult>(outsidePlots);

        // 2. Load linked daily log.
        if (jobCard.LinkedDailyLogId is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardInvalidState);

        // Lane L4b fix round 1 (L-1) — the ONLY door to "ready to pay" (founder D-33) reads the record under its row
        // hold, like every other change to it: a शंका or a correction in flight finishes first, and this check sees the
        // state it leaves (never a copy read before it).
        var dailyLog = await repository.GetDailyLogForChangeAsync(jobCard.LinkedDailyLogId.Value, ct);
        if (dailyLog is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.DailyLogNotFound);

        // spec: plr-d10 lane PRV fix pass 1 (H2) — the record behind the payout is read for the caller only if he may see it.
        if (!await Services.RecordAudienceGate.MaySeeLogAsync(repository, dailyLog, command.CallerUserId.Value, clock.UtcNow, ct))
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.RecordAudienceClosed);

        // 3. Resolve caller role on farm.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.Forbidden);

        if (!await FarmAuthorityGate.HoldsAsync(
                repository, jobCard.FarmId.Value, command.CallerUserId.Value, FarmAuthority.ReviewMoney, clock.UtcNow, ct))
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // 4. Domain transition — enforces CEI-I9 (linked log must be Verified).
        try
        {
            jobCard.MarkVerifiedForPayout(
                dailyLog.CurrentVerificationStatus,
                command.CallerUserId,
                callerRole.Value,
                clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 5. Emit audit event.
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Verifier-tier-initiated; no AI job correlation.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: VerifiedForPayoutAction,
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, jobCard.LinkedDailyLogId },
                farmId: jobCard.FarmId.Value,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new VerifyJobCardForPayoutResult(jobCard.Id));
    }
}
