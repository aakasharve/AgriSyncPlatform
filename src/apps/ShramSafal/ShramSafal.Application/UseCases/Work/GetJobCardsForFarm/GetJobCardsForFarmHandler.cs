using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.2.1.
/// Returns all job cards for a farm, optionally filtered by status.
/// Caller must be an active member of the farm.
/// </summary>
/// <summary>
/// The farm's job cards. lane MU-3 (founder D-22 / D-26; fix 1 F7) — a job card is the farm's WORK (plot, day,
/// worker, tasks): every seat that reads the farm's work gets it; its rates and payout are a worker's pay and
/// go only to a seat that sees wages (<see cref="ReadScopeProjection.JobCard"/>). An own-records-only seat
/// (a कामगार) reads no farm list — the sync pull applies the same rule.
/// </summary>
public sealed class GetJobCardsForFarmHandler(IShramSafalRepository repository, IClock? clock = null)
{
    public async Task<Result<List<JobCardDto>>> HandleAsync(
        GetJobCardsForFarmQuery query,
        CancellationToken ct = default)
    {
        // Verify the caller is a farm member.
        var isMember = await repository.IsUserMemberOfFarmAsync(
            query.FarmId.Value, query.CallerUserId.Value, ct);

        var scope = isMember
            ? await FarmReadGate.ScopeAsync(repository, query.FarmId.Value, query.CallerUserId.Value, clock?.UtcNow ?? DateTime.UtcNow, ct)
            : null;
        if (scope is null || scope.OwnRecordsOnly)
            return Result.Failure<List<JobCardDto>>(ShramSafalErrors.Forbidden);

        var jobCards = await repository.GetJobCardsForFarmAsync(
            query.FarmId, query.StatusFilter, ct);

        var dtos = jobCards
            .Select(j => ReadScopeProjection.JobCard(j.ToJobCardDto(), scope, query.CallerUserId.Value))
            .ToList();
        return Result.Success(dtos);
    }
}
