// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, founder 27 Nov: "send it to server; the phone is only a door")
// The rules of a farm's setup on the server: water sources with their motors (one versioned unit), the power timetable (one document per farm),
// machines, and each plot's water arrangement (method + links, one versioned unit). Every real change bumps the revision ONCE; a change that
// changes nothing changes nothing; an unknown type is refused by name, never mapped to "other".
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

internal static class FarmSetupSamples
{
    internal static readonly FarmId Farm = new(Guid.Parse("d9000000-0000-4000-8000-0000000000a1"));
    internal static readonly UserId Owner = new(Guid.Parse("d9000000-0000-4000-8000-000000000011"));
    internal static readonly UserId Other = new(Guid.Parse("d9000000-0000-4000-8000-000000000012"));
    internal static readonly Guid Source = Guid.Parse("d9000000-0000-4000-8000-0000000000c1");
    internal static readonly Guid Motor1 = Guid.Parse("d9000000-0000-4000-8000-0000000000d1");
    internal static readonly Guid Motor2 = Guid.Parse("d9000000-0000-4000-8000-0000000000d2");
    internal static readonly Guid Plot = Guid.Parse("d9000000-0000-4000-8000-0000000000e1");
    internal static readonly DateTime T0 = new(2026, 11, 27, 6, 0, 0, DateTimeKind.Utc);
    internal static readonly DateTime T1 = new(2026, 11, 27, 7, 0, 0, DateTimeKind.Utc);

    internal static FarmMotorSpec Motor(Guid id, string name = "५ एचपी मोटर", decimal hp = 5m, int phase = 3, string power = "mseb", FarmMotorDripSpec? drip = null) =>
        new(id, name, hp, phase, power, null, drip);

    internal static FarmWaterSourceSpec Well(string name = "मुख्य विहीर", string type = "well", params FarmMotorSpec[] motors) =>
        new(name, type, true, null, motors);

    internal const string Timetable = """
        {"singlePhase":{"patternMode":"FIXED_WEEKLY","alternateWeeklyPattern":false,
          "weekAOffWindows":[{"id":"w1","startTime":"06:00","endTime":"14:00","repeatRule":"WEEKLY","days":["Mon","Tue"]}]},
         "threePhase":{"patternMode":"ROTATIONAL","alternateWeeklyPattern":true,"weekAOffWindows":[],
          "weekBOffWindows":[{"id":"w2","startTime":"22:00","endTime":"05:30","repeatRule":"ALTERNATE_WEEK","days":["Sun"]}]}}
        """;
}

public sealed class FarmWaterSourceTests
{
    [Fact]
    public void A_new_source_starts_at_revision_one_with_its_motors_trimmed_and_active()
    {
        var spec = FarmSetupSamples.Well("  मुख्य विहीर  ", "well", FarmSetupSamples.Motor(FarmSetupSamples.Motor1, "  मोटर १ "));
        Assert.Null(spec.Check());

        var source = FarmWaterSource.Create(FarmSetupSamples.Source, FarmSetupSamples.Farm, spec, FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.Equal(1, source.Revision);
        Assert.Equal("मुख्य विहीर", source.Name);
        Assert.Equal(FarmSetupState.Active, source.State);
        var motor = Assert.Single(source.Motors);
        Assert.Equal("मोटर १", motor.Name);
        Assert.Equal(FarmSetupSamples.Source, motor.WaterSourceId);
        Assert.Equal(FarmSetupSamples.Farm, motor.FarmId);
        Assert.False(motor.HasDrip);
        Assert.True(source.Matches(spec));
    }

    [Fact]
    public void A_change_bumps_the_revision_once()
    {
        var source = FarmWaterSource.Create(
            FarmSetupSamples.Source, FarmSetupSamples.Farm, FarmSetupSamples.Well(motors: FarmSetupSamples.Motor(FarmSetupSamples.Motor1)), FarmSetupSamples.Owner, FarmSetupSamples.T0);

        // One save that renames the source, changes its motor AND adds a second motor: ONE unit, ONE bump.
        var changed = source.Change(
            FarmSetupSamples.Well("नवी विहीर", "borewell",
                FarmSetupSamples.Motor(FarmSetupSamples.Motor1, hp: 7.5m),
                FarmSetupSamples.Motor(FarmSetupSamples.Motor2, drip: new FarmMotorDripSpec("16mm", true, 4m))),
            FarmSetupSamples.Other, FarmSetupSamples.T1, out var removed);

        Assert.True(changed);
        Assert.Equal(2, source.Revision);
        Assert.Empty(removed);
        Assert.Equal("borewell", source.SourceType);
        Assert.Equal(FarmSetupSamples.Other, source.UpdatedByUserId);
        Assert.Equal(FarmSetupSamples.Owner, source.CreatedByUserId);
        Assert.Equal(FarmSetupSamples.T1, source.UpdatedAtUtc);
        Assert.Equal(2, source.Motors.Count(m => m.State == FarmSetupState.Active));
        Assert.Equal(7.5m, source.Motors.Single(m => m.Id == FarmSetupSamples.Motor1).Hp);
        var second = source.Motors.Single(m => m.Id == FarmSetupSamples.Motor2);
        Assert.True(second.HasDrip);
        Assert.Equal("16mm", second.DripPipeSize);
        Assert.Equal(true, second.DripHasFilter);
        Assert.Equal(4m, second.DripFlowLph);
    }

    [Fact]
    public void The_same_content_again_changes_nothing()
    {
        var spec = FarmSetupSamples.Well(motors: FarmSetupSamples.Motor(FarmSetupSamples.Motor1));
        var source = FarmWaterSource.Create(FarmSetupSamples.Source, FarmSetupSamples.Farm, spec, FarmSetupSamples.Owner, FarmSetupSamples.T0);

        var changed = source.Change(spec, FarmSetupSamples.Other, FarmSetupSamples.T1, out var removed);

        Assert.False(changed);
        Assert.Equal(1, source.Revision);
        Assert.Empty(removed);
        Assert.Equal(FarmSetupSamples.Owner, source.UpdatedByUserId);
        Assert.Equal(FarmSetupSamples.T0, source.UpdatedAtUtc);
    }

    [Fact]
    public void A_motor_left_out_of_the_list_is_removed_never_deleted_and_is_named()
    {
        var source = FarmWaterSource.Create(
            FarmSetupSamples.Source, FarmSetupSamples.Farm,
            FarmSetupSamples.Well(motors: [FarmSetupSamples.Motor(FarmSetupSamples.Motor1), FarmSetupSamples.Motor(FarmSetupSamples.Motor2)]),
            FarmSetupSamples.Owner, FarmSetupSamples.T0);

        var changed = source.Change(FarmSetupSamples.Well(motors: FarmSetupSamples.Motor(FarmSetupSamples.Motor1)), FarmSetupSamples.Owner, FarmSetupSamples.T1, out var removed);

        Assert.True(changed);
        Assert.Equal(2, source.Revision);
        Assert.Equal([FarmSetupSamples.Motor2], removed);
        Assert.Equal(2, source.Motors.Count);
        Assert.Equal(FarmSetupState.Removed, source.Motors.Single(m => m.Id == FarmSetupSamples.Motor2).State);
    }

    [Fact]
    public void Removing_a_source_removes_its_motors_once_and_a_second_removal_changes_nothing()
    {
        var source = FarmWaterSource.Create(
            FarmSetupSamples.Source, FarmSetupSamples.Farm, FarmSetupSamples.Well(motors: FarmSetupSamples.Motor(FarmSetupSamples.Motor1)), FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.True(source.Remove(FarmSetupSamples.Owner, FarmSetupSamples.T1, out var removed));
        Assert.Equal(2, source.Revision);
        Assert.Equal(FarmSetupState.Removed, source.State);
        Assert.Equal([FarmSetupSamples.Motor1], removed);
        Assert.All(source.Motors, m => Assert.Equal(FarmSetupState.Removed, m.State));

        Assert.False(source.Remove(FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(1), out var again));
        Assert.Equal(2, source.Revision);
        Assert.Empty(again);
    }

    [Theory]
    [InlineData("", "well", "FarmWaterSourceName")]
    [InlineData("   ", "well", "FarmWaterSourceName")]
    [InlineData("विहीर", "river", "FarmWaterSourceType")]
    [InlineData("विहीर", "Well", "FarmWaterSourceType")]
    [InlineData("विहीर", "other", "FarmWaterSourceType")]
    public void An_empty_name_or_an_unknown_type_is_refused_by_name(string name, string type, string code)
    {
        var problem = FarmSetupSamples.Well(name, type).Check();

        Assert.NotNull(problem);
        Assert.Equal(code, problem!.Code);
        Assert.Throws<ArgumentException>(() =>
            FarmWaterSource.Create(FarmSetupSamples.Source, FarmSetupSamples.Farm, FarmSetupSamples.Well(name, type), FarmSetupSamples.Owner, FarmSetupSamples.T0));
    }

    [Fact]
    public void A_motor_that_does_not_hold_together_is_refused_by_name()
    {
        static string? CodeOf(FarmMotorSpec motor) => FarmSetupSamples.Well(motors: motor).Check()?.Code;

        Assert.Equal("FarmMotorPhase", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, phase: 2)));
        Assert.Equal("FarmMotorHp", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, hp: 0m)));
        Assert.Equal("FarmMotorHp", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, hp: 500.01m)));
        Assert.Equal("FarmMotorHp", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, hp: 5.123m)));
        Assert.Equal("FarmMotorPowerSource", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, power: "wind")));
        Assert.Equal("FarmMotorName", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, name: " ")));
        Assert.Equal("FarmMotorId", CodeOf(FarmSetupSamples.Motor(Guid.Empty)));
        Assert.Equal("FarmMotorDrip", CodeOf(FarmSetupSamples.Motor(FarmSetupSamples.Motor1, drip: new FarmMotorDripSpec(null, false, 0m))));
        Assert.Equal("FarmMotorId", FarmSetupSamples.Well(motors: [FarmSetupSamples.Motor(FarmSetupSamples.Motor1), FarmSetupSamples.Motor(FarmSetupSamples.Motor1)]).Check()?.Code);
        Assert.Equal("FarmMotorCount", FarmSetupSamples.Well(motors: Enumerable.Range(0, 13).Select(_ => FarmSetupSamples.Motor(Guid.NewGuid())).ToArray()).Check()?.Code);
        Assert.Null(FarmSetupSamples.Well(motors: Enumerable.Range(0, 12).Select(_ => FarmSetupSamples.Motor(Guid.NewGuid())).ToArray()).Check());
    }
}

public sealed class FarmPowerTimesTests
{
    [Fact]
    public void A_timetable_is_read_strictly_and_kept_in_one_canonical_form()
    {
        Assert.True(PowerTimetable.TryParse(FarmSetupSamples.Timetable, out var timetable, out var problem));
        Assert.Null(problem);
        Assert.Matches("^[0-9a-f]{64}$", timetable!.ContentHash);

        // The same timetable with its keys in another order and other white space is the SAME document.
        const string reordered = """
            {"threePhase":{"weekBOffWindows":[{"days":["Sun"],"repeatRule":"ALTERNATE_WEEK","endTime":"05:30","startTime":"22:00","id":"w2"}],
                           "weekAOffWindows":[],"alternateWeeklyPattern":true,"patternMode":"ROTATIONAL"},
             "singlePhase":{"weekAOffWindows":[{"id":"w1","startTime":"06:00","endTime":"14:00","repeatRule":"WEEKLY","days":["Mon","Tue"]}],
                            "alternateWeeklyPattern":false,"patternMode":"FIXED_WEEKLY"}}
            """;
        Assert.True(PowerTimetable.TryParse(reordered, out var same, out _));
        Assert.Equal(timetable.ContentHash, same!.ContentHash);
        Assert.Equal(timetable.CanonicalJson, same.CanonicalJson);
        Assert.StartsWith("{\"singlePhase\":{\"patternMode\":\"FIXED_WEEKLY\",\"alternateWeeklyPattern\":false,\"weekAOffWindows\":[{\"id\":\"w1\",\"startTime\":\"06:00\"", timetable.CanonicalJson);
    }

    [Theory]
    [InlineData("\"startTime\":\"06:00\"", "\"startTime\":\"6:00\"", "PowerTimesTime")]
    [InlineData("\"startTime\":\"06:00\"", "\"startTime\":\"24:00\"", "PowerTimesTime")]
    [InlineData("\"endTime\":\"14:00\"", "\"endTime\":\"14:60\"", "PowerTimesTime")]
    [InlineData("[\"Mon\",\"Tue\"]", "[\"Mon\",\"Funday\"]", "PowerTimesDay")]
    [InlineData("\"repeatRule\":\"WEEKLY\"", "\"repeatRule\":\"MONTHLY\"", "PowerTimesRepeatRule")]
    [InlineData("\"patternMode\":\"FIXED_WEEKLY\"", "\"patternMode\":\"SOMETIMES\"", "PowerTimesPattern")]
    [InlineData("\"alternateWeeklyPattern\":false", "\"alternateWeeklyPattern\":false,\"colour\":\"red\"", "PowerTimesUnknownKey")]
    [InlineData("\"id\":\"w1\",", "", "PowerTimesWindow")]
    public void A_bad_part_of_a_timetable_is_refused_by_name(string find, string replace, string code)
    {
        Assert.Contains(find, FarmSetupSamples.Timetable);
        var bad = FarmSetupSamples.Timetable.Replace(find, replace);

        Assert.False(PowerTimetable.TryParse(bad, out var timetable, out var problem));
        Assert.Null(timetable);
        Assert.Equal(code, problem!.Code);
    }

    [Fact]
    public void More_than_twelve_windows_in_a_week_or_a_missing_phase_is_refused()
    {
        var window = "{\"id\":\"w\",\"startTime\":\"01:00\",\"endTime\":\"02:00\",\"repeatRule\":\"DAILY\",\"days\":[]}";
        string Phase(int windows) => "{\"patternMode\":\"CUSTOM_DAILY\",\"alternateWeeklyPattern\":false,\"weekAOffWindows\":[" + string.Join(",", Enumerable.Repeat(window, windows)) + "]}";

        Assert.True(PowerTimetable.TryParse("{\"singlePhase\":" + Phase(12) + ",\"threePhase\":" + Phase(0) + "}", out _, out _));
        Assert.False(PowerTimetable.TryParse("{\"singlePhase\":" + Phase(13) + ",\"threePhase\":" + Phase(0) + "}", out _, out var tooMany));
        Assert.Equal("PowerTimesWindowCount", tooMany!.Code);
        Assert.False(PowerTimetable.TryParse("{\"singlePhase\":" + Phase(1) + "}", out _, out var missing));
        Assert.Equal("PowerTimesPhase", missing!.Code);
        Assert.False(PowerTimetable.TryParse("not json", out _, out var notJson));
        Assert.Equal("PowerTimesShape", notJson!.Code);
        Assert.False(PowerTimetable.TryParse("[]", out _, out var notObject));
        Assert.Equal("PowerTimesShape", notObject!.Code);
    }

    [Fact]
    public void A_farms_timetable_bumps_its_revision_once_per_real_change()
    {
        Assert.True(PowerTimetable.TryParse(FarmSetupSamples.Timetable, out var first, out _));
        Assert.True(PowerTimetable.TryParse(FarmSetupSamples.Timetable.Replace("06:00", "07:00"), out var second, out _));

        var times = FarmPowerTimes.Create(FarmSetupSamples.Farm, first!, FarmSetupSamples.Owner, FarmSetupSamples.T0);
        Assert.Equal(1, times.Revision);
        Assert.Equal(FarmSetupSamples.Farm.Value, times.Id);

        Assert.False(times.Change(first!, FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(1, times.Revision);
        Assert.Equal(FarmSetupSamples.Owner, times.UpdatedByUserId);

        Assert.True(times.Change(second!, FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(2, times.Revision);
        Assert.Equal(second!.ContentHash, times.ContentHash);
        Assert.Equal(FarmSetupSamples.Other, times.UpdatedByUserId);
    }
}

public sealed class FarmMachineTests
{
    private static readonly Guid Machine = Guid.Parse("d9000000-0000-4000-8000-0000000000f1");

    private static FarmMachineSpec Spec(string name = "ट्रॅक्टर", string type = "tractor", string ownership = "owned", decimal? hp = null, int? nozzles = null, decimal? tank = null) =>
        new(name, type, ownership, null, null, hp, nozzles, tank, null);

    [Fact]
    public void A_machine_holds_together_with_the_name_alone_and_optional_details_stay_unknown()
    {
        var spec = Spec("  महिंद्रा  ");
        Assert.Null(spec.Check());

        var machine = FarmMachine.Create(Machine, FarmSetupSamples.Farm, spec, FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.Equal("महिंद्रा", machine.Name);
        Assert.Equal(1, machine.Revision);
        Assert.Null(machine.Company);
        Assert.Null(machine.Hp);
        Assert.Null(machine.NozzleCount);
        Assert.Null(machine.TankLitres);
        Assert.Null(machine.DetailLine);
    }

    [Fact]
    public void An_edit_bumps_once_the_same_again_does_not_and_a_removal_is_a_state()
    {
        var machine = FarmMachine.Create(Machine, FarmSetupSamples.Farm, Spec(), FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.True(machine.Change(Spec(type: "blower", nozzles: 12, tank: 600m), FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(2, machine.Revision);
        Assert.Equal("blower", machine.MachineType);
        Assert.Equal((short)12, machine.NozzleCount);

        Assert.False(machine.Change(Spec(type: "blower", nozzles: 12, tank: 600m), FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(1)));
        Assert.Equal(2, machine.Revision);

        Assert.True(machine.Remove(FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(2)));
        Assert.Equal(3, machine.Revision);
        Assert.Equal(FarmSetupState.Removed, machine.State);
        Assert.False(machine.Remove(FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(3)));
        Assert.Equal(3, machine.Revision);
    }

    [Theory]
    [InlineData(" ", "tractor", "owned", "FarmMachineName")]
    [InlineData("यंत्र", "drone", "owned", "FarmMachineType")]
    [InlineData("यंत्र", "Tractor", "owned", "FarmMachineType")]
    [InlineData("यंत्र", "tractor", "borrowed", "FarmMachineOwnership")]
    public void An_unknown_type_or_ownership_is_refused_never_mapped_to_other(string name, string type, string ownership, string code)
    {
        Assert.Equal(code, Spec(name, type, ownership).Check()?.Code);
        Assert.Throws<ArgumentException>(() => FarmMachine.Create(Machine, FarmSetupSamples.Farm, Spec(name, type, ownership), FarmSetupSamples.Owner, FarmSetupSamples.T0));
    }

    [Fact]
    public void A_detail_that_is_not_a_real_quantity_is_refused()
    {
        Assert.Equal("FarmMachineHp", Spec(hp: 0m).Check()?.Code);
        Assert.Equal("FarmMachineNozzles", Spec(nozzles: 0).Check()?.Code);
        Assert.Equal("FarmMachineTank", Spec(tank: -1m).Check()?.Code);
        Assert.Equal("FarmMachineTank", Spec(tank: 10.123m).Check()?.Code);
    }
}

public sealed class PlotWaterSetupTests
{
    private static PlotWaterSpec Spec(string method, params PlotWaterLinkSpec[] links) => new(method, links);

    [Fact]
    public void A_plot_may_be_saved_with_a_method_and_no_link()
    {
        var spec = Spec("drip");
        Assert.Null(spec.Check());

        var setup = PlotWaterSetup.Create(FarmSetupSamples.Plot, FarmSetupSamples.Farm, spec, FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.Equal(1, setup.Revision);
        Assert.Equal("drip", setup.Method);
        Assert.Empty(setup.Links);
        Assert.Equal(FarmSetupSamples.Plot, setup.Id);
    }

    [Fact]
    public void The_method_and_the_links_are_one_unit_and_a_link_id_is_the_same_on_every_phone()
    {
        var gravity = new PlotWaterLinkSpec(FarmSetupSamples.Source, null);
        var pumped = new PlotWaterLinkSpec(FarmSetupSamples.Source, FarmSetupSamples.Motor1);
        var setup = PlotWaterSetup.Create(FarmSetupSamples.Plot, FarmSetupSamples.Farm, Spec("flood", gravity), FarmSetupSamples.Owner, FarmSetupSamples.T0);
        Assert.Equal(PlotWaterLink.IdFor(FarmSetupSamples.Plot, FarmSetupSamples.Source, null), Assert.Single(setup.Links).Id);
        Assert.NotEqual(PlotWaterLink.IdFor(FarmSetupSamples.Plot, FarmSetupSamples.Source, null), PlotWaterLink.IdFor(FarmSetupSamples.Plot, FarmSetupSamples.Source, FarmSetupSamples.Motor1));

        // The method changes AND a link is swapped in one save: one bump.
        Assert.True(setup.Set(Spec("drip", pumped), FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(2, setup.Revision);
        Assert.Equal(FarmSetupState.Removed, setup.Links.Single(l => l.MotorId is null).State);
        Assert.Equal(FarmSetupState.Active, setup.Links.Single(l => l.MotorId == FarmSetupSamples.Motor1).State);

        Assert.False(setup.Set(Spec("drip", pumped), FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(1)));
        Assert.Equal(2, setup.Revision);
        Assert.True(setup.Matches(Spec("drip", pumped)));

        // A removed link put back is the same row made active again.
        Assert.True(setup.Set(Spec("drip", pumped, gravity), FarmSetupSamples.Owner, FarmSetupSamples.T1.AddHours(2)));
        Assert.Equal(3, setup.Revision);
        Assert.Equal(2, setup.Links.Count);
        Assert.All(setup.Links, l => Assert.Equal(FarmSetupState.Active, l.State));
    }

    [Fact]
    public void Dropping_the_links_of_a_removed_motor_leaves_the_plots_answer_and_bumps_once()
    {
        var setup = PlotWaterSetup.Create(
            FarmSetupSamples.Plot, FarmSetupSamples.Farm,
            Spec("drip", new PlotWaterLinkSpec(FarmSetupSamples.Source, FarmSetupSamples.Motor1), new PlotWaterLinkSpec(FarmSetupSamples.Source, FarmSetupSamples.Motor2)),
            FarmSetupSamples.Owner, FarmSetupSamples.T0);

        Assert.True(setup.DropLinksToMotors([FarmSetupSamples.Motor1], FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(2, setup.Revision);
        Assert.Equal("drip", setup.Method);
        Assert.Equal(FarmSetupSamples.Motor2, Assert.Single(setup.Links, l => l.State == FarmSetupState.Active).MotorId);

        Assert.False(setup.DropLinksToMotors([FarmSetupSamples.Motor1], FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.True(setup.DropLinksToSource(FarmSetupSamples.Source, FarmSetupSamples.Other, FarmSetupSamples.T1));
        Assert.Equal(3, setup.Revision);
        Assert.DoesNotContain(setup.Links, l => l.State == FarmSetupState.Active);
    }

    [Fact]
    public void An_arrangement_that_does_not_hold_together_is_refused_by_name()
    {
        var link = new PlotWaterLinkSpec(FarmSetupSamples.Source, FarmSetupSamples.Motor1);
        Assert.Equal("PlotWaterMethod", Spec("mist").Check()?.Code);
        Assert.Equal("PlotWaterMethod", Spec("Drip").Check()?.Code);
        Assert.Equal("PlotWaterLink", Spec("drip", link, link).Check()?.Code);
        Assert.Equal("PlotWaterLink", Spec("drip", new PlotWaterLinkSpec(Guid.Empty, null)).Check()?.Code);
        // "पाण्याची सोय नाही" and a source ticked are two different facts, never mixed (P4).
        Assert.Equal("PlotWaterNoneWithLinks", Spec("none", link).Check()?.Code);
        Assert.Null(Spec("none").Check());
        Assert.Equal("PlotWaterLinkCount", Spec("drip", Enumerable.Range(0, 25).Select(_ => new PlotWaterLinkSpec(Guid.NewGuid(), null)).ToArray()).Check()?.Code);
    }
}
