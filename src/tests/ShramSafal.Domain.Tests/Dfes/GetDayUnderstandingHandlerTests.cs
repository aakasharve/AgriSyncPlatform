using AgriSync.SharedKernel.Contracts.Roles; // AppRole.PrimaryOwner
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Tests.Logs; // InMemoryShramSafalRepository
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Guards the per-day read that
/// exposes ONLY the /10: membership gating, the null-when-no-aggregate case, the
/// server-side rollup, and (by reflection) that the wire DTO never grows a lens
/// field.
/// </summary>
public sealed class GetDayUnderstandingHandlerTests
{
    private static readonly Guid FarmId = Guid.Parse("00000000-0000-0000-0000-0000000000c2");
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly DateOnly Day = new(2026, 7, 13);

    private static DailyRichnessAggregate WithLenses(int? exec, int? insight, int? learning)
    {
        var aggregate = DailyRichnessAggregate.Create(
            Guid.NewGuid(), FarmId, Day, "Asia/Kolkata", DateTimeOffset.UtcNow);

        aggregate.ApplyDerivation(
            execScore: exec,
            insightScore: insight,
            learningScore: learning,
            classification: DayClassification.RichWorkDay,
            flags: default,
            advancesStreak: true,
            advancesBar: true,
            shramPoints: 10,
            rewardReasonsJson: "[]",
            noWorkReasonCode: null,
            scoreEngineVersion: DfesTuning.ScoreEngineVersion,
            componentsJson: "{}");

        return aggregate;
    }

    [Fact]
    public async Task EmptyFarmId_ReturnsInvalidCommand()
    {
        var handler = new GetDayUnderstandingHandler(new InMemoryShramSafalRepository());

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(Guid.Empty, Day, UserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("InvalidCommand");
    }

    [Fact]
    public async Task EmptyCallerUserId_ReturnsInvalidCommand()
    {
        var handler = new GetDayUnderstandingHandler(new InMemoryShramSafalRepository());

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, Guid.Empty));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("InvalidCommand");
    }

    [Fact]
    public async Task NonMember_ReturnsForbidden()
    {
        var repo = new InMemoryShramSafalRepository(); // no membership seeded
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("Forbidden");
    }

    [Fact]
    public async Task Member_NoAggregateForDay_ReturnsNullScore()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Score.Should().BeNull(); // nothing logged → no number, not a failure
    }

    [Fact]
    public async Task Member_RollsInternalLensesIntoDayScore()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithLenses(80, 60, 40)); // mean 60 → 6
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Score.Should().Be(6);
    }

    [Fact]
    public async Task Member_AllNullLenses_ReturnsNullScore()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithLenses(null, null, null));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Score.Should().BeNull();
    }

    [Fact]
    public async Task WrongDay_DoesNotReturnAnotherDaysAggregate()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithLenses(80, 60, 40)); // seeded on Day
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(
            new GetDayUnderstandingQuery(FarmId, Day.AddDays(-1), UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Score.Should().BeNull();
    }

    [Fact]
    public void Dto_exposes_only_the_score_never_a_lens_field()
    {
        // Contract guard: the client-facing DTO must carry ONLY the /10. If a
        // future change adds a lens (Execution/Insight/Learning) to the wire
        // shape this fails loudly.
        var props = typeof(DayUnderstandingDto).GetProperties().Select(p => p.Name).ToArray();

        props.Should().ContainSingle().Which.Should().Be(nameof(DayUnderstandingDto.Score));
        props.Should().NotContain(n =>
            n.Contains("Execution", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Insight", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Learning", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Lens", StringComparison.OrdinalIgnoreCase));
    }
}
