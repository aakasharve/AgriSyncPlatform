using FluentAssertions;
using AgriSync.SharedKernel.Contracts.Roles;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// CEI Phase 2 — I7: AppRole values are additive.
/// Existing rows 0–3 must never be renumbered; new CEI values 4–8 must
/// land at the specified underlying ints and be present in both the
/// SharedKernel source-of-truth and the User.Domain mirror.
/// </summary>
public sealed class AppRoleInvariantTests
{
    // -------------------------------------------------------------------------
    // Task 1.1.1 — SharedKernel AppRole stability
    // -------------------------------------------------------------------------

    /// <summary>
    /// CEI-I7a: Existing values 0–3 are frozen. Any renumbering would silently
    /// corrupt persisted role data in the database.
    /// </summary>
    [Fact]
    public void AppRole_ExistingValuesNumbering_Unchanged()
    {
        ((int)AppRole.Worker).Should().Be(0, "CEI-I7: Worker = 0 is frozen — renumbering corrupts persisted data");
        ((int)AppRole.Mukadam).Should().Be(1, "CEI-I7: Mukadam = 1 is frozen");
        ((int)AppRole.SecondaryOwner).Should().Be(2, "CEI-I7: SecondaryOwner = 2 is frozen");
        ((int)AppRole.PrimaryOwner).Should().Be(3, "CEI-I7: PrimaryOwner = 3 is frozen");
    }

    /// <summary>
    /// CEI-I7b: New CEI Phase 2 values must be present with their specified
    /// underlying integers. The values must never be renumbered in future.
    /// </summary>
    [Fact]
    public void AppRole_NewValues_AreStable()
    {
        ((int)AppRole.Agronomist).Should().Be(4, "CEI §4.7: Agronomist = 4");
        ((int)AppRole.Consultant).Should().Be(5, "CEI §4.7: Consultant = 5");
        ((int)AppRole.FpcTechnicalManager).Should().Be(6, "CEI §4.7: FpcTechnicalManager = 6");
        ((int)AppRole.FieldScout).Should().Be(7, "CEI §4.7: FieldScout = 7");
        ((int)AppRole.LabOperator).Should().Be(8, "CEI §4.7: LabOperator = 8");
    }

    // -------------------------------------------------------------------------
    // Task 1.1.2 — User.Domain mirror parity
    // -------------------------------------------------------------------------

    /// <summary>
    /// CEI-I7c: User.Domain.Membership.AppRole must mirror SharedKernel
    /// value-for-value. The User.Domain enum is the identity layer's copy;
    /// drifting from SharedKernel would cause silent authorization bugs.
    /// </summary>
    [Fact]
    public void UserDomainAppRole_MatchesSharedKernel_ValueForValue()
    {
        var sharedKernelValues = Enum.GetValues<AppRole>();

        foreach (var skValue in sharedKernelValues)
        {
            var name = skValue.ToString();
            var skInt = (int)skValue;

            var parsed = Enum.TryParse(typeof(User.Domain.Membership.AppRole), name, ignoreCase: false, out var userDomainValue);
            parsed.Should().BeTrue(
                $"User.Domain.Membership.AppRole must define '{name}' to mirror SharedKernel — CEI-I7");
            ((int)userDomainValue!).Should().Be(skInt,
                $"User.Domain.Membership.AppRole.{name} must equal SharedKernel AppRole.{name} ({skInt}) — CEI-I7 mirror invariant");
        }
    }
}
