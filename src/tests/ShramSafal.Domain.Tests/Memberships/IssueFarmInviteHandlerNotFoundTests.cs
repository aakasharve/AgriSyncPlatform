using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// Sub-plan 03 Task 3: <see cref="IssueFarmInviteHandler"/> must return
/// a <see cref="Result.Failure"/> with <see cref="ShramSafalErrors.FarmNotFound"/>
/// (kind = <see cref="ErrorKind.NotFound"/>) when the farm does not exist —
/// it must NOT throw <see cref="InvalidOperationException"/>.
/// </summary>
public sealed class IssueFarmInviteHandlerNotFoundTests
{
    [Fact]
    public async Task HandleAsync_WhenFarmDoesNotExist_ReturnsFailureWithFarmNotFound()
    {
        var analytics = new CapturingAnalyticsWriter();
        var farmRepo = new StubShramSafalRepository();   // no farm seeded
        var invRepo = new StubFarmInvitationRepository();
        var clock = new FixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));

        var handler = new IssueFarmInviteHandler(
            invRepo, farmRepo, new AllowAllAuthorizationEnforcer(), clock, analytics);

        var unknownFarmId = new FarmId(Guid.Parse("33333333-3333-3333-3333-333333333333"));
        var caller = new UserId(Guid.Parse("11111111-1111-1111-1111-111111111111"));

        var result = await handler.HandleAsync(new IssueFarmInviteCommand(unknownFarmId, caller));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);

        // No analytics emitted on the failure path.
        Assert.Empty(analytics.Events);

        // No invitation persisted.
        Assert.Equal(0, invRepo.SaveCalls);
    }
}
