using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Reads the active farm's
/// <see cref="Domain.Dfes.DailyRichnessAggregate"/> for one local day and rolls its
/// per-dimension breakdown UP into the single farmer-facing Day Understanding Score
/// (X/10) via <see cref="DayUnderstandingScore"/>.
///
/// <para>The rollup reads <c>components_json</c> — the per-dimension breakdown the
/// derivation service already persists — NOT the three lens columns. Those columns
/// only carry each lens's 0–100 ratio, which has already thrown away the weights;
/// dividing by a fixed denominator needs the dimension rows themselves. Keeping the
/// score DERIVED on read (rather than adding a persisted column) means it always
/// reflects the current engine.</para>
///
/// <para>Exposes the /10 AND the day's stored classification
/// (<see cref="DayUnderstandingDto"/>) — and nothing else. Neither the lens triple
/// nor any dimension is ever placed on the DTO. RLS: the per-day read is
/// farm-scoped (daily_richness_aggregates is farm_id RLS-gated) and the membership
/// check below rejects any caller who is not a member of the requested farm — no
/// cross-farm leak.</para>
///
/// <para>spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (Task 6). The
/// classification was added on founder ruling 2 (2026-08-14) — "Reward honesty and
/// mark its consistency — no score needed for such days" — SUPERSEDING this
/// handler's earlier score-only contract. A day the farmer honestly declared as
/// no-work must show him NO number (a 0 would punish the honesty the product is
/// built to earn), and the client cannot tell that day apart from a zero-scoring
/// one without being told. What is passed out is the value the Phase-2 classifier
/// ALREADY stamped on the aggregate; this handler derives no classification of its
/// own, and neither may the client (P4/P8 — the server is the authority on what
/// kind of day it was).</para>
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
            : DayUnderstandingScore.From(UnderstandingComponents.Read(aggregate.ComponentsJson));

        // The STORED classification, passed straight out. No aggregate means the
        // server has no opinion on what kind of day this was — null, never a
        // guessed one.
        var classification = aggregate?.DayClassification.ToString();

        return Result.Success(new DayUnderstandingDto(score, classification));
    }
}
