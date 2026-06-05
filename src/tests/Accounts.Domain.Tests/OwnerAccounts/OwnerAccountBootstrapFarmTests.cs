using Accounts.Domain.OwnerAccounts;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.OwnerAccounts;

/// <summary>
/// Covers OwnerAccount.SetBootstrappedFarm — the accounts-side record of the
/// first-farm bootstrap that makes /bootstrap/first-farm idempotent and
/// recoverable across a partial write (spec bootstrap-first-farm-rls-tenant-context).
/// </summary>
public sealed class OwnerAccountBootstrapFarmTests
{
    private static readonly OwnerAccountId AccountId = new(Guid.Parse("0a000000-0000-0000-0000-0000000000aa"));
    private static readonly UserId PrimaryOwner = new(Guid.Parse("11111111-1111-1111-1111-1111111111aa"));
    private static readonly DateTime Now = new(2026, 6, 5, 10, 0, 0, DateTimeKind.Utc);

    private static OwnerAccount NewAccount() =>
        OwnerAccount.Create(AccountId, "Purvesh Farm", PrimaryOwner, OwnerAccountType.Individual, Now);

    [Fact(DisplayName = "BootstrappedFarmId starts null and SetBootstrappedFarm records the farm")]
    public void Sets_bootstrapped_farm_when_unset()
    {
        var account = NewAccount();
        Assert.Null(account.BootstrappedFarmId);

        var farmId = Guid.Parse("f0000000-0000-0000-0000-0000000000f1");
        var later = Now.AddMinutes(1);
        account.SetBootstrappedFarm(farmId, later);

        Assert.Equal(farmId, account.BootstrappedFarmId);
        Assert.Equal(later, account.ModifiedAtUtc);
    }

    [Fact(DisplayName = "Re-linking the SAME farm id is an idempotent no-op")]
    public void Relinking_same_farm_is_idempotent()
    {
        var account = NewAccount();
        var farmId = Guid.Parse("f0000000-0000-0000-0000-0000000000f1");
        account.SetBootstrappedFarm(farmId, Now);

        // No throw, value unchanged — safe for a bootstrap retry.
        account.SetBootstrappedFarm(farmId, Now.AddHours(1));

        Assert.Equal(farmId, account.BootstrappedFarmId);
    }

    [Fact(DisplayName = "Re-linking a DIFFERENT farm id throws (an account bootstraps exactly one first farm)")]
    public void Relinking_different_farm_throws()
    {
        var account = NewAccount();
        account.SetBootstrappedFarm(Guid.Parse("f0000000-0000-0000-0000-0000000000f1"), Now);

        Assert.Throws<InvalidOperationException>(
            () => account.SetBootstrappedFarm(Guid.Parse("f0000000-0000-0000-0000-0000000000f2"), Now));
    }

    [Fact(DisplayName = "Empty farm id is rejected")]
    public void Empty_farm_id_rejected()
    {
        var account = NewAccount();
        Assert.Throws<ArgumentException>(() => account.SetBootstrappedFarm(Guid.Empty, Now));
    }
}
