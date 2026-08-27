using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class GetRecentQuestionEventsHandlerTests
{
    private static readonly DateTime FixedNow = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    private static QuestionEvent Row(Guid farmId, Guid? dailyLogId, string questionKey = "gap.dose")
        => QuestionEvent.Create(
            Guid.NewGuid(), dailyLogId, farmId, null, questionKey, "grapes", null, null,
            "log_date", "Gap", "gap_fill", "Execution", 1, 4, 3, "voice", "informational",
            true, true, "dfes-bank-1", "dfes-qengine-1", null, FixedNow, "gap DOSE", null,
            "10 ml", null, false, false, FixedNow);

    [Fact]
    public async Task Projects_rows_to_dtos_for_a_member()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var rows = new List<QuestionEvent> { Row(farmId, dailyLogId: null) };
        var repo = new RecentRepo(farmId, rows, memberOfFarm: true);
        var handler = new GetRecentQuestionEventsHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(
            new GetRecentQuestionEventsQuery(userId, farmId, 14), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value);
        Assert.Equal("gap.dose", result.Value[0].questionKey);
    }

    /// <summary>
    /// wave-3.1 (spec: dfes-companion-2026-07-11) — the handler must project
    /// <c>QuestionEvent.DailyLogId</c> onto the wire. The column and the entity property
    /// have both existed since the DFES data spine; the projection never carried them, so
    /// the client could not tell which LOG a past question was about and wave-3.2's per-log
    /// dedupe (spec Ruling 1) had nothing to key on.
    /// </summary>
    [Fact]
    public async Task Projects_the_daily_log_id_the_question_was_about()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var logId = Guid.NewGuid();
        var repo = new RecentRepo(farmId, [Row(farmId, dailyLogId: logId)], memberOfFarm: true);
        var handler = new GetRecentQuestionEventsHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(
            new GetRecentQuestionEventsQuery(userId, farmId, 14), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(logId, result.Value[0].dailyLogId);
    }

    /// <summary>
    /// The counterpart: a legacy row (every row written before wave-3.1) has
    /// <c>daily_log_id</c> NULL and must arrive as null, NOT as an empty Guid. The client
    /// reads null as "legacy row — keep the day cooldown"; <c>Guid.Empty</c> would read as a
    /// real log id nothing matches and would unblock every gap question at once.
    /// </summary>
    [Fact]
    public async Task Projects_a_legacy_row_with_a_null_daily_log_id()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var repo = new RecentRepo(farmId, [Row(farmId, dailyLogId: null)], memberOfFarm: true);
        var handler = new GetRecentQuestionEventsHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(
            new GetRecentQuestionEventsQuery(userId, farmId, 14), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value[0].dailyLogId);
    }

    [Fact]
    public async Task Forbids_non_member()
    {
        var repo = new RecentRepo(Guid.NewGuid(), new(), memberOfFarm: false);
        var handler = new GetRecentQuestionEventsHandler(repo, new FixedClock(FixedNow));
        var result = await handler.HandleAsync(
            new GetRecentQuestionEventsQuery(Guid.NewGuid(), Guid.NewGuid(), 14), CancellationToken.None);
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

    private sealed class RecentRepo(Guid farmId, List<QuestionEvent> rows, bool memberOfFarm) : FakeShramSafalRepository
    {
        public override Task<bool> IsUserMemberOfFarmAsync(Guid f, Guid u, CancellationToken ct = default)
            => Task.FromResult(memberOfFarm);
        public override Task<IReadOnlyList<QuestionEvent>> GetRecentQuestionEventsForFarmAsync(Guid f, DateTime since, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<QuestionEvent>>(f == farmId ? rows : new List<QuestionEvent>());
    }
}
