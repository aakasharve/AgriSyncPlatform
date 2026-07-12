using AgriSync.SharedKernel.Contracts.Roles; // AppRole.PrimaryOwner
using ShramSafal.Application.UseCases.Dfes.GetFarmerEngagement;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Tests.Logs; // InMemoryShramSafalRepository
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class GetFarmerEngagementHandlerTests
{
    private static readonly Guid FarmId = Guid.Parse("00000000-0000-0000-0000-0000000000c2");
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static DailyRichnessAggregate Rich(int day)
    {
        var aggregate = DailyRichnessAggregate.Create(
            Guid.NewGuid(),
            FarmId,
            new DateOnly(2026, 7, day),
            "Asia/Kolkata",
            DateTimeOffset.UtcNow);

        aggregate.ApplyDerivation(
            execScore: null,
            insightScore: null,
            learningScore: null,
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
        var handler = new GetFarmerEngagementHandler(new InMemoryShramSafalRepository());

        var result = await handler.HandleAsync(new GetFarmerEngagementQuery(Guid.Empty, UserId));

        Assert.True(result.IsFailure);
        Assert.EndsWith("InvalidCommand", result.Error.Code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task NonMember_ReturnsForbidden()
    {
        var repo = new InMemoryShramSafalRepository(); // no membership seeded
        var handler = new GetFarmerEngagementHandler(repo);

        var result = await handler.HandleAsync(new GetFarmerEngagementQuery(FarmId, UserId));

        Assert.True(result.IsFailure);
        Assert.EndsWith("Forbidden", result.Error.Code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Member_FoldsAggregatesIntoDto()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(Rich(1));
        repo.SeededRichnessAggregates.Add(Rich(2));
        var handler = new GetFarmerEngagementHandler(repo);

        var result = await handler.HandleAsync(new GetFarmerEngagementQuery(FarmId, UserId));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.CurrentStreak);
        Assert.Equal(20, result.Value.TotalShramPoints);
        Assert.Equal(2, result.Value.TotalRichDays);
        Assert.Equal("2026-07-02", result.Value.LastAccountedDate);
        Assert.Equal("locked", result.Value.UnlockStatus); // 2 < DfesTuning.RichDayThreshold(25)
    }
}
