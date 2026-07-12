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

    [Fact]
    public async Task Projects_rows_to_dtos_for_a_member()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var rows = new List<QuestionEvent>
        {
            QuestionEvent.Create(
                Guid.NewGuid(), null, farmId, null, "gap.dose", "grapes", null, null,
                "log_date", "Gap", "gap_fill", "Execution", 1, 4, 3, "voice", "informational",
                true, true, "dfes-bank-1", "dfes-qengine-1", null, FixedNow, "gap DOSE", null,
                "10 ml", null, false, false, FixedNow),
        };
        var repo = new RecentRepo(farmId, rows, memberOfFarm: true);
        var handler = new GetRecentQuestionEventsHandler(repo, new FixedClock(FixedNow));

        var result = await handler.HandleAsync(
            new GetRecentQuestionEventsQuery(userId, farmId, 14), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value);
        Assert.Equal("gap.dose", result.Value[0].questionKey);
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
