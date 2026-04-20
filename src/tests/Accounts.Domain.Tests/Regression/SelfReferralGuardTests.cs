using Accounts.Domain.Affiliation;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.Regression;

/// <summary>Spec §9 regression: self-referral rejected (I13).</summary>
public sealed class SelfReferralGuardTests
{
    [Fact]
    public void ReferralRelationship_Rejects_SelfReferral()
    {
        var accountId = new OwnerAccountId(Guid.NewGuid());

        var ex = Assert.Throws<InvalidOperationException>(() =>
            new ReferralRelationship(
                new ReferralRelationshipId(Guid.NewGuid()),
                referrerOwnerAccountId: accountId,
                referredOwnerAccountId: accountId, // same — I13
                referralCodeId: new ReferralCodeId(Guid.NewGuid()),
                createdAtUtc: DateTime.UtcNow));

        Assert.Contains("I13", ex.Message);
    }

    [Fact]
    public void ReferralRelationship_Allows_DifferentAccounts()
    {
        // Must not throw.
        _ = new ReferralRelationship(
            new ReferralRelationshipId(Guid.NewGuid()),
            referrerOwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            referredOwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            referralCodeId: new ReferralCodeId(Guid.NewGuid()),
            createdAtUtc: DateTime.UtcNow);
    }
}
