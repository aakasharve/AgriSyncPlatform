using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

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

        // spec: plr-d10 lane MU-4 (§11.6) — a chosen-plots seat: the cards on his plots.
        var jobCards = (await repository.GetJobCardsForFarmAsync(query.FarmId, query.StatusFilter, ct))
            .Where(j => scope.MayReadTask(query.CallerUserId.Value, j.PlotId, j.AssignedWorkerUserId?.Value))
            .ToList();

        var whole = jobCards.Select(j => j.ToJobCardDto()).ToList();
        var dtos = whole
            .Select(j => ReadScopeProjection.JobCard(j, scope, query.CallerUserId.Value))
            .ToList();

        // lane MU-3 fix 2 (N1) — a phone that would draw a withheld pay as a number (1.0.17) is refused, as edee6667
        // refused it, rather than shown "INR 0".
        if (!query.ClientShowsWithheldPay && dtos.Where((d, i) => !ReferenceEquals(d, whole[i])).Any())
            return Result.Failure<List<JobCardDto>>(ShramSafalErrors.Forbidden);

        // spec: plr-d10 lane PRV (founder D-26) — a card never names a record kept from him (after the pay rule above).
        var visibility = await RecordVisibility.ForFarmAsync(
            repository, query.FarmId.Value, query.CallerUserId.Value, clock?.UtcNow ?? DateTime.UtcNow, ct);
        var visible = dtos.Select(visibility.WithoutHiddenLinks).ToList();
        return Result.Success(await WithPayoutStepFactsAsync(visible, query.FarmId, ct));
    }

    private static readonly string[] PayoutNotes =
    [
        VerifyJobCardForPayoutHandler.VerifiedForPayoutAction,
        OnLogVerifiedAutoVerifyJobCard.PayoutReadinessWithdrawnAction,
    ];

    /// <summary>
    /// spec: plr-d10 lane L4b fix round 1 (H-1 / CTO D-89, M-2) — what the phone needs to show the card's money step
    /// truthfully: the linked record's state (after D-33 a मंजूर no longer makes a card ready to pay, so "पेआउट तपासा"
    /// is offered only on a Completed card whose record is approved), and whether a शंका or a correction took the card
    /// back from "ready to pay" (its latest payout note is a withdrawal). Read after the visibility rule: a record kept
    /// from this reader has no link, so its state is not named either.
    /// </summary>
    private async Task<List<JobCardDto>> WithPayoutStepFactsAsync(List<JobCardDto> cards, FarmId farmId, CancellationToken ct)
    {
        var linked = cards
            .Where(c => c.LinkedDailyLogId is not null)
            .Select(c => c.LinkedDailyLogId!.Value)
            .Distinct()
            .ToList();
        if (linked.Count == 0)
            return cards;

        var recordStates = (await repository.GetDailyLogsForFarmByIdsAsync(farmId, linked, ct))
            .ToDictionary(l => l.Id, l => l.CurrentVerificationStatus.ToString());
        var lastPayoutNote = (await repository.GetAuditEventsForFarmByActionsAsync(farmId.Value, PayoutNotes, ct))
            .GroupBy(a => a.EntityId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(a => a.OccurredAtUtc).First().Action);

        return cards
            .Select(c => c with
            {
                LinkedDailyLogStatus = c.LinkedDailyLogId is { } logId && recordStates.TryGetValue(logId, out var state)
                    ? state
                    : null,
                // Fix round 2 (re-review 2 L-a) — only where the record link survived the visibility rule for this
                // reader: "a record behind this card was questioned" is itself a fact about a record kept from him.
                PayoutCheckWithdrawn = c.LinkedDailyLogId is not null
                    && c.Status == nameof(JobCardStatus.Completed)
                    && lastPayoutNote.TryGetValue(c.Id, out var note)
                    && note == OnLogVerifiedAutoVerifyJobCard.PayoutReadinessWithdrawnAction,
            })
            .ToList();
    }
}
