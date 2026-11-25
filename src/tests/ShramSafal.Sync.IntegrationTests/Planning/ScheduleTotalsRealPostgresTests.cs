// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, "Library, profile and honest numbers"; approved spec plr-d10-schedule-approved-spec-2026-11-23: "Follow = taken into my schedule. Done, and heard,
// are separate counts. Creators see totals only, hidden for small groups. No number without evidence (P4)"; acceptance: "Totals equal a hand-counted fixture. No evidence, no number")
//
// The server half: ONE narrow cross-farm read, a SECURITY DEFINER function that returns aggregates only, and the route that asks it. Real Postgres as agrisync_app (E3 first in every fact), through the real
// host; the arrangement (farms, takes, choices, jobs, heard rows, the exclusion list) is written as superuser. Fake ids only.
//
// The fixture below is HAND-COUNTED (the table is written here, not computed from the code under test):
//
//   farmers  F1..F9 (nine farms, nine owners), X (a TEST farm, put on the exclusion list in the test that needs it), Z (follows nothing)
//   the reference schedule C has version v1 (CHECKED, four works: t-prune, t-spray, t-water, t-weed) and version v2 (not checked)
//
//   active own works taken from C:   t-prune F1 F2 F3 F4 F5 F6 F7 (and F8's, REMOVED: not counted)   t-spray F1 F2 F3 F4 F5   t-water F1 F2 F3 F4   t-weed nobody
//   active choices of a version of C: F1 F2 F3 F4 F5 F6 on v1, F9 on v2 (F8's is Abandoned: not counted)
//   jobs closed Done from an own work of C: F1 has two (t-prune, occurrence 1 and 2), F2 F3 F4 F5 one each = 6 jobs (F6's job is only Accepted: not counted)
//   heard a message of C: F1 F2 F3 F4
//   X (the test farm) did all of it too, in each count.
//
//   so:  following 7 (F1..F7)   having 7 (F1..F6 and F9)   works shown: t-prune 7, t-spray 5 (t-water has 4: LEFT OUT; t-weed has none)
//        worksTaken 3 of worksInSchedule 4 (the latest CHECKED version is v1) = 75 %   done 6 jobs   heard NULL (4 farmers: fewer than five)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using NpgsqlTypes;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleTotalsRealPostgresTests(ITestOutputHelper output) : OwnerVoiceLane(output)
{
    private const string Prune = "t-prune";
    private const string Spray = "t-spray";
    private const string Water = "t-water";
    private const string Weed = "t-weed";
    private static readonly string[] FourKeys = [Prune, Spray, Water, Weed];

    private sealed record Farmer(Guid User, Guid Farm, Guid Plot, Guid Cycle);

    private sealed record Arrangement(Guid V1, Guid V2, Farmer[] F, Farmer X, Farmer Z);

    private sealed record CallRow(string Metric, string? TaskKey, int Farmers, int Amount);

    // ---- the arrangement ----------------------------------------------------------------------------------------------------------------------

    private async Task<Farmer> SeedFarmerAsync(bool listed = false)
    {
        var f = new Farmer(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@farm, 'totals-probe', @user, gen_random_uuid(), NOW(), NOW(), 3.0, 'Unchecked');
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc) VALUES (@plot, @farm, 'p', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """, ("farm", f.Farm), ("user", f.User), ("plot", f.Plot), ("cycle", f.Cycle));
        if (listed)
        {
            await ListAsync(f);
        }

        return f;
    }

    private Task ListAsync(Farmer f) => ExecOnSuperuserAsync(
        "INSERT INTO ssf.schedule_totals_excluded_farms (farm_id, reason, added_by) VALUES (@farm, 'test farm', 'test')", ("farm", f.Farm));

    private Task UnlistAsync(Farmer f) => ExecOnSuperuserAsync("DELETE FROM ssf.schedule_totals_excluded_farms WHERE farm_id = @farm", ("farm", f.Farm));

    /// <summary>An own work taken from <paramref name="version"/> of <paramref name="chain"/> (the work and its origin), Active or Removed. Returns the work's id.</summary>
    private async Task<Guid> TakeAsync(Farmer f, Guid chain, Guid version, string key, bool removed = false)
    {
        var item = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.own_schedule_items (id, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, origin, content, content_hash, name, kind, timer_kind,
                                                stage_index, order_index, state, revision, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
            VALUES (@item, @farm, @plot, @cycle, @user, @key, 'take:x', '{}'::jsonb, repeat('a', 64), 'work', 'work', 'none', 0, 0, @state, 1, @user, NOW(), @user, NOW());
            INSERT INTO ssf.own_schedule_item_origins (id, item_id, sequence, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, source_version_id, source_chain_id,
                                                      source_name, source_version_number, source_owner_user_id, source_task_key, chosen_dose, taken_by_user_id, taken_on, taken_at_utc)
            VALUES (gen_random_uuid(), @item, 1, @farm, @plot, @cycle, @user, @key, @version, @chain, 'totals probe', 1, NULL, @key, NULL, @user, DATE '2026-11-25', NOW());
            """,
            ("item", item), ("farm", f.Farm), ("plot", f.Plot), ("cycle", f.Cycle), ("user", f.User), ("key", key), ("version", version), ("chain", chain),
            ("state", (short)(removed ? 1 : 0)));
        return item;
    }

    private Task FollowAsync(Farmer f, Guid version, int state = 0, short slot = 1) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot)
        VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @version, 'v1', NOW(), @state, 'Outside', 'NotChecked', @slot);
        """, ("farm", f.Farm), ("plot", f.Plot), ("cycle", f.Cycle), ("version", version), ("state", state), ("slot", slot));

    private Task JobAsync(Farmer f, Guid item, string key, int occurrence, string status) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.planned_work (id, farm_id, title, scope, status, source, recorded_on, linked_daily_log_ids, created_by_user_id, created_at_utc, modified_at_utc,
                                      former_assignee_user_ids, own_item_id, schedule_task_key, occurrence)
        VALUES (gen_random_uuid(), @farm, 'totals probe', 'Plot', @status, 'Schedule', DATE '2026-11-25', '{}', @user, NOW(), NOW(), '{}', @item, @key, @occ);
        """, ("farm", f.Farm), ("user", f.User), ("status", status), ("item", item), ("key", key), ("occ", occurrence));

    private async Task<Guid> MessageAsync(Guid chain, Guid version)
    {
        var message = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_owner_messages (id, chain_id, schedule_version_id, task_key, kind, clip_id, sent_by_user_id, sent_at_utc)
            VALUES (@m, @chain, @version, 't-spray', 0, gen_random_uuid(), gen_random_uuid(), NOW());
            """, ("m", message), ("chain", chain), ("version", version));
        return message;
    }

    private Task HeardAsync(Farmer f, Guid message) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.schedule_owner_message_states (id, farm_id, plot_id, crop_cycle_id, owner_user_id, message_id, kind, sequence, answer, item_created, by_user_id, at_utc)
        VALUES (gen_random_uuid(), @farm, @plot, NULL, @user, @m, 0, 0, NULL, FALSE, @user, NOW());
        """, ("farm", f.Farm), ("plot", f.Plot), ("user", f.User), ("m", message));

    /// <summary>A reference schedule with four works (the latest CHECKED version has them), imported by the platform owner; <paramref name="previous"/> makes it the next version of that chain.</summary>
    private async Task<Guid> ImportFourAsync(Guid? previous = null)
    {
        if (!_seatsSeeded)
        {
            _seatsSeeded = true;
            await SeedReviewSeatsAsync();
        }

        IReadOnlyList<ScheduleTaskContent> tasks =
        [
            new(Prune, "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0),
            new(Spray, "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, 0, 1,
                Dose: DoseOld, Products: [new ScheduleProduct("चाचणी औषध", DoseOld, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
            new(Water, "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(5), ScheduleBasis.Stated, 0, 2),
            new(Weed, "तण काढणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(15), ScheduleBasis.Stated, 0, 3),
        ];
        var body = new
        {
            format = 2,
            name = "द्राक्ष: चाचणी संदर्भ",
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "चाचणी पुस्तिका",
            previousVersionId = previous,
            stages = TwoStages,
            tasks = tasks.Select(Canonical).ToArray(),
            challenges = Array.Empty<object>(),
        };
        var (status, text) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", PlatformOwner, body);
        status.Should().Be(HttpStatusCode.Created, text);
        return Json(text).GetProperty("templateId").GetGuid();
    }

    private bool _seatsSeeded;

    /// <summary>The hand-counted fixture (see the header).</summary>
    private async Task<Arrangement> ArrangeAsync()
    {
        var v1 = await ImportFourAsync();
        await ApproveAsync(v1);
        var v2 = await ImportFourAsync(v1);
        var f = new Farmer[9];
        for (var i = 0; i < f.Length; i++)
        {
            f[i] = await SeedFarmerAsync();
        }

        var x = await SeedFarmerAsync();
        var z = await SeedFarmerAsync();
        var chain = v1;

        var prune = new Dictionary<Guid, Guid>();
        foreach (var farmer in f.Take(7).Append(x))
        {
            prune[farmer.Farm] = await TakeAsync(farmer, chain, v1, Prune);
        }

        foreach (var farmer in f.Take(5).Append(x))
        {
            await TakeAsync(farmer, chain, v1, Spray);
        }

        foreach (var farmer in f.Take(4).Append(x))
        {
            await TakeAsync(farmer, chain, v1, Water);
        }

        await TakeAsync(f[7], chain, v1, Prune, removed: true);

        foreach (var farmer in f.Take(6).Append(x))
        {
            await FollowAsync(farmer, v1);
        }

        await FollowAsync(f[8], v2);
        await FollowAsync(f[7], v1, state: 2);

        await JobAsync(f[0], prune[f[0].Farm], Prune, 1, "Done");
        await JobAsync(f[0], prune[f[0].Farm], Prune, 2, "Done");
        foreach (var farmer in f.Skip(1).Take(4))
        {
            await JobAsync(farmer, prune[farmer.Farm], Prune, 1, "Done");
        }

        await JobAsync(f[5], prune[f[5].Farm], Prune, 1, "Accepted");
        await JobAsync(x, prune[x.Farm], Prune, 1, "Done");

        var message = await MessageAsync(chain, v1);
        foreach (var farmer in f.Take(4).Append(x))
        {
            await HeardAsync(farmer, message);
        }

        await ListAsync(x);
        return new Arrangement(v1, v2, f, x, z);
    }

    // ---- the readers --------------------------------------------------------------------------------------------------------------------------

    private async Task<JsonElement> TotalsAsync(Guid version, Guid? who = null)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{version}/totals", who ?? Owner, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private static int? IntOrNull(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.GetInt32() : null;

    /// <summary>Calls the function AS THE APP ROLE under a farm scope (what a request does), through its own connection.</summary>
    private async Task<List<CallRow>> CallAsync(Guid chain, string[]? keys, Farmer? scope = null)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, scope);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT metric, task_key, farmers, amount FROM ssf.schedule_chain_totals(@c::uuid, @k::text[]) ORDER BY metric, task_key";
        cmd.Parameters.AddWithValue("c", chain);
        cmd.Parameters.Add(new NpgsqlParameter("k", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = (object?)keys ?? DBNull.Value });
        var rows = new List<CallRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new CallRow(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3)));
        }

        return rows;
    }

    private static async Task ScopeAsync(NpgsqlConnection db, Farmer? scope)
    {
        if (scope is null)
        {
            return;
        }

        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.user_id', @u, true), set_config('agrisync.farm_id', @f, true)";
        cmd.Parameters.AddWithValue("u", scope.User.ToString());
        cmd.Parameters.AddWithValue("f", scope.Farm.ToString());
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>Rows the APP ROLE reads from a table under a farm's scope.</summary>
    private async Task<long> AppCountAsync(Farmer scope, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, scope);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private static async Task MustAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<string> ErrorOfAsync(NpgsqlConnection db, string sql)
    {
        try
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
            return string.Empty;
        }
        catch (PostgresException ex)
        {
            return $"{ex.SqlState}: {ex.MessageText}";
        }
    }

    // ---- the numbers --------------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Totals_EqualHandCountedFixture()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();

        // Asked by ANY signed-in person (the owner of farm A, who has nothing in this fixture), through any version of the chain.
        foreach (var version in new[] { a.V1, a.V2 })
        {
            var t = await TotalsAsync(version);
            t.GetProperty("kind").GetString().Should().Be("totals");
            t.GetProperty("minimumFarmers").GetInt32().Should().Be(5);
            IntOrNull(t, "following").Should().Be(7, "F1..F7 hold an active own work taken from the chain; F8's is removed and X is a listed test farm");
            IntOrNull(t, "having").Should().Be(7, "F1..F6 on v1 and F9 on v2; F8's choice is abandoned and X is listed");
            IntOrNull(t, "worksInSchedule").Should().Be(4, "the latest CHECKED version (v1) has four works; v2 is not checked");
            IntOrNull(t, "worksTaken").Should().Be(3, "t-prune, t-spray and t-water have a taker; t-weed has none");
            IntOrNull(t, "worksTakenPercent").Should().Be(75);
            IntOrNull(t, "doneJobs").Should().Be(6, "F1's two jobs and one each of F2..F5 closed Done; F6's is only Accepted and X is listed");
            IntOrNull(t, "heard").Should().BeNull("F1..F4 heard: four farmers is fewer than five");
            t.GetProperty("checkedVersionId").GetGuid().Should().Be(a.V1);

            var works = t.GetProperty("works").EnumerateArray().Select(w => (w.GetProperty("taskKey").GetString(), w.GetProperty("farmers").GetInt32())).ToList();
            works.Should().BeEquivalentTo(new[] { (Prune, 7), (Spray, 5) }, "t-water has four takers (left out), t-weed none");
            t.GetProperty("works").EnumerateArray().First().GetProperty("name").GetString().Should().Be("फळछाटणी", "the work's name is the name in the latest checked version");
        }
    }

    [Fact]
    public async Task NoEvidence_NoNumber()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // A checked schedule nobody has taken or followed: nothing backs a number, so none is returned (never a 0 standing in for unknown).
        var v1 = await ImportFourAsync();
        await ApproveAsync(v1);
        var t = await TotalsAsync(v1);
        t.GetProperty("kind").GetString().Should().Be("totals");
        foreach (var name in new[] { "following", "having", "worksTaken", "worksTakenPercent", "doneJobs", "heard" })
        {
            t.TryGetProperty(name, out var v).Should().BeTrue($"{name} is always present");
            v.ValueKind.Should().Be(JsonValueKind.Null, $"{name}: no rows back it");
        }

        t.GetProperty("works").GetArrayLength().Should().Be(0);
        IntOrNull(t, "worksInSchedule").Should().Be(4, "the schedule's own works are a fact of the checked version, not a farmer count");

        // A schedule with NO checked version has no works count either (nothing checked to count).
        var unchecked1 = await ImportFourAsync();
        var u = await TotalsAsync(unchecked1);
        IntOrNull(u, "worksInSchedule").Should().BeNull();
        IntOrNull(u, "worksTaken").Should().BeNull();
        u.GetProperty("checkedVersionId").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task UnderFive_Hidden()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await ImportFourAsync();
        await ApproveAsync(v1);
        var four = new List<Farmer>();
        for (var i = 0; i < 4; i++)
        {
            var f = await SeedFarmerAsync();
            four.Add(f);
            await TakeAsync(f, v1, v1, Prune);
            await FollowAsync(f, v1);
        }

        var t4 = await TotalsAsync(v1);
        IntOrNull(t4, "following").Should().BeNull("4 farmers read the same as 0: fewer than five");
        IntOrNull(t4, "having").Should().BeNull();
        IntOrNull(t4, "worksTaken").Should().BeNull("four farmers back it");
        t4.GetProperty("works").GetArrayLength().Should().Be(0, "a per-work line under five is left out");

        // The fifth farmer: 5 is shown, and the work line appears.
        var fifth = await SeedFarmerAsync();
        await TakeAsync(fifth, v1, v1, Prune);
        await FollowAsync(fifth, v1);
        var t5 = await TotalsAsync(v1);
        IntOrNull(t5, "following").Should().Be(5);
        IntOrNull(t5, "having").Should().Be(5);
        IntOrNull(t5, "worksTaken").Should().Be(1);
        t5.GetProperty("works").EnumerateArray().Select(w => w.GetProperty("farmers").GetInt32()).Should().Equal(5);

        // The function itself never returns a number under five, whoever calls it.
        var scope = await SeedFarmerAsync();
        (await CallAsync(v1, null, scope)).Select(r => r.Farmers).Should().OnlyContain(n => n >= 5);
    }

    [Fact]
    public async Task TestFarmsExcluded()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await ImportFourAsync();
        await ApproveAsync(v1);
        var four = new List<Farmer>();
        for (var i = 0; i < 4; i++)
        {
            var f = await SeedFarmerAsync();
            four.Add(f);
            await TakeAsync(f, v1, v1, Prune);
        }

        var x = await SeedFarmerAsync();
        await TakeAsync(x, v1, v1, Prune);

        // The control: before X is on the list, X is a farmer like any other, so the fifth makes five.
        IntOrNull(await TotalsAsync(v1), "following").Should().Be(5);

        await ListAsync(x);
        IntOrNull(await TotalsAsync(v1), "following").Should().BeNull("X is a listed test farm: four farmers are left");

        await UnlistAsync(x);
        IntOrNull(await TotalsAsync(v1), "following").Should().Be(5, "the list is the only thing that changed");
    }

    [Fact]
    public async Task NothingIdentifying()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var (_, body) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{a.V1}/totals", Owner, null);

        var seeded = a.F.Append(a.X).Append(a.Z).SelectMany(f => new[] { f.User, f.Farm, f.Plot, f.Cycle }).ToList();
        foreach (var id in seeded)
        {
            body.Should().NotContain(id.ToString(), "the answer carries counts, task keys and work names only");
        }

        // Every property name is one of the known ones: nothing else can carry an id, a person or a date of a farm.
        var root = Json(body);
        root.EnumerateObject().Select(p => p.Name).Should().BeSubsetOf(
            ["scheduleId", "chainId", "kind", "minimumFarmers", "following", "having", "worksTaken", "worksInSchedule", "worksTakenPercent", "works", "doneJobs", "heard", "checkedVersionId"]);
        foreach (var w in root.GetProperty("works").EnumerateArray())
        {
            w.EnumerateObject().Select(p => p.Name).Should().BeSubsetOf(["taskKey", "name", "farmers"]);
        }

        // Nor does the function: its columns are the four of an aggregate.
        var cols = await ScalarAsync("SELECT string_agg(a, ',' ORDER BY ord) FROM (SELECT unnest(proargnames) a, generate_subscripts(proargnames, 1) ord FROM pg_proc WHERE proname = 'schedule_chain_totals') s");
        cols.Should().Be("p_chain_id,p_task_keys,metric,task_key,farmers,amount");
    }

    [Fact]
    public async Task SampleHasNoTotals()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmerAsync();

        // The app's built-in sample (no row at all) and a thin library row (it stores no days): a sample, with no number of any kind.
        var thin = await SeedThinRowAsync("नमुना", ("छाटणी", 0));
        foreach (var id in new[] { BuiltInGrapes, thin })
        {
            var t = await TotalsAsync(id);
            t.GetProperty("kind").GetString().Should().Be("sample", $"{id}");
            foreach (var name in new[] { "following", "having", "worksTaken", "worksInSchedule", "worksTakenPercent", "doneJobs", "heard", "checkedVersionId" })
            {
                t.GetProperty(name).ValueKind.Should().Be(JsonValueKind.Null, $"a sample has no {name}");
            }

            t.GetProperty("works").GetArrayLength().Should().Be(0);
        }

        // An id nobody can see is answered like an unknown id.
        var (unknown, _) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{Guid.NewGuid()}/totals", Owner, null);
        unknown.Should().Be(HttpStatusCode.NotFound);
        var (anonymous, _) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{BuiltInGrapes}/totals", Guid.Empty, null);
        anonymous.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task NonPublicChain_NoTotals()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // A farm's OWN (Team) schedule, five farmers with works taken from it: still no number, by the route and by the function.
        var own = await SeedTemplateRowAsync("माझे शेड्यूल", TenantScope.Team, Owner);
        for (var i = 0; i < 5; i++)
        {
            var f = await SeedFarmerAsync();
            await TakeAsync(f, own, own, Prune);
            await FollowAsync(f, own);
        }

        var t = await TotalsAsync(own);
        t.GetProperty("kind").GetString().Should().Be("own");
        foreach (var name in new[] { "following", "having", "worksTaken", "doneJobs", "heard" })
        {
            t.GetProperty(name).ValueKind.Should().Be(JsonValueKind.Null, name);
        }

        var scope = await SeedFarmerAsync();
        (await CallAsync(own, null, scope)).Should().BeEmpty("the function itself returns nothing for a chain that is not Public");
    }

    // ---- the security proofs ------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task AppRole_StillSeesOnlyItsOwnFarms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();

        // After the migration, under farm A's scope the app role reads no row of another farm in any source table - and the reverse - and the positive control shows it reads its own.
        var tables = new (string Table, string FarmColumn)[]
        {
            ("ssf.own_schedule_items", "farm_id"), ("ssf.own_schedule_item_origins", "farm_id"), ("ssf.schedule_subscriptions", "farm_id"),
            ("ssf.schedule_owner_message_states", "farm_id"), ("ssf.planned_work", "farm_id"), ("ssf.farms", "\"Id\""),
        };
        foreach (var (mine, other) in new[] { (a.F[0], a.F[1]), (a.F[1], a.F[0]), (a.F[3], a.X) })
        {
            foreach (var (table, column) in tables)
            {
                (await AppCountAsync(mine, $"SELECT count(*) FROM {table} WHERE {column} = '{other.Farm}'")).Should().Be(0, $"{table}: farm {mine.Farm} must not read farm {other.Farm}");
                (await AppCountAsync(mine, $"SELECT count(*) FROM {table} WHERE {column} = '{mine.Farm}'")).Should().BeGreaterThan(0, $"{table}: the control, it reads its own");
            }
        }

        // The messages belong to a schedule: a farm that follows nothing of the chain sees none (Z), a follower sees them.
        (await AppCountAsync(a.Z, "SELECT count(*) FROM ssf.schedule_owner_messages")).Should().Be(0);
        (await AppCountAsync(a.F[0], "SELECT count(*) FROM ssf.schedule_owner_messages")).Should().BeGreaterThan(0);

        // The exclusion list is unreadable to the app role altogether.
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        (await ErrorOfAsync(db, "SELECT count(*) FROM ssf.schedule_totals_excluded_farms")).Should().StartWith("42501");
        (await ErrorOfAsync(db, $"INSERT INTO ssf.schedule_totals_excluded_farms (farm_id, reason, added_by) VALUES ('{Guid.NewGuid()}', 'x', 'x')")).Should().StartWith("42501");
    }

    [Fact]
    public async Task DirectCall_NeverReturnsUnderFive()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();

        // The app role, under a farm that holds nothing (Z), calls the function itself. The chain of the fixture answers the same aggregates; the numbers under five are not rows.
        var rows = await CallAsync(a.V1, FourKeys, a.Z);
        rows.Should().BeEquivalentTo(new[]
        {
            new CallRow("done", null, 5, 6),
            new CallRow("following", null, 7, 7),
            new CallRow("having", null, 7, 7),
            new CallRow("work", Prune, 7, 7),
            new CallRow("work", Spray, 5, 5),
            new CallRow("works_taken", null, 7, 3),
        });
        rows.Should().OnlyContain(r => r.Farmers >= 5, "no row carries a farmer count under five; the heard count (4) and t-water (4) are absent");

        // A chain of four farmers returns nothing at all.
        var v = await ImportFourAsync();
        await ApproveAsync(v);
        for (var i = 0; i < 4; i++)
        {
            var f = await SeedFarmerAsync();
            await TakeAsync(f, v, v, Prune);
            await FollowAsync(f, v);
        }

        (await CallAsync(v, FourKeys, a.Z)).Should().BeEmpty();
        (await CallAsync(v, null, a.Z)).Should().BeEmpty();
    }

    [Fact]
    public async Task DirectCall_SkipsListedFarms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v = await ImportFourAsync();
        await ApproveAsync(v);
        var scope = await SeedFarmerAsync();
        for (var i = 0; i < 4; i++)
        {
            await TakeAsync(await SeedFarmerAsync(), v, v, Prune);
        }

        var x = await SeedFarmerAsync();
        await TakeAsync(x, v, v, Prune);

        (await CallAsync(v, null, scope)).Should().ContainSingle(r => r.Metric == "following" && r.Farmers == 5, "the control: X is not listed yet");
        await ListAsync(x);
        (await CallAsync(v, null, scope)).Should().BeEmpty("X is listed: four farmers are left, so no row");
    }

    // ---- the role model -----------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Grants_ExecuteForAppRoleOnly_ListUnreadable()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await ScalarAsync("SELECT has_function_privilege('agrisync_app', 'ssf.schedule_chain_totals(uuid, text[])', 'EXECUTE')")).Should().Be("True");
        (await ScalarAsync("SELECT has_function_privilege('agrisync_readonly', 'ssf.schedule_chain_totals(uuid, text[])', 'EXECUTE')")).Should().Be("False");
        (await ScalarAsync("""
            SELECT count(*) FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = 'ssf.schedule_chain_totals(uuid, text[])'::regprocedure AND a.privilege_type = 'EXECUTE' AND a.grantee = 0
            """)).Should().Be("0", "EXECUTE is revoked from PUBLIC");
        (await ScalarAsync("SELECT prosecdef::text || ',' || coalesce(array_to_string(proconfig, ';'), '') || ',' || provolatile::text FROM pg_proc WHERE proname = 'schedule_chain_totals'"))
            .Should().Be("true,search_path=pg_catalog, ssf,s");

        foreach (var role in new[] { "agrisync_app", "agrisync_readonly" })
        {
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE" })
            {
                (await ScalarAsync($"SELECT has_table_privilege('{role}', 'ssf.schedule_totals_excluded_farms', '{privilege}')")).Should().Be("False", $"{role} {privilege}");
            }
        }

        (await ScalarAsync("SELECT relrowsecurity::text || ',' || relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.schedule_totals_excluded_farms'::regclass")).Should().Be("true,true");

        // Every extra policy is for the function's owner alone: no policy of this migration names PUBLIC or the app role.
        (await ScalarAsync("SELECT count(*) FROM pg_policies WHERE policyname = 'p_totals_owner_select' AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['agrisync_app']::name[])")).Should().Be("0");
        (await ScalarAsync("SELECT count(*) FROM pg_policies WHERE policyname = 'p_totals_owner_select'")).Should().Be("8", "the seven source tables and the exclusion list");
    }

    [Fact]
    public async Task Migration_Refuses_WhenAppCanMatchTheOwnerPolicy()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var runner = await ScalarAsync("SELECT current_user");
        var probe = "totals_probe_" + Guid.NewGuid().ToString("N")[..8];
        const string function = "ssf.schedule_chain_totals(uuid, text[])";
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        try
        {
            // The positive control: the real owner, and the app role is no member of it.
            (await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql)).Should().BeEmpty();

            // (1) The function is owned by the app role itself.
            await MustAsync(db, $"ALTER FUNCTION {function} OWNER TO agrisync_app");
            var one = await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql);
            one.Should().Contain("Schedule totals refused").And.Contain("agrisync_app").And.Contain("would match the owner-only read policies");

            // (2) The function is owned by a role the app role is a MEMBER of: a policy for the owner applies to its members too.
            await MustAsync(db, $"ALTER FUNCTION {function} OWNER TO {runner}");
            await MustAsync(db, $"CREATE ROLE {probe} NOLOGIN");
            await MustAsync(db, $"GRANT {probe} TO agrisync_app");
            await MustAsync(db, $"ALTER FUNCTION {function} OWNER TO {probe}");
            var two = await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql);
            two.Should().Contain("Schedule totals refused").And.Contain(probe).And.Contain("would match the owner-only read policies");

            // Nothing was changed by either refusal: no policy names the probe or the app role.
            (await ScalarAsync($"SELECT count(*) FROM pg_policies WHERE policyname = 'p_totals_owner_select' AND roles @> ARRAY['{probe}']::name[]")).Should().Be("0");

            // (3) With the membership gone the same owner is fine.
            await MustAsync(db, $"REVOKE {probe} FROM agrisync_app");
            (await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql)).Should().BeEmpty();
            (await ScalarAsync($"SELECT count(*) FROM pg_policies WHERE policyname = 'p_totals_owner_select' AND roles @> ARRAY['{probe}']::name[]")).Should().Be("8");
        }
        finally
        {
            await ErrorOfAsync(db, $"ALTER FUNCTION {function} OWNER TO {runner}");
            await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql);
            await ErrorOfAsync(db, $"DROP ROLE IF EXISTS {probe}");
        }
    }

    [Fact]
    public async Task Function_WorksThroughOwnerPolicies_NotThroughSuperuserBypass()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var runner = await ScalarAsync("SELECT current_user");
        var probe = "totals_owner_" + Guid.NewGuid().ToString("N")[..8];
        const string function = "ssf.schedule_chain_totals(uuid, text[])";
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        try
        {
            // Production shape: the function is owned by a role that is NOT a superuser and bypasses nothing; only its own policies let it read across farms.
            await MustAsync(db, $"CREATE ROLE {probe} NOLOGIN");
            (await ScalarAsync($"SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = '{probe}'")).Should().Be("False");
            await MustAsync(db, $"GRANT USAGE ON SCHEMA ssf TO {probe}");
            // As the migration runner it would own every table; the policies of the other tables read farm_memberships and more, under the owner's own privileges.
            await MustAsync(db, $"GRANT SELECT ON ALL TABLES IN SCHEMA ssf TO {probe}");

            await MustAsync(db, $"ALTER FUNCTION {function} OWNER TO {probe}");

            // Before its policies exist it reads nothing (it is subject to row security like anyone): the aggregates are empty.
            await MustAsync(db, "DROP POLICY IF EXISTS p_totals_owner_select ON ssf.own_schedule_items");
            (await CallAsync(a.V1, FourKeys, a.F[0])).Should().BeEmpty("the owner is not exempt: with no policy of its own it reads only the caller's farm, one farmer, under five");

            // The migration's own policy step, run for this owner.
            (await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql)).Should().BeEmpty();
            (await CallAsync(a.V1, FourKeys, a.Z)).Should().Contain(r => r.Metric == "following" && r.Farmers == 7).And.Contain(r => r.Metric == "done" && r.Amount == 6);

            // And the app role, scoped to one farm, still reads only that farm.
            (await AppCountAsync(a.F[0], $"SELECT count(*) FROM ssf.own_schedule_items WHERE farm_id <> '{a.F[0].Farm}'")).Should().Be(0);
        }
        finally
        {
            await ErrorOfAsync(db, $"ALTER FUNCTION {function} OWNER TO {runner}");
            await ErrorOfAsync(db, ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.OwnerPoliciesSql);
            await ErrorOfAsync(db, $"DROP OWNED BY {probe}");
            await ErrorOfAsync(db, $"DROP ROLE IF EXISTS {probe}");
        }
    }

    [Fact]
    public async Task Down_Refuses_WhileTheListHasRows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var sql = ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleTotals.DownRefusalSql;
        sql.Should().NotContain("'s ", "an apostrophe inside a SQL string literal is a syntax error in a text that is run as one statement");
        sql.Count(c => c == '\'').Should().Be(sql.Count(c => c == '\'') / 2 * 2, "quotes are in pairs");

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        (await ErrorOfAsync(db, sql)).Should().BeEmpty("the list is empty: Down may run");

        var farm = await SeedFarmerAsync(listed: true);
        var refusal = await ErrorOfAsync(db, sql);
        refusal.Should().Contain("Down refused").And.Contain("1 farm(s) are on the schedule totals exclusion list").And.Contain("Nothing changed");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_totals_excluded_farms")).Should().Be(1);

        await UnlistAsync(farm);
        (await ErrorOfAsync(db, sql)).Should().BeEmpty();
    }
}
