// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, "The switch"; doctrine P5, P10, P11).
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Sync;

/// <summary>
/// The farm-scoped switch <c>schedule_mechanism</c>, answered from the existing <see cref="FeatureFlag"/> row. The rules:
/// no row, a disabled row, and an enabled row that names nobody all read OFF (fail closed: switching a row on without
/// saying for whom must never light every farm); an enabled row lights the farms its cohort lists, or every farm for
/// <c>all</c>. The PUSH half: a reserved set of NEW mutation names is refused for a farm the switch is off for, and a
/// reserved name whose farm cannot be read is refused too (fail closed).
/// </summary>
public sealed class ScheduleMechanismSwitchTests
{
    private static readonly Guid FarmOne = Guid.Parse("5c100001-0000-4000-8000-000000000001");
    private static readonly Guid FarmTwo = Guid.Parse("5c100001-0000-4000-8000-000000000002");
    private static readonly Guid FarmThree = Guid.Parse("5c100001-0000-4000-8000-000000000003");
    private const string Probe = "schedule.mechanism.probe";

    private static FeatureFlag Flag(bool enabled, string? cohort) =>
        FeatureFlag.Create(Guid.NewGuid(), ScheduleMechanismSwitch.FlagName, enabled, cohort, null, DateTime.UtcNow, "test");

    private static ScheduleMechanismSwitch SwitchOver(FeatureFlag? flag, params string[] reserved) =>
        ScheduleMechanismSwitch.WithReservedNames(new FlagRepo(flag), reserved);

    private static JsonElement Payload(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void The_flag_is_named_schedule_mechanism()
    {
        ScheduleMechanismSwitch.FlagName.Should().Be("schedule_mechanism");
    }

    [Fact]
    public void No_row_reads_off_for_every_farm()
    {
        ScheduleMechanismSwitch.Admits(null, FarmOne).Should().BeFalse();
        ScheduleMechanismSwitch.Admits(null, Guid.Empty).Should().BeFalse();
    }

    [Theory]
    [InlineData("all")]
    [InlineData("5c100001-0000-4000-8000-000000000001")]
    [InlineData(null)]
    public void A_disabled_row_reads_off_whatever_its_cohort_says(string? cohort)
    {
        ScheduleMechanismSwitch.Admits(Flag(enabled: false, cohort), FarmOne).Should().BeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("founder")]
    [InlineData("founder|pilot-5")]
    public void An_enabled_row_that_names_no_farm_reads_off_for_everyone(string? cohort)
    {
        ScheduleMechanismSwitch.Admits(Flag(enabled: true, cohort), FarmOne).Should().BeFalse(
            "fail closed: enabling a row without saying for whom does not turn the mechanism on anywhere");
    }

    [Theory]
    [InlineData("all")]
    [InlineData("ALL")]
    [InlineData(" all ")]
    [InlineData("founder|all")]
    public void An_enabled_row_with_all_lights_every_farm(string cohort)
    {
        var flag = Flag(enabled: true, cohort);
        ScheduleMechanismSwitch.Admits(flag, FarmOne).Should().BeTrue();
        ScheduleMechanismSwitch.Admits(flag, FarmTwo).Should().BeTrue();
        ScheduleMechanismSwitch.Admits(flag, Guid.Empty).Should().BeFalse("no farm is never a farm that is on");
    }

    [Fact]
    public void An_enabled_row_lights_only_the_farms_it_lists_in_either_guid_spelling()
    {
        var flag = Flag(enabled: true, $"{FarmOne}| {FarmTwo:N} |founder|not-a-guid");

        ScheduleMechanismSwitch.Admits(flag, FarmOne).Should().BeTrue();
        ScheduleMechanismSwitch.Admits(flag, FarmTwo).Should().BeTrue("the 32-character spelling is read too (more farms fit in 256 characters)");
        ScheduleMechanismSwitch.Admits(flag, FarmThree).Should().BeFalse();
    }

    [Fact]
    public async Task One_read_answers_which_of_many_farms_are_on_in_a_stable_order()
    {
        var sw = SwitchOver(Flag(enabled: true, $"{FarmTwo}|{FarmOne}"));

        var on = await sw.OnFarmsAsync([FarmThree, FarmTwo, FarmOne, FarmTwo, Guid.Empty]);

        on.Should().Equal(FarmOne, FarmTwo);
        (await SwitchOver(null).OnFarmsAsync([FarmOne, FarmTwo])).Should().BeEmpty();
        (await sw.IsOnForFarmAsync(FarmOne)).Should().BeTrue();
        (await sw.IsOnForFarmAsync(FarmThree)).Should().BeFalse();
    }

    // ---- the push half --------------------------------------------------------------------------------

    [Fact]
    public async Task A_name_that_is_not_reserved_is_never_asked_about_the_switch()
    {
        // Strict repo: reading the flag would throw. Every mutation that exists today must cost no read at all.
        var sw = ScheduleMechanismSwitch.WithReservedNames(new ThrowingRepo(), [Probe]);

        (await sw.RefusalForPushAsync("create_daily_log", Payload($$"""{"farmId":"{{FarmOne}}"}"""))).Should().BeNull();
        (await sw.RefusalForPushAsync("adopt_schedule", Payload("{}"))).Should().BeNull();
    }

    [Fact]
    public async Task The_shipped_reserved_set_refuses_nothing_that_exists_today()
    {
        // Slice 1 shipped the gate with its set empty; slice 3 reserves its three own-schedule names. Every OTHER name of the catalog is refused by nothing
        // here and costs no read of the flag (the repository throws if it is read).
        var sw = new ScheduleMechanismSwitch(new ThrowingRepo());
        ScheduleMechanismSwitch.ReservedMutationNames.Should().BeEquivalentTo(
            ["ownschedule.item.save", "ownschedule.item.remove", "ownschedule.make_main", "ownschedule.item.plan", "schedule.task_event", "schedule.take_task", "ownschedule.carry_forward"]);

        foreach (var name in SyncMutationCatalog.Names.Where(n => !ScheduleMechanismSwitch.ReservedMutationNames.Contains(n)))
        {
            (await sw.RefusalForPushAsync(name, Payload($$"""{"farmId":"{{FarmOne}}"}"""))).Should().BeNull($"{name} is an existing mutation");
        }
    }

    [Fact]
    public async Task The_three_own_schedule_names_are_refused_when_no_switch_row_exists()
    {
        // spec: plr-d10 schedule slice 3 - with the switch off (no row) every reserved name is refused, for any farm.
        var sw = new ScheduleMechanismSwitch(new FlagRepo(null));
        foreach (var name in ScheduleMechanismSwitch.ReservedMutationNames)
        {
            (await sw.RefusalForPushAsync(name, Payload($$"""{"farmId":"{{FarmOne}}"}""")))!.Code.Should().Be("ShramSafal.ScheduleMechanismOff", name);
        }
    }

    [Fact]
    public async Task A_reserved_name_is_refused_for_a_farm_the_switch_is_off_for()
    {
        var sw = SwitchOver(Flag(enabled: true, FarmOne.ToString()), Probe);

        var refusal = await sw.RefusalForPushAsync(Probe, Payload($$"""{"farmId":"{{FarmTwo}}"}"""));

        refusal.Should().NotBeNull();
        refusal!.Code.Should().Be("ShramSafal.ScheduleMechanismOff");
    }

    [Fact]
    public async Task A_reserved_name_passes_for_a_farm_the_switch_is_on_for()
    {
        var sw = SwitchOver(Flag(enabled: true, FarmOne.ToString()), Probe);

        (await sw.RefusalForPushAsync(Probe, Payload($$"""{"farmId":"{{FarmOne}}"}"""))).Should().BeNull();
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"farmId":"not-a-guid"}""")]
    [InlineData("""{"farmId":12}""")]
    [InlineData("""{"farmId":"00000000-0000-0000-0000-000000000000"}""")]
    [InlineData("[]")]
    [InlineData("null")]
    public async Task A_reserved_name_whose_farm_cannot_be_read_is_refused_even_when_the_switch_is_on_everywhere(string payload)
    {
        var sw = SwitchOver(Flag(enabled: true, "all"), Probe);

        var refusal = await sw.RefusalForPushAsync(Probe, Payload(payload));

        refusal.Should().NotBeNull("fail closed: with no readable farm the switch cannot be shown to be on");
        refusal!.Code.Should().Be("ShramSafal.ScheduleMechanismOff");
    }

    [Fact]
    public async Task The_farm_is_read_without_regard_to_the_case_of_the_key_as_the_handlers_read_it()
    {
        var sw = SwitchOver(Flag(enabled: true, FarmOne.ToString()), Probe);

        (await sw.RefusalForPushAsync(Probe, Payload($$"""{"FarmId":"{{FarmOne}}"}"""))).Should().BeNull();
        (await sw.RefusalForPushAsync(Probe, Payload($$"""{"FARMID":"{{FarmTwo}}"}"""))).Should().NotBeNull();
    }

    [Theory]
    [InlineData("""{"farmId":"5c100001-0000-4000-8000-000000000001","FarmId":"5c100001-0000-4000-8000-000000000002"}""")]
    [InlineData("""{"FarmId":"5c100001-0000-4000-8000-000000000002","farmId":"5c100001-0000-4000-8000-000000000001"}""")]
    [InlineData("""{"farmId":"5c100001-0000-4000-8000-000000000001","farmId":"5c100001-0000-4000-8000-000000000002"}""")]
    [InlineData("""{"farmId":"5c100001-0000-4000-8000-000000000001","FarmId":"5c100001-0000-4000-8000-000000000001"}""")]
    public async Task A_payload_that_names_the_farm_twice_is_refused_so_the_gate_and_the_handler_can_never_see_two_farms(string payload)
    {
        // Farm one is on. A body that shows the gate farm one and the handler farm two (the handler reads keys without case, and the
        // last one would win) must not get through; so any body that names the farm more than once names none.
        var sw = SwitchOver(Flag(enabled: true, FarmOne.ToString()), Probe);

        var refusal = await sw.RefusalForPushAsync(Probe, Payload(payload));

        refusal.Should().NotBeNull();
        refusal!.Code.Should().Be("ShramSafal.ScheduleMechanismOff");
    }

    [Fact]
    public async Task With_no_row_a_reserved_name_is_refused_for_every_farm()
    {
        var sw = SwitchOver(null, Probe);

        (await sw.RefusalForPushAsync(Probe, Payload($$"""{"farmId":"{{FarmOne}}"}"""))).Should().NotBeNull();
    }

    [Fact]
    public void Every_reserved_name_is_a_new_catalog_name_never_a_released_one()
    {
        // The strict push rule: new mutation names only, never a new key in an old payload. A name released with 1.0.17 or earlier
        // cannot be gated (an old phone sends it) and must not be reserved. Empty in slice 1, so this checks nothing yet; it starts
        // checking the moment slice 2 fills the set.
        foreach (var name in ScheduleMechanismSwitch.ReservedMutationNames)
        {
            var descriptor = SyncMutationCatalog.All.SingleOrDefault(m => m.Name == name);
            descriptor.Should().NotBeNull($"{name} must be registered in both SyncMutationCatalog files and mutation-types.json");
            Version.Parse(descriptor!.SinceVersion).Should().BeGreaterThanOrEqualTo(new Version(1, 0, 18),
                $"{name} must be new: 1.0.17 is the release in the field");
        }
    }

    // ---- the pull's query ------------------------------------------------------------------------------

    [Theory]
    [InlineData("2", 2)]
    [InlineData(" 2 ", 2)]
    [InlineData("3", 3)]
    [InlineData("1", 1)]
    [InlineData("0", null)]
    [InlineData("-1", null)]
    [InlineData("abc", null)]
    [InlineData("2.5", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("99999999999", null)]
    public void The_scheduleFormat_query_is_read_leniently_and_an_unreadable_one_says_nothing(string? raw, int? expected)
    {
        PullSyncChangesQuery.ParseScheduleFormat(raw).Should().Be(expected);
    }

    [Fact]
    public void A_pull_query_without_scheduleFormat_is_what_every_existing_caller_builds()
    {
        var query = new PullSyncChangesQuery(DateTime.UnixEpoch, Guid.NewGuid());

        query.ScheduleFormat.Should().BeNull("an older phone sends none");
        new PullSyncChangesQuery(DateTime.UnixEpoch, Guid.NewGuid(), null, 2).ScheduleFormat.Should().Be(2);
    }

    // ---- doubles --------------------------------------------------------------------------------------

    private sealed class FlagRepo(FeatureFlag? flag) : FakeShramSafalRepository, IShramSafalRepository
    {
        public Task<FeatureFlag?> GetFeatureFlagAsync(string flagName, CancellationToken ct = default) =>
            Task.FromResult(flagName == ScheduleMechanismSwitch.FlagName ? flag : null);
    }

    private sealed class ThrowingRepo : FakeShramSafalRepository, IShramSafalRepository
    {
        public Task<FeatureFlag?> GetFeatureFlagAsync(string flagName, CancellationToken ct = default) =>
            throw new InvalidOperationException("the flag must not be read for a name that is not reserved");
    }
}
