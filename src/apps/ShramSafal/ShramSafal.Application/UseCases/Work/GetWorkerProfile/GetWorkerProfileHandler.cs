using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetWorkerProfile;

/// <summary>
/// CEI Phase 4 §4.8 — Task 3.2.1 + 3.3.1.
/// Returns a worker's profile including ReliabilityScore computed over the trailing 30 days.
/// Access: caller is the worker themselves, OR a member of a farm the worker is on.
///
/// <para>spec: dfes-companion-2026-07-11 (wave-4.4) — <b>this is a TIER 1 read.</b> What
/// it returns is the farm's own operational record of its own work: what it paid him, how
/// its own logs were verified, how many of its own disputes he was in. That is the farm's
/// business record, not the worker's reputation, so it never crosses a farm boundary and
/// <b>no consent opens it</b> — the worker cannot license his employer's books, and this
/// handler deliberately does not ask him to. What a worker CAN license lives in
/// <c>GetWorkerReputationHandler</c> (tiers 2 and 3). See <see cref="WorkerRecordTier"/>.</para>
/// </summary>
public sealed class GetWorkerProfileHandler(
    IShramSafalRepository repository,
    IClock clock,
    ILogger<GetWorkerProfileHandler> logger)
{
    public async Task<Result<WorkerProfileDto>> HandleAsync(
        GetWorkerProfileQuery query,
        CancellationToken ct = default)
    {
        // 1. Access check, at TIER 1.
        //
        // This replaces a bare "do they share any farm" test that then handed
        // query.ScopedFarmId straight to the metrics read. Two things were wrong with
        // that: a null farmId asked for a score aggregated across every farm he has
        // worked, and a supplied farmId was never checked against the caller's own farms
        // — so a farm B owner could name farm A and read his record there.
        var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
        var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);

        // Founder ruling, 2026-08-17: an owner with two farms of HIS OWN is reading his own
        // record across both, not carrying a reputation between employers. Ownership is
        // fetched separately from membership because only ownership earns that widening.
        var callerOwnedFarmIds = await repository
            .GetOwnedFarmIdsForUserAsync(query.CallerUserId.Value, ct);

        // Read, but at tier 1 it cannot change the answer — no consent of his opens his
        // employer's operational record. It is passed anyway so the decision is taken in
        // one place with the full picture, and so removing the tier would fail loudly here
        // rather than silently widening this read.
        var portabilityConsent = await repository
            .HasWorkerRecordPortabilityConsentAsync(query.WorkerUserId, ct);

        var access = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: query.CallerUserId.Value,
            workerUserId: query.WorkerUserId.Value,
            callerFarmIds: callerFarmIds,
            callerOwnedFarmIds: callerOwnedFarmIds,
            workerFarmIds: workerFarmIds,
            requestedFarmId: query.ScopedFarmId,
            workerConsentedToPortability: portabilityConsent);

        if (!access.IsAllowed)
        {
            logger.LogInformation(
                "GetWorkerProfile refused for worker {WorkerUserId} by caller {CallerUserId}: {DenyReason}.",
                query.WorkerUserId, query.CallerUserId, access.DenyReason);

            return Result.Failure<WorkerProfileDto>(
                access.DenyReason == WorkerRecordPortability.DenyReasons.NoSharedFarm
                    ? ShramSafalErrors.Forbidden
                    : ShramSafalErrors.WorkerRecordPortabilityForbidden);
        }

        // 2. Load worker metrics — over the farms the guard permitted, never over the raw
        //    farm id the client asked for, and never over an open-ended scope.
        var since30d = clock.UtcNow.AddDays(-30);
        var metrics = await repository.GetWorkerMetricsAsync(
            query.WorkerUserId, access.PermittedFarmIds, since30d, ct);

        // 3. Compute ReliabilityScore.
        var reliability = ReliabilityScore.Compute(
            metrics.LogCount30d,
            metrics.VerifiedCount30d,
            metrics.DisputedCount30d,
            metrics.OnTimeCount30d,
            metrics.PlannedCount30d,
            clock.UtcNow);

        // 4. Resolve display name from operator directory.
        var displayName = string.Empty;
        try
        {
            var operators = await repository.GetOperatorsByIdsAsync([query.WorkerUserId.Value], ct);
            displayName = operators.FirstOrDefault(o => o.UserId == query.WorkerUserId.Value)?.DisplayName
                         ?? string.Empty;
        }
        catch (Exception ex)
        {
            // Sub-plan 03 Task 10: display-name lookup is non-critical
            // (the rest of WorkerProfile is fully populated above), but
            // the failure must be observable. Log a Warning + empty
            // string fallback rather than a silent swallow.
            logger.LogWarning(ex,
                "GetWorkerProfile: operator-directory lookup for {WorkerUserId} threw {ExceptionType}; falling back to empty display name.",
                query.WorkerUserId, ex.GetType().Name);
        }

        return Result.Success(new WorkerProfileDto(
            WorkerUserId: query.WorkerUserId.Value,
            DisplayName: displayName,
            JobCardsLast30d: metrics.JobCardsLast30d,
            JobCardsPaidOutLast30d: metrics.JobCardsPaidOutLast30d,
            EarnedLast30d: metrics.EarnedLast30d,
            EarnedCurrencyCode: metrics.EarnedCurrencyCode,
            ReliabilityOverall: reliability.Overall,
            VerifiedRatio: reliability.VerifiedRatio,
            OnTimeRatio: reliability.OnTimeRatio,
            DisputeFreeRatio: reliability.DisputeFreeRatio,
            LogCount30d: reliability.LogCount30d,
            DisputeCount30d: reliability.DisputeCount30d,
            ComputedAtUtc: reliability.ComputedAtUtc));
    }
}
