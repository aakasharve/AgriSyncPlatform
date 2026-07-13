using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Reads the active farm's
/// <see cref="Domain.Dfes.DailyRichnessAggregate"/> for one local day and rolls
/// its three INTERNAL lens scores UP into the single farmer-facing Day
/// Understanding Score (X/10) via <see cref="DayUnderstandingScore"/>.
///
/// <para>Exposes ONLY the /10 (<see cref="DayUnderstandingDto"/>). The lens
/// triple is read from the aggregate but NEVER placed on the DTO. RLS: the
/// per-day read is farm-scoped (daily_richness_aggregates is farm_id RLS-gated)
/// and the membership check below rejects any caller who is not a member of the
/// requested farm — no cross-farm leak.</para>
/// </summary>
public sealed class GetDayUnderstandingHandler(IShramSafalRepository repository)
{
    public async Task<Result<DayUnderstandingDto>> HandleAsync(
        GetDayUnderstandingQuery query,
        CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty || query.CallerUserId == Guid.Empty)
        {
            return Result.Failure<DayUnderstandingDto>(ShramSafalErrors.InvalidCommand);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(query.FarmId, query.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<DayUnderstandingDto>(ShramSafalErrors.Forbidden);
        }

        var aggregate = await repository.GetDailyRichnessAggregateAsync(query.FarmId, query.LocalDate, ct);

        // No aggregate for the day yet (nothing scorable logged) → score is null,
        // NOT a failure: the success screen simply shows no number.
        var score = aggregate is null
            ? (int?)null
            : DayUnderstandingScore.From(new LensScores(
                aggregate.ExecutionScore, aggregate.InsightScore, aggregate.LearningScore));

        return Result.Success(new DayUnderstandingDto(score));
    }
}
