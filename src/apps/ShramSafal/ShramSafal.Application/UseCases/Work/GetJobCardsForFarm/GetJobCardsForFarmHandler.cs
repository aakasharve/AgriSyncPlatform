using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.2.1.
/// Returns all job cards for a farm, optionally filtered by status.
/// Caller must be an active member of the farm.
/// </summary>
public sealed class GetJobCardsForFarmHandler(IShramSafalRepository repository)
{
    public async Task<Result<List<JobCardDto>>> HandleAsync(
        GetJobCardsForFarmQuery query,
        CancellationToken ct = default)
    {
        // Verify the caller is a farm member.
        var isMember = await repository.IsUserMemberOfFarmAsync(
            query.FarmId.Value, query.CallerUserId.Value, ct);

        if (!isMember)
            return Result.Failure<List<JobCardDto>>(ShramSafalErrors.Forbidden);

        var jobCards = await repository.GetJobCardsForFarmAsync(
            query.FarmId, query.StatusFilter, ct);

        var dtos = jobCards.Select(j => j.ToJobCardDto()).ToList();
        return Result.Success(dtos);
    }
}
