using FluentAssertions;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

public sealed class ControlRoomTicksTests
{
    private static IReadOnlyList<string> Readable(IEnumerable<string> ticks) =>
        ControlRoomTicks.ModulesFor(ticks).Where(e => e.CanRead).Select(e => e.ModuleKey).ToList();

    [Fact]
    public void No_ticks_opens_only_admin_self()
    {
        var result = ControlRoomTicks.ModulesFor([]);

        result.Select(e => e.ModuleKey).Should().Equal(ModuleKey.All);
        result.Where(e => e.CanRead).Select(e => e.ModuleKey).Should().Equal(ModuleKey.AdminSelf);
        result.Should().OnlyContain(e => !e.CanExport && !e.CanWrite);
    }

    [Fact]
    public void Farms_to_call_opens_silent_churn_and_suffering_and_nothing_else()
    {
        Readable([ControlRoomTicks.FarmsToCall]).Should()
            .BeEquivalentTo([ModuleKey.AdminSelf, ModuleKey.FarmsSilentChurn, ModuleKey.FarmsSuffering]);
        ControlRoomTicks.ModulesFor([ControlRoomTicks.FarmsToCall]).Should().OnlyContain(e => !e.CanWrite);
    }

    [Fact]
    public void Schedules_tick_reads_and_writes_the_schedule_check()
    {
        var e = ControlRoomTicks.ModulesFor([ControlRoomTicks.Schedules]).Single(x => x.ModuleKey == ModuleKey.ScheduleReview);
        e.CanRead.Should().BeTrue();
        e.CanWrite.Should().BeTrue();
    }

    [Fact]
    public void Give_visits_writes_visits_assign_and_my_visits_writes_visits_mine()
    {
        var give = ControlRoomTicks.ModulesFor([ControlRoomTicks.GiveVisits]);
        give.Where(e => e.CanWrite).Select(e => e.ModuleKey).Should().Equal(ModuleKey.VisitsAssign);
        give.Single(e => e.ModuleKey == ModuleKey.VisitsMine).CanRead.Should().BeFalse();

        var mine = ControlRoomTicks.ModulesFor([ControlRoomTicks.MyVisits]);
        mine.Where(e => e.CanWrite).Select(e => e.ModuleKey).Should().Equal(ModuleKey.VisitsMine);
        mine.Single(e => e.ModuleKey == ModuleKey.VisitsAssign).CanRead.Should().BeFalse();
    }

    [Fact]
    public void Unknown_ticks_open_nothing()
    {
        Readable(["people_and_access", "bogus"]).Should().Equal(ModuleKey.AdminSelf);
    }

    [Fact]
    public void No_tick_grants_export_the_audit_ledger_or_an_organisation_write()
    {
        var all = ControlRoomTicks.ModulesFor(ControlRoomTicks.All.Select(t => t.Key));

        all.Should().OnlyContain(e => !e.CanExport);
        foreach (var key in new[] { ModuleKey.AuditLedger, ModuleKey.AdminOrgsWrite, ModuleKey.AdminOrgsRead,
                     ModuleKey.OrgSettings, ModuleKey.OrgMembers, ModuleKey.OrgFarmScope })
        {
            var e = all.Single(x => x.ModuleKey == key);
            e.CanRead.Should().BeFalse(key);
            e.CanWrite.Should().BeFalse(key);
        }
    }

    [Fact]
    public void Presets_match_the_approved_design()
    {
        ControlRoomRoles.PresetTicks(ControlRoomRole.Admin).Should().Equal(
            ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth, ControlRoomTicks.ApiErrors,
            ControlRoomTicks.AllFarms, ControlRoomTicks.FarmsToCall, ControlRoomTicks.FarmerHealth,
            ControlRoomTicks.Schedules, ControlRoomTicks.Users,
            ControlRoomTicks.FarmerPhones, ControlRoomTicks.Downloads, ControlRoomTicks.GiveVisits);
        ControlRoomRoles.PresetTicks(ControlRoomRole.FieldOperator).Should().Equal(
            ControlRoomTicks.MyVisits, ControlRoomTicks.FarmerPhones, ControlRoomTicks.Downloads);
        ControlRoomRoles.PresetTicks(ControlRoomRole.Viewer).Should().Equal(
            ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth);

        foreach (var role in Enum.GetValues<ControlRoomRole>())
            ControlRoomRoles.PresetTicks(role).Should().OnlyContain(t => ControlRoomTicks.IsKnown(t));
    }

    [Fact]
    public void Role_keys_round_trip_and_are_lower_case_only()
    {
        foreach (var role in Enum.GetValues<ControlRoomRole>())
        {
            ControlRoomRoles.TryParse(ControlRoomRoles.Key(role), out var back).Should().BeTrue();
            back.Should().Be(role);
        }
        ControlRoomRoles.Key(ControlRoomRole.FieldOperator).Should().Be("field_operator");
    }

    [Fact]
    public void Founder_is_not_a_starting_role()
    {
        ControlRoomRoles.TryParse("founder", out _).Should().BeFalse();
        ControlRoomRoles.TryParse("Admin", out _).Should().BeFalse();
        ControlRoomRoles.TryParse(null, out _).Should().BeFalse();
        ControlRoomRoles.TryParse("", out _).Should().BeFalse();
    }

    [Fact]
    public void Only_phones_and_downloads_are_personal_data()
    {
        ControlRoomTicks.All.Where(t => t.IsPersonalData).Select(t => t.Key)
            .Should().BeEquivalentTo([ControlRoomTicks.FarmerPhones, ControlRoomTicks.Downloads]);
    }

    [Fact]
    public void Every_tick_opens_only_known_module_keys_and_keys_are_unique()
    {
        ControlRoomTicks.All.Select(t => t.Key).Should().OnlyHaveUniqueItems();
        foreach (var t in ControlRoomTicks.All)
            t.ReadModules.Concat(t.WriteModules).Should().OnlyContain(k => ModuleKey.All.Contains(k));
    }
}
