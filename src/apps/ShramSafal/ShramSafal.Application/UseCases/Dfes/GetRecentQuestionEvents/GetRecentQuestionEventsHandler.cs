using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;

public sealed class GetRecentQuestionEventsHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<IReadOnlyList<RecentQuestionEventDto>>> HandleAsync(
        GetRecentQuestionEventsQuery query, CancellationToken ct = default)
    {
        if (query.CallerUserId == Guid.Empty || query.FarmId == Guid.Empty)
            return Result.Failure<IReadOnlyList<RecentQuestionEventDto>>(ShramSafalErrors.InvalidCommand);

        var isMember = await repository.IsUserMemberOfFarmAsync(query.FarmId, query.CallerUserId, ct);
        if (!isMember)
            return Result.Failure<IReadOnlyList<RecentQuestionEventDto>>(ShramSafalErrors.Forbidden);

        var sinceDays = query.SinceDays <= 0 ? 14 : query.SinceDays;
        var sinceUtc = clock.UtcNow.AddDays(-sinceDays);
        var rows = await repository.GetRecentQuestionEventsForFarmAsync(query.FarmId, sinceUtc, ct);
        // spec: plr-d10 lane PRV (founder D-26) — a question about a record kept from him is not his to see.
        var visibility = await Services.RecordVisibility.ForFarmAsync(repository, query.FarmId, query.CallerUserId, clock.UtcNow, ct);

        var dtos = rows
            .Where(r => r.DailyLogId is not { } logId || visibility.MaySeeLog(logId))
            .Select(r => new RecentQuestionEventDto(
                r.QuestionKey, r.TriggerType, r.ShownAtUtc, r.CreatedAtUtc, r.StageConfirmed, r.Skipped,
                // wave-3.1 — the log this question was about. Already on the entity and the
                // column; it simply never reached the client, so per-log dedupe was impossible.
                r.DailyLogId))
            .ToList();
        return Result.Success<IReadOnlyList<RecentQuestionEventDto>>(dtos);
    }
}
