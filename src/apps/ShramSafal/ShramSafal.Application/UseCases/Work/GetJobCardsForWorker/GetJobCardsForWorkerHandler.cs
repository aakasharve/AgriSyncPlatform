using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.2.1.
/// Returns all job cards assigned to a specific worker.
/// The caller must either be the worker themselves or a farm member of one of the worker's farms.
/// </summary>
public sealed class GetJobCardsForWorkerHandler(IShramSafalRepository repository)
{
    public async Task<Result<List<JobCardDto>>> HandleAsync(
        GetJobCardsForWorkerQuery query,
        CancellationToken ct = default)
    {
        // Access check: caller must be the worker themselves, or a member of a farm the worker belongs to.
        // Simplified: if caller is the worker, always allow. Otherwise, we load worker's farms and check.
        if (query.CallerUserId != query.WorkerUserId)
        {
            // Caller must share at least one farm with the worker.
            var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
            var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);
            var hasSharedFarm = callerFarmIds.Any(id => workerFarmIds.Contains(id));
            if (!hasSharedFarm)
                return Result.Failure<List<JobCardDto>>(ShramSafalErrors.Forbidden);
        }

        var jobCards = await repository.GetJobCardsForWorkerAsync(query.WorkerUserId, ct);
        var dtos = jobCards.Select(j => j.ToJobCardDto()).ToList();
        return Result.Success(dtos);
    }
}
