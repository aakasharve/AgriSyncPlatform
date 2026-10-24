using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// R1 Task 2.2 (founder master review 2026-09-02, D5) — जबाबदारी with an end
/// date. Expiry DENIES FORWARD, never rewrites backward: the stored decision
/// and everything done under it keep their history.
/// </summary>
public sealed class LabourGrantExpiryTests
{
    private static readonly DateTime Now = new(2026, 9, 2, 9, 0, 0, DateTimeKind.Utc);

    private static FarmMembership NewMembership() => FarmMembership.Create(
        Guid.NewGuid(),
        new FarmId(Guid.Parse("aa000000-0000-0000-0000-0000000000a1")),
        new UserId(Guid.Parse("33333333-3333-3333-3333-333333333333")),
        AppRole.Worker, Now);

    [Fact]
    public void A_grant_with_a_future_expiry_answers_until_the_moment_and_not_after()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now).Should().BeTrue();

        m.HasEffectiveLabourGrant(Now.AddDays(1)).Should().BeTrue("inside the window");
        m.HasEffectiveLabourGrant(Now.AddDays(2)).Should().BeFalse(
            "जबाबदारी आपोआप संपेल — the boundary instant is already outside");
        m.CanManageLabourRecords.Should().BeTrue(
            "expiry denies FORWARD only; the stored decision is not rewritten");
    }

    [Fact]
    public void A_permanent_grant_has_no_end()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, null, Now);
        m.HasEffectiveLabourGrant(Now.AddYears(10)).Should().BeTrue("कायम");
    }

    [Fact]
    public void A_past_expiry_is_refused_not_stored()
    {
        var m = NewMembership();
        var act = () => m.SetLabourRecordManagement(true, Now.AddMinutes(-1), Now);
        act.Should().Throw<ArgumentException>(
            "an already-expired grant is a switch that looks ON and answers OFF — P5");
        m.CanManageLabourRecords.Should().BeFalse();
    }

    [Fact]
    public void Revoking_clears_the_expiry_so_it_cannot_outlive_the_grant()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(false, Now.AddDays(9), Now).Should().BeTrue();
        m.LabourGrantExpiresAtUtc.Should().BeNull("a revoke has no end date");
    }

    [Fact]
    public void Restating_the_same_grant_and_expiry_is_not_a_change()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now.AddMinutes(5)).Should().BeFalse(
            "a re-sent toggle is not a decision (P3) and must not appear in history as one");
    }

    [Fact]
    public void Moving_only_the_expiry_is_a_real_change()
    {
        var m = NewMembership();
        m.SetLabourRecordManagement(true, Now.AddDays(2), Now);
        m.SetLabourRecordManagement(true, Now.AddDays(5), Now.AddMinutes(5)).Should().BeTrue(
            "3 दिवस instead of आज is a different decision and audits as one");
    }
}
