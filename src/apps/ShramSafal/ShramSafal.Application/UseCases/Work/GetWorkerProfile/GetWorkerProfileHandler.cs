using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetWorkerProfile;

/// <summary>
/// CEI Phase 4 §4.8 — Task 3.2.1 + 3.3.1.
/// Returns a worker's profile including ReliabilityScore computed over the trailing 30 days.
/// Access: caller is the worker themselves, OR a member of a farm the worker is on.
/// </summary>
public sealed class GetWorkerProfileHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<WorkerProfileDto>> HandleAsync(
        GetWorkerProfileQuery query,
        CancellationToken ct = default)
    {
        // 1. Access check.
        if (query.CallerUserId != query.WorkerUserId)
        {
            var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
            var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);
            var hasSharedFarm = callerFarmIds.Any(id => workerFarmIds.Contains(id));
            if (!hasSharedFarm)
                return Result.Failure<WorkerProfileDto>(ShramSafalErrors.Forbidden);
        }

        // 2. Load worker metrics.
        var since30d = clock.UtcNow.AddDays(-30);
        var metrics = await repository.GetWorkerMetricsAsync(
            query.WorkerUserId, query.ScopedFarmId, since30d, ct);

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
        catch
        {
            // Display name is non-critical; proceed with empty string if unavailable.
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
