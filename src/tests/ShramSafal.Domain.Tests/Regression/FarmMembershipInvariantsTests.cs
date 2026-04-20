using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Regression;

/// <summary>
/// Spec §9 regressions:
///   - Last PrimaryOwner revocation rejected (I3)
/// </summary>
public sealed class FarmMembershipInvariantsTests
{
    [Fact]
    public void Exit_LastPrimaryOwner_Throws_LastPrimaryOwnerRevocationException()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());
        var membership = FarmMembership.Create(Guid.NewGuid(), farmId, userId, AppRole.PrimaryOwner, DateTime.UtcNow);

        var ex = Assert.Throws<LastPrimaryOwnerRevocationException>(() =>
            membership.Exit(DateTime.UtcNow, isLastActivePrimaryOwner: true));

        Assert.NotNull(ex);
    }

    [Fact]
    public void Exit_Worker_Succeeds_Regardless()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());
        var membership = FarmMembership.Create(Guid.NewGuid(), farmId, userId, AppRole.Worker, DateTime.UtcNow);

        // Workers can always exit — isLastActivePrimaryOwner is irrelevant.
        membership.Exit(DateTime.UtcNow, isLastActivePrimaryOwner: false);

        Assert.True(membership.IsTerminal);
    }

    [Fact]
    public void Exit_PrimaryOwner_With_Other_Active_Owners_Succeeds()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());
        var membership = FarmMembership.Create(Guid.NewGuid(), farmId, userId, AppRole.PrimaryOwner, DateTime.UtcNow);

        // There IS another active PrimaryOwner (isLastActivePrimaryOwner = false).
        membership.Exit(DateTime.UtcNow, isLastActivePrimaryOwner: false);

        Assert.True(membership.IsTerminal);
    }
}
