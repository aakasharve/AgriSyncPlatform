using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// Sub-plan 03 Task 3: <see cref="RotateFarmInviteHandler"/> must return
/// a <see cref="Result.Failure"/> with <see cref="ShramSafalErrors.FarmNotFound"/>
/// when the farm does not exist — no <see cref="InvalidOperationException"/>.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT: the handler ctor no longer takes
/// <c>IAuthorizationEnforcer</c> (ownership moved to
/// <see cref="RotateFarmInviteAuthorizer"/>). This test exercises the
/// raw handler body verbatim — no pipeline. The pipeline-level coverage
/// lives in <see cref="RotateFarmInvitePipelineTests"/>.
/// </para>
/// </summary>
public sealed class RotateFarmInviteHandlerNotFoundTests
{
    [Fact]
    public async Task HandleAsync_WhenFarmDoesNotExist_ReturnsFailureWithFarmNotFound()
    {
        var farmRepo = new StubShramSafalRepository();   // no farm seeded
        var invRepo = new StubFarmInvitationRepository();
        var clock = new FixedClock(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));

        var handler = new RotateFarmInviteHandler(invRepo, farmRepo, clock);

        var unknownFarmId = new FarmId(Guid.Parse("44444444-4444-4444-4444-444444444444"));
        var caller = new UserId(Guid.Parse("11111111-1111-1111-1111-111111111111"));

        var result = await handler.HandleAsync(new RotateFarmInviteCommand(unknownFarmId, caller));

        Assert.False(result.IsSuccess);
        Assert.Equal(ShramSafalErrors.FarmNotFound, result.Error);
        Assert.Equal(ErrorKind.NotFound, result.Error.Kind);
        Assert.Equal(0, invRepo.SaveCalls);
    }
}
