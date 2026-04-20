using Accounts.Domain.Events;
using Accounts.Domain.OwnerAccounts;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.OwnerAccounts;

/// <summary>
/// Invariant coverage for the <see cref="OwnerAccount"/> aggregate.
/// Maps to plan spec §3.4 invariants I4.
/// </summary>
public sealed class OwnerAccountInvariantTests
{
    private static readonly OwnerAccountId AccountId = new(Guid.Parse("0a000000-0000-0000-0000-000000000001"));
    private static readonly UserId PrimaryOwner = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId SecondaryOwner = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));

    private static readonly DateTime Now = new(2026, 4, 18, 10, 0, 0, DateTimeKind.Utc);

    [Fact(DisplayName = "Create assigns PrimaryOwner membership and raises OwnerAccountCreated")]
    public void Create_assigns_primary_owner_and_raises_event()
    {
        var account = OwnerAccount.Create(AccountId, "Ramu Patil Farm", PrimaryOwner, OwnerAccountType.Individual, Now);

        Assert.Equal(PrimaryOwner, account.PrimaryOwnerUserId);
        Assert.Equal(OwnerAccountStatus.Active, account.Status);
        Assert.Single(account.Memberships);
        Assert.Single(account.Memberships, m => m.IsActivePrimaryOwner);
        Assert.Single(account.DomainEvents);
        Assert.IsType<OwnerAccountCreated>(account.DomainEvents.Single());
    }

    [Fact(DisplayName = "Revoking the last active PrimaryOwner is rejected (invariant I4)")]
    public void Revoking_last_primary_owner_is_rejected()
    {
        var account = OwnerAccount.Create(AccountId, "Ramu Patil Farm", PrimaryOwner, OwnerAccountType.Individual, Now);
        var primaryMembership = account.Memberships.Single();

        var ex = Assert.Throws<LastPrimaryOwnerRevocationException>(
            () => account.RevokeMembership(primaryMembership.Id, Now));

        Assert.Equal(AccountId, ex.OwnerAccountId);
    }

    [Fact(DisplayName = "Secondary owners can be invited and revoked without violating I4")]
    public void Secondary_owner_can_be_invited_and_revoked()
    {
        var account = OwnerAccount.Create(AccountId, "Ramu Patil Farm", PrimaryOwner, OwnerAccountType.Individual, Now);

        var secondary = account.InviteSecondaryOwner(
            OwnerAccountMembershipId.New(),
            SecondaryOwner,
            invitedByUserId: PrimaryOwner,
            utcNow: Now);

        Assert.Equal(2, account.Memberships.Count);
        Assert.Equal(OwnerAccountRole.SecondaryOwner, secondary.Role);

        account.RevokeMembership(secondary.Id, Now.AddMinutes(5));

        Assert.Equal(OwnerAccountMembershipStatus.Revoked, secondary.Status);
        // I4 still holds — primary owner remains.
        Assert.Single(account.Memberships, m => m.IsActivePrimaryOwner);
    }

    [Fact(DisplayName = "Duplicate secondary-owner invite for the same user is rejected")]
    public void Duplicate_secondary_owner_invite_is_rejected()
    {
        var account = OwnerAccount.Create(AccountId, "Ramu Patil Farm", PrimaryOwner, OwnerAccountType.Individual, Now);
        account.InviteSecondaryOwner(OwnerAccountMembershipId.New(), SecondaryOwner, PrimaryOwner, Now);

        Assert.Throws<InvalidOperationException>(
            () => account.InviteSecondaryOwner(OwnerAccountMembershipId.New(), SecondaryOwner, PrimaryOwner, Now));
    }
}
