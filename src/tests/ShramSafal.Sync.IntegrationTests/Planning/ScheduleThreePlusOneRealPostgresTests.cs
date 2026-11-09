// spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-3 ("3 + 1 schedules per plot"; founder D-74, register R6).
//
// A plot-season follows up to 3 OUTSIDE schedules plus 1 of his own, each in its own place (slot). Migration
// 20261109090000_AllowThreePlusOneSchedulesPerPlot gives the table a `slot`, back-fills it, and replaces the one-active index (I-14) with two
// partial unique indexes, so the database itself holds 3 + 1. This suite proves, on real Postgres as agrisync_app (E3 first, in every
// fact), through the real host and the real push / REST / pull:
//   - the places: 3 outside accepted (1, 2, 3), a 4th refused ScheduleLimitReached with nothing written, a schedule the check rule refuses
//     takes no place, a sample takes a place only while its crop has no checked schedule (D-91 = 1), the same schedule twice refused, a let-go
//     place is free again;
//   - the database itself: a second row in one place, the same schedule twice, and the CHECKs (his own = place 0 only);
//   - two phones racing (never 4 Active outside; two free places, both win);
//   - which one: abandon / complete / migrate with a subscription id act on that row only; without one and one Active -> that row (P11); without
//     one and several -> ScheduleChoiceNeeded, nothing changed; push and REST answer alike; another farm's id answers like a made-up id (E4);
//   - the migration: back-fill (origin, places in adoption order, under FORCE RLS as a non-bypass owner), refusal when a plot-season is over the
//     limit, Down refuses with two Active and succeeds with one, the chain boots twice;
//   - the pull: plotMainSchedules names the checked Institution schedule even in place 2, follows a withdrawal, never names a plot-season the
//     reader may not see.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleThreePlusOneRealPostgresTests(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    private const string ThisMigration = "20261109090000_AllowThreePlusOneSchedulesPerPlot";
    private const string MigrationBefore = "20261108180000_AddPlannedWork";

    // ── helpers ──

    private static Dictionary<string, object?> AdoptPayload(Guid farm, Guid plot, Guid cycle, Guid template, Guid? subscription = null) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["scheduleTemplateId"] = template,
        ["actorUserId"] = Owner,
        ["subscriptionId"] = subscription ?? Guid.NewGuid(),
    };

    private static Dictionary<string, object?> AbandonPayload(Guid farm, Guid plot, Guid cycle, Guid? subscription) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["actorUserId"] = Owner,
        ["subscriptionId"] = subscription,
    };

    private static Dictionary<string, object?> SwitchPayload(Guid farm, Guid plot, Guid cycle, Guid template, Guid? from) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["newScheduleTemplateId"] = template,
        ["reason"] = "Other",
        ["actorUserId"] = Owner,
        ["fromSubscriptionId"] = from,
    };

    /// <summary>What the table really holds for a plot-season (superuser): id, schedule, state, origin, place.</summary>
    private sealed record Place(Guid Id, Guid Template, int State, string? Origin, short? Slot, string? CheckAtAdopt);

    private async Task<List<Place>> PlacesAsync(Guid? plot = null, bool activeOnly = false)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            SELECT id, schedule_template_id, state, origin, slot, check_state_at_adopt FROM ssf.schedule_subscriptions
            WHERE plot_id = @plot {(activeOnly ? "AND state = 0" : string.Empty)} ORDER BY slot NULLS LAST, adopted_at_utc, id
            """;
        cmd.Parameters.AddWithValue("plot", plot ?? PlotA);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Place>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Place(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetInt16(4),
                reader.IsDBNull(5) ? null : reader.GetString(5)));
        }

        return rows;
    }

    private async Task<Guid> PushAdoptAsync(Guid template, Guid? plot = null, Guid? cycle = null, string? request = null)
    {
        var id = Guid.NewGuid();
        var pushed = await PushAsync(Owner, "adopt_schedule", request ?? $"l8b3-adopt-{id:N}", AdoptPayload(FarmA, plot ?? PlotA, cycle ?? CycleA, template, id));
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        return id;
    }

    /// <summary>Samples: library rows that store no days (checkable never), adoptable while the crop has no checked schedule (D-91 = 1).</summary>
    private async Task<List<Guid>> SamplesAsync(int count)
    {
        var ids = new List<Guid>();
        for (var i = 1; i <= count; i++)
        {
            ids.Add(await SeedTemplateRowAsync($"Grapes - L8b-3 sample {i}"));
        }

        return ids;
    }

    private bool _seatsSeeded;

    private async Task<ScheduleTemplate> CheckedInstitutionAsync(string name = "Grapes - University Schedule")
    {
        if (!_seatsSeeded)
        {
            _seatsSeeded = true;
            await SeedReviewSeatsAsync();
        }

        var row = await SeedStoredRowAsync(name);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);
        return row;
    }

    private async Task SeedRowAsync(Guid farm, Guid plot, Guid cycle, Guid template, string origin, short? slot, int state = 0, string cropKey = "grapes")
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, @crop, @template, 'v1', NOW(), @state, @origin, 'NotChecked', @slot);
            """, ("farm", farm), ("plot", plot), ("cycle", cycle), ("crop", cropKey), ("template", template), ("state", state), ("origin", origin),
            ("slot", slot is { } s ? (object)s : DBNull.Value));
    }

    /// <summary>A raw INSERT as agrisync_app inside the farm's scope (what the host's own connection can do): the exception, or null.</summary>
    private async Task<PostgresException?> AppInsertAsync(Guid farm, Guid plot, Guid cycle, Guid template, string? origin, int? slot, int state = 0)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = "SELECT set_config('agrisync.farm_id', @farm, true)";
            scope.Parameters.AddWithValue("farm", farm.ToString());
            await scope.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                        schedule_version_tag, adopted_at_utc, state, origin, slot)
                VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @template, 'v1', NOW(), @state, @origin, @slot);
                """;
            cmd.Parameters.AddWithValue("farm", farm);
            cmd.Parameters.AddWithValue("plot", plot);
            cmd.Parameters.AddWithValue("cycle", cycle);
            cmd.Parameters.AddWithValue("template", template);
            cmd.Parameters.AddWithValue("state", state);
            cmd.Parameters.AddWithValue("origin", (object?)origin ?? DBNull.Value);
            cmd.Parameters.Add(new NpgsqlParameter("slot", NpgsqlTypes.NpgsqlDbType.Smallint) { Value = slot is { } s ? (short)s : DBNull.Value });
            await cmd.ExecuteNonQueryAsync();
            await tx.RollbackAsync(); // nothing is kept: only the verdict matters
            return null;
        }
        catch (PostgresException ex)
        {
            return ex;
        }
    }

    private async Task MigrateAsync(string? target)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);
        var migrator = db.Database.GetService<IMigrator>();
        if (target is null)
        {
            await migrator.MigrateAsync();
        }
        else
        {
            await migrator.MigrateAsync(target);
        }
    }

    private async Task<long> IndexCountAsync(params string[] names) => await CountAsync(
        "SELECT count(*) FROM pg_indexes WHERE schemaname = 'ssf' AND tablename = 'schedule_subscriptions' AND indexname = ANY(@names)",
        ("names", names));

    // ── Task 1: the places ──

    [Fact]
    public async Task Three_outside_schedules_are_accepted_in_places_1_2_3()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(3);

        foreach (var s in samples)
        {
            await PushAdoptAsync(s);
        }

        var rows = await PlacesAsync(activeOnly: true);
        rows.Select(r => r.Slot).Should().Equal(new short?[] { 1, 2, 3 });
        rows.Should().OnlyContain(r => r.Origin == "Outside");
        rows.Select(r => r.Template).Should().Equal(samples, "the first chosen holds place 1, the next 2, then 3");
        (await ScheduleAuditAsync()).Count(a => a.Action == "Adopted").Should().Be(3);
    }

    [Fact]
    public async Task A_fourth_outside_schedule_is_refused_ScheduleLimitReached_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(4);
        foreach (var s in samples.Take(3))
        {
            await PushAdoptAsync(s);
        }

        var auditBefore = (await ScheduleAuditAsync()).Count;
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b3-fourth", AdoptPayload(FarmA, PlotA, CycleA, samples[3]));
        var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, samples[3]);

        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleLimitReached");
        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.ScheduleLimitReached", "push and REST answer alike");
        (await PlacesAsync(activeOnly: true)).Should().HaveCount(3);
        (await ScheduleAuditAsync()).Count.Should().Be(auditBefore, "a refused choice leaves no audit row either");
    }

    [Fact]
    public async Task A_template_refused_by_the_check_rule_takes_no_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await SeedTemplateRowAsync("Grapes - L8b-3 first sample");
        await PushAdoptAsync(first); // a sample, while the crop has no checked schedule
        var checkedRow = await CheckedInstitutionAsync(); // now the crop HAS a checked schedule
        var anotherSample = await SeedTemplateRowAsync("Grapes - L8b-3 second sample");
        var waiting = await SeedStoredRowAsync("Grapes - waiting for its check"); // stores days, no decision yet

        foreach (var (template, name) in new[] { (anotherSample, "sample"), (waiting.Id, "waiting") })
        {
            var pushed = await PushAsync(Owner, "adopt_schedule", $"l8b3-refused-{name}", AdoptPayload(FarmA, PlotA, CycleA, template));
            pushed.Status.Should().Be("failed", name);
            pushed.ErrorCode.Should().Be("ShramSafal.ScheduleNotChecked", name);
        }

        (await PlacesAsync(activeOnly: true)).Should().ContainSingle("neither refused schedule took a place").Which.Slot.Should().Be(1);

        // Not vacuous: the checked one is accepted into place 2.
        await PushAdoptAsync(checkedRow.Id);
        (await PlacesAsync(activeOnly: true)).Select(r => r.Slot).Should().Equal(new short?[] { 1, 2 });
    }

    [Fact]
    public async Task An_unchecked_sample_takes_a_place_while_its_crop_has_no_checked_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sample = await SeedTemplateRowAsync("Grapes - L8b-3 sample");

        await PushAdoptAsync(sample);

        var kept = (await PlacesAsync(activeOnly: true)).Should().ContainSingle().Which;
        kept.Slot.Should().Be(1);
        kept.CheckAtAdopt.Should().Be("NotChecked", "D-91 = 1: a sample is followed only while the crop has no checked schedule, and is marked");
    }

    [Fact]
    public async Task The_same_schedule_twice_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(2);
        await PushAdoptAsync(samples[0]);
        await PushAdoptAsync(samples[1]);

        var again = await PushAsync(Owner, "adopt_schedule", "l8b3-again", AdoptPayload(FarmA, PlotA, CycleA, samples[1]));

        again.Status.Should().Be("failed");
        again.ErrorCode.Should().Be("ShramSafal.ScheduleAlreadyAdopted");
        (await PlacesAsync(activeOnly: true)).Should().HaveCount(2);
    }

    [Fact]
    public async Task Abandon_one_then_a_new_one_fits_its_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(4);
        var ids = new List<Guid>();
        foreach (var s in samples.Take(3))
        {
            ids.Add(await PushAdoptAsync(s));
        }

        var let = await PushAsync(Owner, "abandon_schedule", "l8b3-let-go-2", AbandonPayload(FarmA, PlotA, CycleA, ids[1]));
        let.Status.Should().Be("applied", $"{let.ErrorCode}: {let.ErrorMessage}");
        await PushAdoptAsync(samples[3]);

        var active = await PlacesAsync(activeOnly: true);
        active.Select(r => r.Slot).Should().Equal(new short?[] { 1, 2, 3 });
        active.Single(r => r.Template == samples[3]).Slot.Should().Be(2, "the place that was let go is free again");
        (await PlacesAsync()).Single(r => r.Id == ids[1]).State.Should().NotBe(0, "the let-go row is kept, no longer Active");
    }

    // ── the database itself ──

    [Fact]
    public async Task The_database_itself_refuses_a_second_row_in_one_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(3);
        await PushAdoptAsync(samples[0]); // place 1

        var samePlace = await AppInsertAsync(FarmA, PlotA, CycleA, samples[1], "Outside", 1);
        samePlace.Should().NotBeNull();
        samePlace!.SqlState.Should().Be("23505");
        samePlace.ConstraintName.Should().Be("ux_sched_sub_active_slot");

        var sameTemplate = await AppInsertAsync(FarmA, PlotA, CycleA, samples[0], "Outside", 2);
        sameTemplate.Should().NotBeNull();
        sameTemplate!.SqlState.Should().Be("23505");
        sameTemplate.ConstraintName.Should().Be("ux_sched_sub_active_template");

        // Not vacuous: the free place takes it, and a let-go (non-Active) row does not hold its place.
        (await AppInsertAsync(FarmA, PlotA, CycleA, samples[1], "Outside", 2)).Should().BeNull();
        (await AppInsertAsync(FarmA, PlotA, CycleA, samples[2], "Outside", 1, state: 2)).Should().BeNull("the unique indexes cover Active rows only");
    }

    [Fact]
    public async Task The_checks_refuse_Own_outside_place_0_and_Outside_in_place_0()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var template = await SeedTemplateRowAsync("Grapes - L8b-3 checks");

        var ownInPlace1 = await AppInsertAsync(FarmA, PlotA, CycleA, template, "Own", 1);
        ownInPlace1!.SqlState.Should().Be("23514");
        ownInPlace1.ConstraintName.Should().Be("ck_sched_sub_slot_origin");
        var outsideInPlace0 = await AppInsertAsync(FarmA, PlotA, CycleA, template, "Outside", 0);
        outsideInPlace0!.ConstraintName.Should().Be("ck_sched_sub_slot_origin");
        var placeWithoutOrigin = await AppInsertAsync(FarmA, PlotA, CycleA, template, null, 1);
        placeWithoutOrigin!.ConstraintName.Should().Be("ck_sched_sub_slot_origin");
        var placeFour = await AppInsertAsync(FarmA, PlotA, CycleA, template, "Outside", 4);
        placeFour!.ConstraintName.Should().Be("ck_sched_sub_slot_range");

        // Not vacuous: his own in place 0, and a row with no place at all (the deployed binary writes none), are accepted.
        (await AppInsertAsync(FarmA, PlotA, CycleA, template, "Own", 0)).Should().BeNull();
        (await AppInsertAsync(FarmA, PlotA, CycleA, template, null, null)).Should().BeNull("E8: the deployed binary names no place");
    }

    [Fact]
    public async Task A_second_own_is_refused_by_the_database_and_adopt_cannot_make_one_before_SCH_OWN()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedTemplateRowAsync("Grapes - the farm's own", TenantScope.Team, author: Owner);
        var other = await SeedTemplateRowAsync("Grapes - the farm's other own", TenantScope.Team, author: Owner);
        await SeedRowAsync(FarmA, PlotA, CycleA, own, "Own", 0);

        // The database: one own per plot-season (place 0 is unique).
        var second = await AppInsertAsync(FarmA, PlotA, CycleA, other, "Own", 0);
        second!.SqlState.Should().Be("23505");
        second.ConstraintName.Should().Be("ux_sched_sub_active_slot");

        // Adopt: the Own branch is still SCH-OWN's - ChooseAsync answers OwnScheduleNotOpenYet before any place is counted, and writes nothing.
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b3-second-own", AdoptPayload(FarmA, PlotA, CycleA, other));
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.OwnScheduleNotOpenYet");
        (await PlacesAsync(activeOnly: true)).Should().ContainSingle();
    }

    // ── two phones racing ──

    [Fact]
    public async Task Two_phones_racing_for_the_last_outside_place_one_wins_the_other_is_refused_with_its_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(2);
        for (var round = 0; round < 10; round++)
        {
            var (plot, cycle) = await SeedSeasonAsync("Grapes");
            // two places already held: the last place (3) is the one both phones compute
            var holders = await SamplesAsync(2);
            await PushAdoptAsync(holders[0], plot, cycle);
            await PushAdoptAsync(holders[1], plot, cycle);

            var a = PushAsync(Owner, "adopt_schedule", $"race-last-a-{round}", AdoptPayload(FarmA, plot, cycle, samples[0]));
            var b = PushAsync(Owner, "adopt_schedule", $"race-last-b-{round}", AdoptPayload(FarmA, plot, cycle, samples[1]));
            var results = await Task.WhenAll(a, b);

            results.Count(r => r.Status == "applied").Should().Be(1, $"round {round}: exactly one phone wins the last place");
            var loser = results.Single(r => r.Status != "applied");
            loser.ErrorCode.Should().Be("ShramSafal.ScheduleLimitReached", $"round {round}: the loser is told the limit with its words, not an unexplained fault");
            var active = await PlacesAsync(plot, activeOnly: true);
            active.Count(r => r.Origin == "Outside").Should().Be(3, $"round {round}: never 4 Active outside");
            active.Select(r => r.Slot).Should().Equal(new short?[] { 1, 2, 3 });
        }
    }

    [Fact]
    public async Task Two_phones_racing_for_two_free_places_both_win()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(2);
        for (var round = 0; round < 10; round++)
        {
            var (plot, cycle) = await SeedSeasonAsync("Grapes");
            var a = PushAsync(Owner, "adopt_schedule", $"race-two-a-{round}", AdoptPayload(FarmA, plot, cycle, samples[0]));
            var b = PushAsync(Owner, "adopt_schedule", $"race-two-b-{round}", AdoptPayload(FarmA, plot, cycle, samples[1]));
            var results = await Task.WhenAll(a, b);

            results.Should().OnlyContain(r => r.Status == "applied", $"round {round}: two places were free: {string.Join(", ", results.Select(r => r.ErrorCode))}");
            (await PlacesAsync(plot, activeOnly: true)).Select(r => r.Slot).Should().Equal(new short?[] { 1, 2 }, $"round {round}");
        }
    }

    // ── Task 2: which one ──

    private async Task<(List<Guid> Templates, List<Guid> Subscriptions)> FollowTwoAsync()
    {
        var templates = await SamplesAsync(3);
        var subscriptions = new List<Guid>
        {
            await PushAdoptAsync(templates[0]),
            await PushAdoptAsync(templates[1]),
        };
        return (templates, subscriptions);
    }

    [Fact]
    public async Task Abandon_with_an_id_acts_on_that_row_only_push_and_REST_alike()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, subs) = await FollowTwoAsync();

        var pushed = await PushAsync(Owner, "abandon_schedule", "l8b3-abandon-2", AbandonPayload(FarmA, PlotA, CycleA, subs[1]));
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        var rows = await PlacesAsync();
        rows.Single(r => r.Id == subs[1]).State.Should().Be(2, "Abandoned");
        rows.Single(r => r.Id == subs[0]).State.Should().Be(0, "the other stays Active");

        // REST, on a second plot-season, with the same shape.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var two = await SamplesAsync(2);
        var s1 = await PushAdoptAsync(two[0], plot2, cycle2);
        var s2 = await PushAdoptAsync(two[1], plot2, cycle2);
        var (status, body) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot2}/cycles/{cycle2}/schedule/abandon", Owner, new { farmId = FarmA, subscriptionId = s1 });
        status.Should().Be(HttpStatusCode.OK, body);
        var after = await PlacesAsync(plot2);
        after.Single(r => r.Id == s1).State.Should().Be(2);
        after.Single(r => r.Id == s2).State.Should().Be(0);
    }

    [Fact]
    public async Task Complete_with_an_id_acts_on_that_row_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, subs) = await FollowTwoAsync();

        var (status, body) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/complete", Owner, new { farmId = FarmA, subscriptionId = subs[0] });

        status.Should().Be(HttpStatusCode.OK, body);
        var rows = await PlacesAsync();
        rows.Single(r => r.Id == subs[0]).State.Should().Be(1 + 2, "Completed");
        rows.Single(r => r.Id == subs[1]).State.Should().Be(0);
    }

    [Fact]
    public async Task Migrate_with_an_id_switches_that_row_only_and_keeps_its_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, subs) = await FollowTwoAsync();
        var target = await SeedTemplateRowAsync("Grapes - L8b-3 target");

        var pushed = await PushAsync(Owner, "migrate_schedule", "l8b3-switch-2", SwitchPayload(FarmA, PlotA, CycleA, target, subs[1]));

        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        var active = await PlacesAsync(activeOnly: true);
        active.Select(r => r.Slot).Should().Equal(new short?[] { 1, 2 });
        active.Single(r => r.Slot == 2).Template.Should().Be(target, "the switched row's place is kept");
        active.Single(r => r.Slot == 1).Id.Should().Be(subs[0], "the other followed schedule is untouched");
        (await PlacesAsync()).Single(r => r.Id == subs[1]).State.Should().Be(1, "Migrated");
    }

    [Fact]
    public async Task Without_an_id_and_one_Active_the_one_is_acted_on_P11()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sample = (await SamplesAsync(2))[0];
        var other = (await SamplesAsync(1))[0];
        var only = await PushAdoptAsync(sample);

        var switched = await PushAsync(Owner, "migrate_schedule", "l8b3-p11-switch", SwitchPayload(FarmA, PlotA, CycleA, other, null));
        switched.Status.Should().Be("applied", $"{switched.ErrorCode}: {switched.ErrorMessage}");
        var now = (await PlacesAsync(activeOnly: true)).Should().ContainSingle().Which;
        now.Template.Should().Be(other);
        now.Slot.Should().Be(1);

        var abandoned = await PushAsync(Owner, "abandon_schedule", "l8b3-p11-abandon", AbandonPayload(FarmA, PlotA, CycleA, null));
        abandoned.Status.Should().Be("applied", $"{abandoned.ErrorCode}: {abandoned.ErrorMessage}");
        (await PlacesAsync(activeOnly: true)).Should().BeEmpty();
        (await PlacesAsync()).Single(r => r.Id == only).State.Should().Be(1);
    }

    [Fact]
    public async Task Without_an_id_and_several_Active_ScheduleChoiceNeeded_and_nothing_changes()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, subs) = await FollowTwoAsync();
        var target = await SeedTemplateRowAsync("Grapes - L8b-3 target");
        var before = await PlacesAsync();

        var abandon = await PushAsync(Owner, "abandon_schedule", "l8b3-needed-abandon", AbandonPayload(FarmA, PlotA, CycleA, null));
        var switched = await PushAsync(Owner, "migrate_schedule", "l8b3-needed-switch", SwitchPayload(FarmA, PlotA, CycleA, target, null));
        var restAbandon = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/abandon", Owner, new { farmId = FarmA });
        var restComplete = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/complete", Owner, new { farmId = FarmA });
        var restSwitch = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/migrate", Owner,
            new { farmId = FarmA, newScheduleTemplateId = target, reason = "Other" });

        foreach (var pushed in new[] { abandon, switched })
        {
            pushed.Status.Should().Be("failed");
            pushed.ErrorCode.Should().Be("ShramSafal.ScheduleChoiceNeeded");
        }

        foreach (var (status, body) in new[] { restAbandon, restComplete, restSwitch })
        {
            status.Should().Be(HttpStatusCode.BadRequest, body);
            ErrorCode(body).Should().Be("ShramSafal.ScheduleChoiceNeeded", "push and REST answer alike");
        }

        (await PlacesAsync()).Should().BeEquivalentTo(before, "nothing was changed");
        subs.Should().HaveCount(2);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_migration_events")).Should().Be(0);
    }

    [Fact]
    public async Task Another_farms_subscription_id_answers_like_a_made_up_id_E4()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await FollowTwoAsync();
        var rest = await AdoptAsync(OwnerB, FarmB, PlotB, CycleB, BuiltInGrapes);
        rest.Status.Should().Be(HttpStatusCode.OK, rest.Body);
        var foreign = Json(rest.Body).GetProperty("id").GetGuid();

        var madeUp = await PushAsync(Owner, "abandon_schedule", "l8b3-e4-made-up", AbandonPayload(FarmA, PlotA, CycleA, Guid.NewGuid()));
        var other = await PushAsync(Owner, "abandon_schedule", "l8b3-e4-foreign", AbandonPayload(FarmA, PlotA, CycleA, foreign));
        var restMadeUp = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/abandon", Owner, new { farmId = FarmA, subscriptionId = Guid.NewGuid() });
        var restOther = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/abandon", Owner, new { farmId = FarmA, subscriptionId = foreign });

        madeUp.ErrorCode.Should().Be("ShramSafal.ScheduleSubscriptionNotFound");
        other.ErrorCode.Should().Be(madeUp.ErrorCode);
        other.ErrorMessage.Should().Be(madeUp.ErrorMessage);
        restOther.Status.Should().Be(restMadeUp.Status);
        ErrorCode(restOther.Body).Should().Be(ErrorCode(restMadeUp.Body));
        (await PlacesAsync(PlotB)).Should().ContainSingle().Which.State.Should().Be(0, "the other farm's subscription was not touched");
    }

    [Fact]
    public async Task Release_1_0_17_REST_adopt_on_a_plot_with_one_schedule_behaves_as_documented()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // 1.0.17's SchedulePickerModal calls REST adopt with { farmId, scheduleTemplateId } and no subscription id (P11).
        var samples = await SamplesAsync(2);
        var first = await AdoptAsync(Owner, FarmA, PlotA, CycleA, samples[0]);
        first.Status.Should().Be(HttpStatusCode.OK, first.Body);

        // The SAME schedule again: refused as before (ScheduleAlreadyAdopted, 400).
        var same = await AdoptAsync(Owner, FarmA, PlotA, CycleA, samples[0]);
        same.Status.Should().Be(HttpStatusCode.BadRequest, same.Body);
        ErrorCode(same.Body).Should().Be("ShramSafal.ScheduleAlreadyAdopted");

        // A DIFFERENT schedule: NEW with 3 + 1 - it is followed as well, in the next place (before this lane: 400 ScheduleAlreadyAdopted).
        var different = await AdoptAsync(Owner, FarmA, PlotA, CycleA, samples[1]);
        different.Status.Should().Be(HttpStatusCode.OK, different.Body);
        Json(different.Body).GetProperty("slot").GetInt32().Should().Be(2);
        (await PlacesAsync(activeOnly: true)).Select(r => r.Slot).Should().Equal(new short?[] { 1, 2 });
    }

    // ── the old two-phones refusal, restated for 3 + 1 (the L8b-2 tests were rewritten on purpose: ruling 6) ──

    [Fact]
    public async Task Two_phones_offline_choosing_different_schedules_both_are_kept_in_places_1_and_2()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var samples = await SamplesAsync(2);

        (await PushAsync(Owner, "adopt_schedule", "phone-a-adopt", AdoptPayload(FarmA, PlotA, CycleA, samples[0]))).Status.Should().Be("applied");
        (await PushAsync(Owner, "adopt_schedule", "phone-b-adopt", AdoptPayload(FarmA, PlotA, CycleA, samples[1]))).Status.Should().Be("applied");

        (await PlacesAsync(activeOnly: true)).Select(r => (r.Template, r.Slot)).Should().Equal((samples[0], (short?)1), (samples[1], (short?)2));
    }

    // ── the pull: the मुख्य schedule ──

    private static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 30));
    }

    private static IReadOnlyList<JsonElement> Mains(JsonElement root) => ArrayOf(root, "plotMainSchedules");

    private static Guid? MainOf(JsonElement root, Guid plot)
    {
        var rows = Mains(root).Where(m => m.GetProperty("plotId").GetGuid() == plot).ToList();
        return rows.Count == 0 ? null : rows.Single().GetProperty("subscriptionId").GetGuid();
    }

    [Fact]
    public async Task The_pull_names_the_checked_Institution_row_as_main_even_in_place_2_and_follows_a_withdrawal()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sample = await SeedTemplateRowAsync("Grapes - L8b-3 sample");
        var sampleSub = await PushAdoptAsync(sample); // place 1, while the crop has no checked schedule
        var institution = await CheckedInstitutionAsync();
        var institutionSub = await PushAdoptAsync(institution.Id); // place 2
        var secondInstitution = await CheckedInstitutionAsync("Grapes - University Schedule B");
        var secondSub = await PushAdoptAsync(secondInstitution.Id); // place 3: three outside schedules, two of them checked Institution ones
        (await PlacesAsync(activeOnly: true)).Select(r => r.Slot).Should().Equal(new short?[] { 1, 2, 3 });

        var (body, root) = await PullAsync(Owner);
        KeepP11Body("l8b3-owner-three-plus-one", body);
        root.TryGetProperty("plotMainSchedules", out _).Should().BeTrue("the server sends the key");
        var main = Mains(root).Single(m => m.GetProperty("plotId").GetGuid() == PlotA);
        main.GetProperty("subscriptionId").GetGuid().Should().Be(institutionSub, "the checked Institution schedule is main even in place 2");
        main.GetProperty("cropCycleId").GetGuid().Should().Be(CycleA);
        ArrayOf(root, "scheduleSubscriptions").Single(s => s.GetProperty("id").GetGuid() == institutionSub)
            .GetProperty("slot").GetInt32().Should().Be(2);

        // The other phone's incremental pull (a whole-second cursor past the choices, as every phone sends it) carries the key in FULL even
        // when no subscription changed.
        await NextWholeSecondAsync();
        var cursor = DateTime.UtcNow;
        await NextWholeSecondAsync();
        var (_, quiet) = await PullAsync(Owner, cursor);
        ArrayOf(quiet, "scheduleSubscriptions").Should().BeEmpty("a choice the cursor has passed is not sent again");
        MainOf(quiet, PlotA).Should().Be(institutionSub, "plotMainSchedules is full on every pull");

        // ShramSafal withdraws its check of the main one: on the NEXT pull the other checked Institution schedule is main (place 3)...
        (await CheckAsync(PlatformOwner, institution.Id, "Withdrawn", note: "revised")).Status.Should().Be(HttpStatusCode.OK);
        var (afterBody, after) = await PullAsync(Owner, cursor);
        KeepP11Body("l8b3-owner-after-withdrawal", afterBody);
        MainOf(after, PlotA).Should().Be(secondSub);

        // ...and when that check is withdrawn too, no checked Institution schedule is followed: the lowest outside place is main.
        (await CheckAsync(PlatformOwner, secondInstitution.Id, "Withdrawn", note: "revised")).Status.Should().Be(HttpStatusCode.OK);
        MainOf((await PullAsync(Owner, cursor)).Root, PlotA).Should().Be(sampleSub);
    }

    [Fact]
    public async Task The_pull_never_names_a_plot_season_the_reader_may_not_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sample = await SeedTemplateRowAsync("Grapes - L8b-3 sample");
        await PushAdoptAsync(sample);
        var (otherPlot, otherCycle) = await SeedSeasonAsync("Grapes");
        await PushAdoptAsync(sample, otherPlot, otherCycle);

        // The other farm's owner never sees farm A's plot-seasons; an own-records worker seat has no farm overview.
        var (ownerBBody, ownerB) = await PullAsync(OwnerB);
        KeepP11Body("l8b3-other-farm-owner", ownerBBody);
        Mains(ownerB).Should().BeEmpty("another farm's choice is never named to him");
        var (workerBody, worker) = await PullAsync(Worker);
        KeepP11Body("l8b3-worker-seat", workerBody);
        Mains(worker).Should().BeEmpty("a seat without the farm overview is named nothing");

        // Not vacuous: the owner and the co-owner see both plot-seasons; a chosen-plots seat sees only his plot.
        Mains((await PullAsync(Owner)).Root).Select(m => m.GetProperty("plotId").GetGuid()).Should().BeEquivalentTo(new[] { PlotA, otherPlot });
        Mains((await PullAsync(CoOwner)).Root).Should().HaveCount(2);
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{CoOwner}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = new[] { otherPlot } });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        Mains((await PullAsync(CoOwner)).Root).Should().ContainSingle().Which.GetProperty("plotId").GetGuid().Should().Be(otherPlot);
    }

    // ── the migration ──

    [Fact]
    public async Task Down_refuses_with_two_active()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await FollowTwoAsync();
        var before = await PlacesAsync();

        var down = async () => await MigrateAsync(MigrationBefore);

        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("Down refused: 1 plot-seasons follow two or more schedules");
        (await PlacesAsync()).Should().BeEquivalentTo(before, "no row changed");
        (await IndexCountAsync("ux_sched_sub_active_slot", "ux_sched_sub_active_template")).Should().Be(2, "no index changed");
        (await IndexCountAsync("ux_sched_sub_active")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name = 'slot'")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(1, "the migration stays applied");
    }

    [Fact]
    public async Task Down_succeeds_with_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sample = (await SamplesAsync(1))[0];
        var only = await PushAdoptAsync(sample);

        await MigrateAsync(MigrationBefore);

        (await IndexCountAsync("ux_sched_sub_active")).Should().Be(1, "Down recreates the one-active index as it was");
        (await IndexCountAsync("ux_sched_sub_active_slot", "ux_sched_sub_active_template")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name = 'slot'")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM pg_constraint WHERE conname IN ('ck_sched_sub_slot_range', 'ck_sched_sub_slot_origin')")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE id = @id AND state = 0", ("id", only))).Should().Be(1, "the subscription itself remains");
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(0);

        await MigrateAsync(null);

        (await PlacesAsync(activeOnly: true)).Should().ContainSingle().Which.Slot.Should().Be(1, "Up gives the lone Active row place 1 again");
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(1);
        await MigrateAsync(null); // a second boot of the chain is a no-op
    }

    [Fact]
    public async Task Rows_without_origin_are_backfilled_Outside()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await MigrateAsync(MigrationBefore);
        // Rows exactly as the code before this lane wrote them: no origin, no place (the slot column does not exist yet).
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @t1, 'v1', NOW() - INTERVAL '2 days', 0),
                   (gen_random_uuid(), @farm, @plot2, @cycle2, 'grapes', @t2, 'v1', NOW() - INTERVAL '1 day', 2);
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("plot2", plot2), ("cycle2", cycle2), ("t1", BuiltInGrapes), ("t2", BuiltInPomegranate));
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL")).Should().Be(2);

        await MigrateAsync(null);

        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin = 'Outside'")).Should().Be(2);
        (await PlacesAsync(PlotA)).Should().ContainSingle().Which.Slot.Should().Be(1);
        (await PlacesAsync(plot2)).Should().ContainSingle().Which.Slot.Should().BeNull("a row that is not Active keeps no place");
    }

    [Fact]
    public async Task Existing_rows_get_places_in_adoption_order()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await MigrateAsync(MigrationBefore);
        // Three Active rows on one plot-season (possible before this lane only after a crop-name change: crop_key differs), adopted at
        // known times, one Own row on another plot-season; plus a let-go row.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var templates = new[] { BuiltInGrapes, BuiltInPomegranate, BuiltInSugarcane };
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
            VALUES ('00000000-0000-4000-8000-000000000003', @farm, @plot, @cycle, 'grapes3', @t3, 'v1', TIMESTAMPTZ '2026-10-03 00:00:00+00', 0, NULL),
                   ('00000000-0000-4000-8000-000000000001', @farm, @plot, @cycle, 'grapes1', @t1, 'v1', TIMESTAMPTZ '2026-10-01 00:00:00+00', 0, NULL),
                   ('00000000-0000-4000-8000-000000000002', @farm, @plot, @cycle, 'grapes2', @t2, 'v1', TIMESTAMPTZ '2026-10-02 00:00:00+00', 0, 'Outside'),
                   ('00000000-0000-4000-8000-000000000004', @farm, @plot2, @cycle2, 'grapes', @t1, 'v1', TIMESTAMPTZ '2026-10-04 00:00:00+00', 0, 'Own'),
                   ('00000000-0000-4000-8000-000000000005', @farm, @plot2, @cycle2, 'grapes', @t2, 'v1', TIMESTAMPTZ '2026-10-05 00:00:00+00', 1, NULL);
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("plot2", plot2), ("cycle2", cycle2),
            ("t1", templates[0]), ("t2", templates[1]), ("t3", templates[2]));

        await MigrateAsync(null);

        var first = await PlacesAsync(PlotA, activeOnly: true);
        first.Select(r => (r.Id.ToString()[^1], r.Slot)).Should().Equal(new[] { ('1', (short?)1), ('2', (short?)2), ('3', (short?)3) }, "places follow adoption order");
        var second = await PlacesAsync(plot2);
        second.Single(r => r.Id.ToString().EndsWith('4')).Slot.Should().Be(0, "his own takes place 0");
        second.Single(r => r.Id.ToString().EndsWith('4')).Origin.Should().Be("Own");
        second.Single(r => r.Id.ToString().EndsWith('5')).Slot.Should().BeNull();
    }

    [Fact]
    public async Task Up_refuses_a_plot_season_with_more_than_three_outside()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await MigrateAsync(MigrationBefore);
        // Seeded by the superuser before the migration: 4 Active outside rows on one plot-season (distinct crop_key, as only a rename allows).
        var templates = new[] { BuiltInGrapes, BuiltInPomegranate, BuiltInSugarcane, BuiltInOnion };
        for (var i = 0; i < 4; i++)
        {
            await ExecOnSuperuserAsync("""
                INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
                VALUES (gen_random_uuid(), @farm, @plot, @cycle, @crop, @t, 'v1', NOW() - make_interval(days => @n), 0, NULL);
                """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("crop", $"grapes{i}"), ("t", templates[i]), ("n", 10 - i));
        }

        var up = async () => await MigrateAsync(null);

        (await up.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("3 + 1: 1 plot-seasons already follow more than 3 outside schedules");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE state = 0")).Should().Be(4, "no row was removed or ended");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL")).Should().Be(4, "the refusal wrote nothing (the origin back-fill rolled back too)");
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name = 'slot'")).Should().Be(0);
        (await IndexCountAsync("ux_sched_sub_active")).Should().Be(1, "the old index is still there");
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(0);
    }

    private const string RefusalWords = "3 + 1: 1 plot-seasons already follow more than 3 outside schedules, more than 1 of their own, or one schedule twice";

    /// <summary>Seeds (before the migration, as the superuser) the rows the old code could hold, tries Up, and proves it refused with its words and changed nothing.</summary>
    private async Task AssertUpRefusesAsync(string seedSql, params (string, object)[] args)
    {
        await MigrateAsync(MigrationBefore);
        // one more row with no origin on ANOTHER plot-season: if the refusal did not roll the whole back-fill back, its origin would read Outside
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        await ExecOnSuperuserAsync(seedSql, args);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @t, 'v1', NOW(), 0, NULL);
            """, ("farm", FarmA), ("plot", plot2), ("cycle", cycle2), ("t", BuiltInOnion));
        var before = await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE state = 0");
        var noOrigin = await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL");
        noOrigin.Should().BeGreaterThan(0);

        var up = async () => await MigrateAsync(null);

        (await up.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain(RefusalWords);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE state = 0")).Should().Be(before, "no row was removed or ended");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin IS NULL")).Should().Be(noOrigin, "the refusal wrote nothing (the origin back-fill rolled back too)");
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_subscriptions' AND column_name = 'slot'")).Should().Be(0);
        (await IndexCountAsync("ux_sched_sub_active")).Should().Be(1, "the old index is still there");
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(0);
    }

    [Fact]
    public async Task Up_refuses_a_plot_season_with_two_Active_Own_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // (distinct crop_key, as only a crop-name change could make two before this lane)
        await AssertUpRefusesAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes1', @t1, 'v1', NOW() - INTERVAL '2 days', 0, 'Own'),
                   (gen_random_uuid(), @farm, @plot, @cycle, 'grapes2', @t2, 'v1', NOW() - INTERVAL '1 day', 0, 'Own');
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("t1", BuiltInGrapes), ("t2", BuiltInPomegranate));
    }

    [Fact]
    public async Task Up_refuses_a_plot_season_that_follows_one_schedule_twice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertUpRefusesAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes1', @t1, 'v1', NOW() - INTERVAL '2 days', 0, NULL),
                   (gen_random_uuid(), @farm, @plot, @cycle, 'grapes2', @t1, 'v1', NOW() - INTERVAL '1 day', 0, NULL);
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("t1", BuiltInGrapes));
    }

    [Fact]
    public async Task The_back_fill_runs_as_a_non_bypass_owner_under_FORCE_RLS_because_it_lifts_the_force()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Production migrates as agrisync_app, a non-bypass role that OWNS its tables. Reproduce that: make the app role the owner, then run the
        // migration's own back-fill text as it, with no tenant scope set (so FORCE RLS would hide every row without the lift).
        await MigrateAsync(MigrationBefore);
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @t1, 'v1', NOW() - INTERVAL '2 days', 0, NULL),
                   (gen_random_uuid(), @farm, @plot2, @cycle2, 'grapes', @t2, 'v1', NOW() - INTERVAL '1 day', 0, NULL);
            """, ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("plot2", plot2), ("cycle2", cycle2), ("t1", BuiltInGrapes), ("t2", BuiltInPomegranate));
        await ExecOnSuperuserAsync("ALTER TABLE ssf.schedule_subscriptions ADD COLUMN slot smallint NULL");
        await ExecOnSuperuserAsync($"ALTER TABLE ssf.schedule_subscriptions OWNER TO {AppRoleUser}");
        (await CountAsync("SELECT (relforcerowsecurity)::int FROM pg_class WHERE oid = 'ssf.schedule_subscriptions'::regclass")).Should().Be(1, "FORCE RLS is on before the back-fill");

        await using (var db = new NpgsqlConnection(AppConn))
        {
            await db.OpenAsync();
            await using var rolecheck = db.CreateCommand();
            rolecheck.CommandText = "SELECT count(*) FROM ssf.schedule_subscriptions"; // no scope: FORCE RLS shows the owner nothing
            Convert.ToInt64(await rolecheck.ExecuteScalarAsync()).Should().Be(0, "without the lift the non-bypass owner sees no rows - the trap the lift answers");
            await using var cmd = db.CreateCommand();
            cmd.CommandText = ShramSafal.Infrastructure.Persistence.Migrations.AllowThreePlusOneSchedulesPerPlot.BackfillSql;
            await cmd.ExecuteNonQueryAsync();
        }

        (await CountAsync("SELECT (relforcerowsecurity)::int FROM pg_class WHERE oid = 'ssf.schedule_subscriptions'::regclass")).Should().Be(1, "FORCE RLS is restored");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_subscriptions WHERE origin = 'Outside' AND slot = 1")).Should().Be(2, "the back-fill saw every row");
        await ExecOnSuperuserAsync("ALTER TABLE ssf.schedule_subscriptions DROP COLUMN slot");
        await ExecOnSuperuserAsync("ALTER TABLE ssf.schedule_subscriptions OWNER TO postgres");
    }
}
