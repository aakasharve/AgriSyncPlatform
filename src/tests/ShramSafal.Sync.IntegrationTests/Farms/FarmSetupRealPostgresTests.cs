// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; founder 27 Nov: "send it to server; the phone is only a door; this is the infrastructure")
//
// A farm's setup on the server, per farm: water sources with their motors, the power timetable, machines and each plot's water arrangement. Proven on a
// real Postgres AS THE RESTRICTED APPLICATION ROLE (doctrine E3 asserted first in every fact), through the real push door and the real pull route:
//   1. the owner's save reaches every member of the farm and nobody of another farm;
//   2. a push naming another farm is refused, and the database itself refuses a row placed across farms (row security and the place trigger);
//   3. who may: the existing "edit farm setup" authority from THIS farm's seat (a worker and a chosen-plots seat are refused by code AND words);
//   4. no silent overwrite: a stale revision is refused by name, the same bytes twice are saved once;
//   5. a removed motor takes its plot links with it, the plot's answer stays;
//   6. a source, motor or plot of another farm is refused by the handler;
//   7. a pull that does not ask has no `farmSetup` key (the byte-for-byte proof is in ScheduleMechanismSwitchRealPostgresTests);
//   8. the migration: no DELETE or TRUNCATE for the application role, FORCE row security, and Down() refuses while a row exists;
//   9. two saves landing at once: the second is answered ChangedElsewhere and its transaction stays usable.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Farms;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmSetupRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string ConflictCode = "ShramSafal.FarmSetup.Conflict";
    private const string ConflictWords = "This was changed from another phone first. Nothing was saved.";
    private const string ForbiddenCode = "ShramSafal.Forbidden";

    private static readonly Guid Well = Guid.Parse("d9aa0000-0000-4000-8000-000000000001");
    private static readonly Guid Motor1 = Guid.Parse("d9aa0000-0000-4000-8000-000000000011");
    private static readonly Guid Motor2 = Guid.Parse("d9aa0000-0000-4000-8000-000000000012");
    private static readonly Guid Tractor = Guid.Parse("d9aa0000-0000-4000-8000-000000000021");
    private static readonly Guid WellB = Guid.Parse("d9bb0000-0000-4000-8000-000000000001");
    private static readonly Guid MotorB = Guid.Parse("d9bb0000-0000-4000-8000-000000000011");

    private static readonly string[] Tables =
        ["farm_water_sources", "farm_motors", "farm_power_times", "farm_machines", "plot_water_setups", "plot_water_links"];

    private const string Timetable = """
        {"singlePhase":{"patternMode":"FIXED_WEEKLY","alternateWeeklyPattern":false,
          "weekAOffWindows":[{"id":"w1","startTime":"06:00","endTime":"14:00","repeatRule":"WEEKLY","days":["Mon","Tue"]}]},
         "threePhase":{"patternMode":"ROTATIONAL","alternateWeeklyPattern":true,"weekAOffWindows":[]}}
        """;

    // ── payloads, exactly as the sync contract's Zod shapes ──────────────────────────────────────────────

    private static Dictionary<string, object?> MotorOf(Guid id, string name, decimal hp = 5m, bool drip = false)
    {
        var motor = new Dictionary<string, object?> { ["motorId"] = id, ["name"] = name, ["hp"] = hp, ["phase"] = 3, ["powerSource"] = "mseb" };
        if (drip)
        {
            motor["drip"] = new Dictionary<string, object?> { ["pipeSize"] = "16mm", ["hasFilter"] = true, ["flowLitresPerHour"] = 4 };
        }

        return motor;
    }

    private static Dictionary<string, object?> SourcePayload(Guid farm, Guid id, int baseRevision, string name, params Dictionary<string, object?>[] motors) => new()
    {
        ["farmId"] = farm,
        ["waterSourceId"] = id,
        ["baseRevision"] = baseRevision,
        ["name"] = name,
        ["sourceType"] = "well",
        ["isAvailable"] = true,
        ["motors"] = motors,
    };

    private static Dictionary<string, object?> PlotWaterPayload(Guid farm, Guid plot, int baseRevision, string method, params (Guid Source, Guid? Motor)[] links) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["baseRevision"] = baseRevision,
        ["method"] = method,
        ["links"] = links.Select(l =>
        {
            var link = new Dictionary<string, object?> { ["waterSourceId"] = l.Source };
            if (l.Motor is { } motor)
            {
                link["motorId"] = motor;
            }

            return link;
        }).ToArray(),
    };

    private static Dictionary<string, object?> MachinePayload(Guid farm, Guid id, int baseRevision, string name) => new()
    {
        ["farmId"] = farm,
        ["machineId"] = id,
        ["baseRevision"] = baseRevision,
        ["name"] = name,
        ["machineType"] = "tractor",
        ["ownership"] = "owned",
    };

    private static Dictionary<string, object?> PowerPayload(Guid farm, int baseRevision, string timetable) => new()
    {
        ["farmId"] = farm,
        ["baseRevision"] = baseRevision,
        ["timetable"] = JsonDocument.Parse(timetable).RootElement.Clone(),
    };

    /// <summary>A pull that ASKS for the farm's setup (<c>farmSetup=1</c>), from the beginning, as a phone sends it.</summary>
    private async Task<(string Body, JsonElement Root)> PullSetupAsync(Guid user, string ask = "&farmSetup=1")
    {
        using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z" + ask, user);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return (body, JsonDocument.Parse(body).RootElement.Clone());
    }

    private static JsonElement SetupOf(JsonElement root, Guid farm) =>
        root.GetProperty("farmSetup").EnumerateArray().Single(f => f.GetProperty("farmId").GetGuid() == farm);

    /// <summary>One statement as the application role in one transaction carrying a request's scope; the SQLSTATE of a refusal, or null. Rolled back.</summary>
    private async Task<string?> AppErrorAsync(Guid? farm, Guid? user, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ExecAsync(db, "SELECT set_config('agrisync.farm_id', @farm, true), set_config('agrisync.user_id', @user, true)",
            ("farm", farm?.ToString() ?? string.Empty), ("user", user?.ToString() ?? string.Empty));
        try
        {
            await ExecAsync(db, sql, args);
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    private async Task<long> CountAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<string?> TextAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return (await cmd.ExecuteScalarAsync())?.ToString();
    }

    /// <summary>Farm A with one of everything: a well with two motors, a timetable, a tractor, and plot A watered by drip through motor 1.</summary>
    private async Task SeedFarmASetupAsync()
    {
        await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-well",
            SourcePayload(FarmA, Well, 0, "मुख्य विहीर", MotorOf(Motor1, "५ एचपी", 5m, drip: true), MotorOf(Motor2, "७.५ एचपी", 7.5m)));
        await PushAppliedAsync(Owner, "farmsetup.power_times.set", "d9-power", PowerPayload(FarmA, 0, Timetable));
        await PushAppliedAsync(Owner, "farmsetup.machine.save", "d9-tractor", MachinePayload(FarmA, Tractor, 0, "महिंद्रा 575"));
        await PushAppliedAsync(Owner, "farmsetup.plot_water.set", "d9-plot-water", PlotWaterPayload(FarmA, PlotA, 0, "drip", (Well, Motor1)));
    }

    // ── 1 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_owners_setup_reaches_every_member_of_the_farm_and_nobody_of_another_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var saved = await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-well",
            SourcePayload(FarmA, Well, 0, "मुख्य विहीर", MotorOf(Motor1, "५ एचपी", 5m, drip: true), MotorOf(Motor2, "७.५ एचपी", 7.5m)));
        JsonSerializer.Serialize(saved.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Should().Contain(Well.ToString()).And.Contain("\"revision\":1");
        await PushAppliedAsync(Owner, "farmsetup.power_times.set", "d9-power", PowerPayload(FarmA, 0, Timetable));
        await PushAppliedAsync(Owner, "farmsetup.machine.save", "d9-tractor", MachinePayload(FarmA, Tractor, 0, "महिंद्रा 575"));
        await PushAppliedAsync(Owner, "farmsetup.plot_water.set", "d9-plot-water", PlotWaterPayload(FarmA, PlotA, 0, "drip", (Well, Motor1)));

        // A worker of farm A (an Active member with no authority at all) reads the whole setup.
        foreach (var reader in new[] { Owner, Worker, CoOwner })
        {
            var (_, root) = await PullSetupAsync(reader);
            var setup = SetupOf(root, FarmA);
            if (reader == Worker)
            {
                Output.WriteLine("[EVIDENCE] farmSetup entry as pulled: " + setup.GetRawText());
            }

            var source = setup.GetProperty("waterSources").EnumerateArray().Single();
            source.GetProperty("id").GetGuid().Should().Be(Well);
            source.GetProperty("revision").GetInt32().Should().Be(1);
            source.GetProperty("name").GetString().Should().Be("मुख्य विहीर");
            source.GetProperty("sourceType").GetString().Should().Be("well");
            source.GetProperty("isAvailable").GetBoolean().Should().BeTrue();
            source.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);
            var motors = source.GetProperty("motors").EnumerateArray().ToList();
            motors.Select(m => m.GetProperty("id").GetGuid()).Should().BeEquivalentTo([Motor1, Motor2]);
            var first = motors.Single(m => m.GetProperty("id").GetGuid() == Motor1);
            first.GetProperty("hp").GetDecimal().Should().Be(5m);
            first.GetProperty("phase").GetInt32().Should().Be(3);
            first.GetProperty("powerSource").GetString().Should().Be("mseb");
            first.GetProperty("drip").GetProperty("pipeSize").GetString().Should().Be("16mm");
            first.GetProperty("drip").GetProperty("hasFilter").GetBoolean().Should().BeTrue();
            first.GetProperty("drip").GetProperty("flowLitresPerHour").GetDecimal().Should().Be(4m);
            motors.Single(m => m.GetProperty("id").GetGuid() == Motor2).GetProperty("drip").ValueKind.Should().Be(JsonValueKind.Null);

            var power = setup.GetProperty("powerTimes");
            power.GetProperty("revision").GetInt32().Should().Be(1);
            power.GetProperty("timetable").GetProperty("singlePhase").GetProperty("weekAOffWindows")[0].GetProperty("startTime").GetString().Should().Be("06:00");
            power.GetProperty("timetable").GetProperty("threePhase").GetProperty("weekBOffWindows").GetArrayLength().Should().Be(0);

            var machine = setup.GetProperty("machines").EnumerateArray().Single();
            machine.GetProperty("id").GetGuid().Should().Be(Tractor);
            machine.GetProperty("machineType").GetString().Should().Be("tractor");
            machine.GetProperty("hp").ValueKind.Should().Be(JsonValueKind.Null, "an optional detail that was not given is unknown, never 0");

            var plotWater = setup.GetProperty("plotWater").EnumerateArray().Single();
            plotWater.GetProperty("plotId").GetGuid().Should().Be(PlotA);
            plotWater.GetProperty("method").GetString().Should().Be("drip");
            var link = plotWater.GetProperty("links").EnumerateArray().Single();
            link.GetProperty("waterSourceId").GetGuid().Should().Be(Well);
            link.GetProperty("motorId").GetGuid().Should().Be(Motor1);
        }

        // The owner of farm B: one entry, his own farm, with nothing in it (so "empty" is told apart from "not sent"), and nothing of farm A anywhere.
        var (bodyB, rootB) = await PullSetupAsync(OwnerB);
        rootB.GetProperty("farmSetup").EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid()).Should().Equal(FarmB);
        var empty = SetupOf(rootB, FarmB);
        empty.GetProperty("waterSources").GetArrayLength().Should().Be(0);
        empty.GetProperty("powerTimes").ValueKind.Should().Be(JsonValueKind.Null);
        empty.GetProperty("machines").GetArrayLength().Should().Be(0);
        empty.GetProperty("plotWater").GetArrayLength().Should().Be(0);
        foreach (var id in new[] { Well, Motor1, Motor2, Tractor })
        {
            bodyB.Should().NotContain(id.ToString());
        }

        // A paused seat reads no farm: no entry at all.
        var (_, paused) = await PullSetupAsync(Paused);
        paused.GetProperty("farmSetup").GetArrayLength().Should().Be(0);

        // One audit row per change, with the farm, the actor and before / after.
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND entity_type IN ('FarmWaterSource','FarmPowerTimes','FarmMachine','PlotWaterSetup')", ("f", FarmA)))
            .Should().Be(4);
        var audit = await TextAsync("SELECT payload::text FROM ssf.audit_events WHERE entity_type = 'FarmWaterSource' AND entity_id = @id", ("id", Well));
        // (the audit payload is stored with Marathi as \u escapes)
        System.Text.RegularExpressions.Regex.Unescape(audit!).Replace(" ", string.Empty).Should().Contain("\"before\":null").And.Contain("मुख्यविहीर");
    }

    // ── 2 and 8 ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task App_role_cannot_delete_and_other_farm_cannot_insert()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmASetupAsync();
        await PushAppliedAsync(OwnerB, "farmsetup.water_source.save", "d9-well-b", SourcePayload(FarmB, WellB, 0, "दुसऱ्याची विहीर", MotorOf(MotorB, "मोटर B")));

        // A push by farm B's owner that NAMES farm A is refused at the door (he is no member), and farm A's rows are unchanged.
        var before = await TextAsync("SELECT string_agg(row_to_json(s)::text, '|' ORDER BY id) FROM ssf.farm_water_sources s WHERE farm_id = @f", ("f", FarmA));
        var forged = await PushAsync(OwnerB, "farmsetup.water_source.save", "d9-forged", SourcePayload(FarmA, Well, 1, "चोरलेली"));
        forged.Status.Should().NotBe("applied");
        forged.ErrorCode.Should().Be(ForbiddenCode);
        forged.ErrorMessage.Should().Be("User is not a member of the target farm.");
        var forgedRemove = await PushAsync(OwnerB, "farmsetup.water_source.remove", "d9-forged-remove",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["waterSourceId"] = Well, ["baseRevision"] = 1 });
        forgedRemove.ErrorCode.Should().Be(ForbiddenCode);
        (await TextAsync("SELECT string_agg(row_to_json(s)::text, '|' ORDER BY id) FROM ssf.farm_water_sources s WHERE farm_id = @f", ("f", FarmA))).Should().Be(before);

        // The database itself: under farm B's scope a row placed on farm A is refused by row security (42501) on every one of the six tables.
        const string who = "'00000000-0000-4000-8000-000000000001', NOW(), '00000000-0000-4000-8000-000000000001', NOW()";
        var inserts = new Dictionary<string, string>
        {
            ["farm_water_sources"] = $"INSERT INTO ssf.farm_water_sources (id, farm_id, name, source_type, is_available, revision, state, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc) VALUES (gen_random_uuid(), @farm, 'x', 'well', true, 1, 0, {who})",
            ["farm_motors"] = $"INSERT INTO ssf.farm_motors (id, farm_id, water_source_id, name, hp, phase, power_source, has_drip, state, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc) VALUES (gen_random_uuid(), @farm, @source, 'x', 5, 3, 'mseb', false, 0, {who})",
            ["farm_power_times"] = $"INSERT INTO ssf.farm_power_times (farm_id, content, content_hash, revision, updated_by_user_id, updated_at_utc) VALUES (@farm, '{{}}'::jsonb, '{new string('a', 64)}', 1, '00000000-0000-4000-8000-000000000001', NOW())",
            ["farm_machines"] = $"INSERT INTO ssf.farm_machines (id, farm_id, name, machine_type, ownership, revision, state, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc) VALUES (gen_random_uuid(), @farm, 'x', 'tractor', 'owned', 1, 0, {who})",
            ["plot_water_setups"] = "INSERT INTO ssf.plot_water_setups (plot_id, farm_id, irrigation_method, revision, updated_by_user_id, updated_at_utc) VALUES (@plot, @farm, 'drip', 1, '00000000-0000-4000-8000-000000000001', NOW())",
            ["plot_water_links"] = $"INSERT INTO ssf.plot_water_links (id, farm_id, plot_id, water_source_id, motor_id, state, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc) VALUES (gen_random_uuid(), @farm, @plot, @source, NULL, 0, {who})",
        };
        inserts.Keys.Should().BeEquivalentTo(Tables);
        foreach (var (table, sql) in inserts)
        {
            (await AppErrorAsync(FarmB, OwnerB, sql, ("farm", FarmA), ("source", Well), ("plot", PlotB)))
                .Should().Be("42501", $"{table}: a row of farm A cannot be written under farm B's scope");
        }

        // The place trigger: a row on the caller's OWN farm that points across the wall is refused too (42501), whatever the application checked.
        (await AppErrorAsync(FarmB, OwnerB, inserts["farm_motors"], ("farm", FarmB), ("source", Well)))
            .Should().Be("42501", "a motor whose source is another farm's");
        (await AppErrorAsync(FarmB, OwnerB, inserts["plot_water_setups"], ("farm", FarmB), ("plot", PlotA)))
            .Should().Be("42501", "a plot-water row whose plot is another farm's");
        (await AppErrorAsync(FarmB, OwnerB, inserts["plot_water_links"], ("farm", FarmB), ("plot", PlotB), ("source", Well)))
            .Should().Be("42501", "a link whose source is another farm's");
        (await AppErrorAsync(FarmB, OwnerB,
            inserts["plot_water_links"].Replace("NULL, 0,", "@motor, 0,"), ("farm", FarmB), ("plot", PlotB), ("source", WellB), ("motor", Motor1)))
            .Should().Be("42501", "a link whose motor is another farm's");
        // The same statements with everything on farm B go in (so the refusals above are the wall, not a broken statement).
        (await AppErrorAsync(FarmB, OwnerB, inserts["farm_motors"], ("farm", FarmB), ("source", WellB))).Should().BeNull();
        (await AppErrorAsync(FarmB, OwnerB, inserts["plot_water_links"], ("farm", FarmB), ("plot", PlotB), ("source", WellB))).Should().BeNull();

        // Under farm B's scope farm A's rows do not exist for the application role; with no scope at all nothing does.
        foreach (var table in Tables)
        {
            (await AppErrorAsync(FarmB, OwnerB, $"DO $$ BEGIN IF EXISTS (SELECT 1 FROM ssf.{table} WHERE farm_id = '{FarmA}') THEN RAISE EXCEPTION 'leak' USING ERRCODE = 'P0001'; END IF; END $$"))
                .Should().BeNull($"{table}: farm A's rows are invisible to farm B");

            // A removal is a state: the application role holds no DELETE and no TRUNCATE, and row security is FORCED.
            (await AppErrorAsync(FarmA, Owner, $"DELETE FROM ssf.{table}")).Should().Be("42501", $"{table}: no DELETE");
            (await AppErrorAsync(FarmA, Owner, $"TRUNCATE ssf.{table}")).Should().Be("42501", $"{table}: no TRUNCATE");
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE" })
            {
                (await TextAsync($"SELECT has_table_privilege('{AppRoleUser}', 'ssf.{table}', '{privilege}')::text")).Should().Be("true", $"{table} {privilege}");
            }

            (await TextAsync($"SELECT relrowsecurity::text || ',' || relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.{table}'::regclass"))
                .Should().Be("true,true", $"{table}: FORCE row security");
            (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t AND policyname IN ('p_tenant_' || @t, 'p_user_select_' || @t)", ("t", table)))
                .Should().Be(2, $"{table}: the two standard policies");
            (await CountAsync("SELECT count(*) FROM pg_constraint WHERE conrelid = ('ssf.' || @t)::regclass AND contype = 'f'", ("t", table)))
                .Should().Be(0, $"{table}: no foreign key, on purpose");
        }

        // Down() refuses while any row exists, and its words read as a sentence (the migration's own text, run as the migration runner).
        var down = (string?)Type.GetType("ShramSafal.Infrastructure.Persistence.Migrations.AddFarmSetup, ShramSafal.Infrastructure")
            ?.GetField("DownRefusalSql", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)?.GetRawConstantValue();
        down.Should().NotBeNull("migration AddFarmSetup carries its Down() refusal as DownRefusalSql");
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            var refused = await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(db, down!));
            Output.WriteLine("[EVIDENCE] Down() refusal: " + refused.MessageText);
            refused.MessageText.Should().StartWith("Down refused: ").And.EndWith("Nothing changed.");
            refused.MessageText.Should().MatchRegex(@"^Down refused: \d+ farm setup row\(s\) exist \(2 water source\(s\), 3 motor\(s\), 1 power timetable\(s\), 1 machine\(s\), 1 plot water answer\(s\), 1 plot water link\(s\)\)");
            (await CountAsync("SELECT count(*) FROM ssf.farm_water_sources")).Should().Be(2);
        }
    }

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_member_without_edit_farm_setup_is_refused_Forbidden()
    {
        await AssertAppRoleIsNotVacuousAsync();
        const string words = "User is not allowed to modify this farm.";

        // A worker: an Active member, reads the setup, holds no authority. Every one of the six doors refuses him, by code AND words.
        var doors = new (string Mutation, Dictionary<string, object?> Payload)[]
        {
            ("farmsetup.water_source.save", SourcePayload(FarmA, Well, 0, "कामगाराची विहीर")),
            ("farmsetup.water_source.remove", new() { ["farmId"] = FarmA, ["waterSourceId"] = Well, ["baseRevision"] = 1 }),
            ("farmsetup.power_times.set", PowerPayload(FarmA, 0, Timetable)),
            ("farmsetup.machine.save", MachinePayload(FarmA, Tractor, 0, "कामगाराचं यंत्र")),
            ("farmsetup.machine.remove", new() { ["farmId"] = FarmA, ["machineId"] = Tractor, ["baseRevision"] = 1 }),
            ("farmsetup.plot_water.set", PlotWaterPayload(FarmA, PlotA, 0, "drip")),
        };
        foreach (var (mutation, payload) in doors)
        {
            var refused = await PushAsync(Worker, mutation, "d9-worker-" + mutation, payload);
            refused.Status.Should().NotBe("applied", mutation);
            refused.ErrorCode.Should().Be(ForbiddenCode, mutation);
            refused.ErrorMessage.Should().Be(words, mutation);
        }

        // A seat that HOLDS the authority but covers only chosen plots: the farm's setup is not his to change.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.EditFarmSetup);
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { PlotA } }))
        {
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        var chosen = await PushAsync(Mukadam, "farmsetup.water_source.save", "d9-chosen", SourcePayload(FarmA, Well, 0, "निवडक प्लॉटची विहीर"));
        chosen.Status.Should().NotBe("applied");
        chosen.ErrorCode.Should().Be(ForbiddenCode);
        chosen.ErrorMessage.Should().Be(words);

        // A paused seat is no member at all.
        var paused = await PushAsync(Paused, "farmsetup.machine.save", "d9-paused", MachinePayload(FarmA, Tractor, 0, "थांबलेला"));
        paused.ErrorCode.Should().Be(ForbiddenCode);

        foreach (var table in Tables)
        {
            (await CountAsync($"SELECT count(*) FROM ssf.{table}")).Should().Be(0, $"{table}: nothing was written by a refused change");
        }

        // The registrant succeeds; so does a seat that holds the authority and covers every plot (the सहमालक keeps "edit farm setup").
        await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-owner", SourcePayload(FarmA, Well, 0, "मालकाची विहीर"));
        await PushAppliedAsync(CoOwner, "farmsetup.machine.save", "d9-coowner", MachinePayload(FarmA, Tractor, 0, "सहमालकाचं यंत्र"));
        (await TextAsync("SELECT actor_role FROM ssf.audit_events WHERE entity_type = 'FarmMachine' AND entity_id = @id", ("id", Tractor))).Should().Be("SecondaryOwner");
    }

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_stale_revision_is_refused_by_name_and_the_same_bytes_twice_are_saved_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-new", SourcePayload(FarmA, Well, 0, "मुख्य विहीर", MotorOf(Motor1, "मोटर")));

        // Two phones read revision 1. The first edit makes 2.
        var first = await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-phone-1", SourcePayload(FarmA, Well, 1, "पहिल्या फोनचा बदल", MotorOf(Motor1, "मोटर")));
        JsonSerializer.Serialize(first.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Should().Contain("\"revision\":2");

        // The second edit still says 1: refused by name, and the row still holds the first edit.
        var second = await PushAsync(CoOwner, "farmsetup.water_source.save", "d9-phone-2", SourcePayload(FarmA, Well, 1, "दुसऱ्या फोनचा बदल", MotorOf(Motor1, "मोटर")));
        second.Status.Should().NotBe("applied");
        second.ErrorCode.Should().Be(ConflictCode);
        second.ErrorMessage.Should().Be(ConflictWords);
        (await TextAsync("SELECT name || '|' || revision FROM ssf.farm_water_sources WHERE id = @id", ("id", Well))).Should().Be("पहिल्या फोनचा बदल|2");

        // The same bytes under a NEW request id (the first answer was lost and the phone re-made the request): answered as saved, written once.
        var again = await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-phone-1-again", SourcePayload(FarmA, Well, 1, "पहिल्या फोनचा बदल", MotorOf(Motor1, "मोटर")));
        JsonSerializer.Serialize(again.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Should().Contain("\"revision\":2");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'FarmWaterSource' AND entity_id = @id", ("id", Well)))
            .Should().Be(2, "one audit row per real change: the first save and the first edit, never the re-send or the refused edit");

        // A removal with a stale revision is refused the same way; with the current one it is a state, and the next pull no longer carries the source.
        var staleRemove = await PushAsync(Owner, "farmsetup.water_source.remove", "d9-remove-stale",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["waterSourceId"] = Well, ["baseRevision"] = 1 });
        staleRemove.ErrorCode.Should().Be(ConflictCode);
        await PushAppliedAsync(Owner, "farmsetup.water_source.remove", "d9-remove",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["waterSourceId"] = Well, ["baseRevision"] = 2 });
        (await TextAsync("SELECT state || '|' || revision FROM ssf.farm_water_sources WHERE id = @id", ("id", Well))).Should().Be("1|3");
        (await CountAsync("SELECT count(*) FROM ssf.farm_motors WHERE water_source_id = @id AND state = 1", ("id", Well))).Should().Be(1);
        var (_, root) = await PullSetupAsync(Owner);
        SetupOf(root, FarmA).GetProperty("waterSources").GetArrayLength().Should().Be(0, "only active rows are sent");

        // Content that does not hold together is refused by its rule's name; a payload with a key the contract does not know is refused whole.
        var badType = SourcePayload(FarmA, Guid.NewGuid(), 0, "नदी");
        badType["sourceType"] = "river";
        var invalid = await PushAsync(Owner, "farmsetup.water_source.save", "d9-bad-type", badType);
        invalid.ErrorCode.Should().Be("ShramSafal.FarmSetupInvalid");
        invalid.ErrorMessage.Should().Be("FarmWaterSourceType: A water source is a well, a borewell, a canal, a farm pond or a tanker. Nothing was saved.");
        var badTime = await PushAsync(Owner, "farmsetup.power_times.set", "d9-bad-time", PowerPayload(FarmA, 0, Timetable.Replace("06:00", "25:00")));
        badTime.ErrorCode.Should().Be("ShramSafal.FarmSetupInvalid");
        badTime.ErrorMessage.Should().Be("PowerTimesTime: An off-window's start and end are times of day written HH:mm (00:00 to 23:59). Nothing was saved.");
        var extraKey = SourcePayload(FarmA, Guid.NewGuid(), 0, "जास्तीची किल्ली");
        extraKey["schedule"] = "x";
        (await PushAsync(Owner, "farmsetup.water_source.save", "d9-extra-key", extraKey)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        var extraMotorKey = SourcePayload(FarmA, Guid.NewGuid(), 0, "जास्तीची किल्ली", MotorOf(Guid.NewGuid(), "मोटर"));
        ((Dictionary<string, object?>[])extraMotorKey["motors"]!)[0]["schedule"] = "x";
        (await PushAsync(Owner, "farmsetup.water_source.save", "d9-extra-motor-key", extraMotorKey)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        (await CountAsync("SELECT count(*) FROM ssf.farm_water_sources")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.farm_power_times")).Should().Be(0);
    }

    // ── 5 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Removing_a_motor_removes_its_plot_links_and_the_plots_answer_stays()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmASetupAsync();

        // The source is saved again without motor 1 (the one plot A is watered through).
        await PushAppliedAsync(Owner, "farmsetup.water_source.save", "d9-drop-motor", SourcePayload(FarmA, Well, 1, "मुख्य विहीर", MotorOf(Motor2, "७.५ एचपी", 7.5m)));

        var (body, root) = await PullSetupAsync(Worker);
        var setup = SetupOf(root, FarmA);
        setup.GetProperty("waterSources")[0].GetProperty("motors").EnumerateArray().Select(m => m.GetProperty("id").GetGuid()).Should().Equal(Motor2);
        var plot = setup.GetProperty("plotWater").EnumerateArray().Single();
        plot.GetProperty("plotId").GetGuid().Should().Be(PlotA);
        plot.GetProperty("method").GetString().Should().Be("drip", "the plot's answer stays");
        plot.GetProperty("links").GetArrayLength().Should().Be(0, "the link went with its motor: the plot shows बाकी, never a dead name");
        plot.GetProperty("revision").GetInt32().Should().Be(2, "the plot's arrangement changed, so its revision moved");
        body.Should().NotContain(Motor1.ToString());
        (await TextAsync("SELECT state::text FROM ssf.plot_water_links WHERE plot_id = @p AND motor_id = @m", ("p", PlotA), ("m", Motor1))).Should().Be("1", "the link row stays, removed");

        // A plot may be saved with a method and no link, and "no water" is its own answer.
        await PushAppliedAsync(Owner, "farmsetup.plot_water.set", "d9-flood", PlotWaterPayload(FarmA, PlotA, 2, "flood", (Well, null)));
        await PushAppliedAsync(Owner, "farmsetup.water_source.remove", "d9-remove-well",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["waterSourceId"] = Well, ["baseRevision"] = 2 });
        var (_, after) = await PullSetupAsync(Owner);
        var gone = SetupOf(after, FarmA).GetProperty("plotWater").EnumerateArray().Single();
        gone.GetProperty("method").GetString().Should().Be("flood");
        gone.GetProperty("links").GetArrayLength().Should().Be(0);
        gone.GetProperty("revision").GetInt32().Should().Be(4);
        await PushAppliedAsync(Owner, "farmsetup.plot_water.set", "d9-none", PlotWaterPayload(FarmA, PlotA, 4, "none"));
        var noneWithLink = await PushAsync(Owner, "farmsetup.plot_water.set", "d9-none-link", PlotWaterPayload(FarmA, PlotA, 5, "none", (Well, null)));
        noneWithLink.Status.Should().NotBe("applied");
        noneWithLink.ErrorCode.Should().Be(ConflictCode, "the well was removed: a link to it names nothing in the farm's setup");
    }

    // ── 6 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_source_motor_or_plot_of_another_farm_is_refused_by_the_handler()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmASetupAsync();
        await PushAppliedAsync(OwnerB, "farmsetup.water_source.save", "d9-well-b", SourcePayload(FarmB, WellB, 0, "दुसऱ्याची विहीर", MotorOf(MotorB, "मोटर B")));
        var rowsB = await TextAsync("SELECT (SELECT string_agg(row_to_json(s)::text, '|') FROM ssf.farm_water_sources s WHERE farm_id = @f) || (SELECT string_agg(row_to_json(m)::text, '|') FROM ssf.farm_motors m WHERE farm_id = @f)", ("f", FarmB));

        // Farm A's owner names farm B's plot: not found, exactly as a plot that does not exist.
        var plot = await PushAsync(Owner, "farmsetup.plot_water.set", "d9-plot-b", PlotWaterPayload(FarmA, PlotB, 0, "drip"));
        plot.Status.Should().NotBe("applied");
        plot.ErrorCode.Should().BeOneOf("ShramSafal.PlotNotFound", "ShramSafal.PlotScope.Forbidden");
        plot.ErrorCode.Should().Be("ShramSafal.PlotNotFound");
        plot.ErrorMessage.Should().Be("Plot was not found.");

        // A link naming farm B's source, or farm B's motor on farm A's source: nothing of that name is in farm A's setup.
        var linkSource = await PushAsync(Owner, "farmsetup.plot_water.set", "d9-link-b", PlotWaterPayload(FarmA, PlotA, 1, "drip", (WellB, null)));
        linkSource.ErrorCode.Should().Be(ConflictCode);
        linkSource.ErrorMessage.Should().Be(ConflictWords);
        var linkMotor = await PushAsync(Owner, "farmsetup.plot_water.set", "d9-link-motor-b", PlotWaterPayload(FarmA, PlotA, 1, "drip", (Well, MotorB)));
        linkMotor.ErrorCode.Should().Be(ConflictCode);

        // An id farm B already holds, sent as a new source of farm A (and as a new motor of farm A's well): refused, and farm B's rows are untouched.
        var takeSource = await PushAsync(Owner, "farmsetup.water_source.save", "d9-take-source", SourcePayload(FarmA, WellB, 0, "घेतलेली"));
        takeSource.Status.Should().NotBe("applied");
        takeSource.ErrorCode.Should().Be(ConflictCode);
        var takeMotor = await PushAsync(Owner, "farmsetup.water_source.save", "d9-take-motor",
            SourcePayload(FarmA, Well, 1, "मुख्य विहीर", MotorOf(Motor1, "५ एचपी", 5m, drip: true), MotorOf(Motor2, "७.५ एचपी", 7.5m), MotorOf(MotorB, "घेतलेली मोटर")));
        takeMotor.Status.Should().NotBe("applied");
        takeMotor.ErrorCode.Should().Be(ConflictCode);
        (await TextAsync("SELECT (SELECT string_agg(row_to_json(s)::text, '|') FROM ssf.farm_water_sources s WHERE farm_id = @f) || (SELECT string_agg(row_to_json(m)::text, '|') FROM ssf.farm_motors m WHERE farm_id = @f)", ("f", FarmB)))
            .Should().Be(rowsB);
        (await TextAsync("SELECT revision::text FROM ssf.farm_water_sources WHERE id = @id", ("id", Well))).Should().Be("1", "the refused save left farm A's well as it was");
        (await CountAsync("SELECT count(*) FROM ssf.farm_motors WHERE farm_id = @f", ("f", FarmA))).Should().Be(2);

        // The batch that carried a refused change still works afterwards (the refusal left the connection usable).
        await PushAppliedAsync(Owner, "farmsetup.machine.save", "d9-after-refusal", MachinePayload(FarmA, Guid.NewGuid(), 0, "नंतरचं यंत्र"));
    }

    // ── 7 ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_pull_that_does_not_ask_has_no_farmSetup_key()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmASetupAsync();

        // The phone asks with farmSetup=1; an unreadable value says nothing and never refuses the pull (read leniently, like scheduleFormat).
        foreach (var ask in new[] { "", "&farmSetup=", "&farmSetup=abc", "&farmSetup=0", "&farmSetup=-1", "&farmSetup=99999999999999" })
        {
            var (body, root) = await PullSetupAsync(Owner, ask);
            root.TryGetProperty("farmSetup", out _).Should().BeFalse($"'{ask}' does not ask");
            body.Should().NotContain("farmSetup", $"'{ask}': never a key for a phone that did not ask");
            foreach (var id in new[] { Well, Motor1, Motor2, Tractor })
            {
                // (The audit rows of the saves are the farm's history and travel as before; the setup itself does not.)
                root.GetProperty("plots").GetRawText().Should().NotContain(id.ToString());
            }
        }

        foreach (var ask in new[] { "&farmSetup=1", "&farmSetup=2", "&farmSetup=1&scheduleFormat=2" })
        {
            var (_, root) = await PullSetupAsync(Owner, ask);
            SetupOf(root, FarmA).GetProperty("waterSources").GetArrayLength().Should().Be(1, $"'{ask}' asks");
        }

        // The 1.0.17 phone (it names its version, sends no farms and no farmSetup): the pull answers as it always did.
        using var old = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z", Owner, null, "1.0.17");
        (await old.Content.ReadAsStringAsync()).Should().NotContain("farmSetup");
    }

    // ── 9 (B3) ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Two_saves_at_once_one_is_ChangedElsewhere()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, "farmsetup.machine.save", "d9-race-seed", MachinePayload(FarmA, Tractor, 0, "महिंद्रा 575"));

        // Two requests, each in its own scope and transaction under farm A's scope, read the SAME revision and change it.
        await using var scope1 = HostServices.CreateAsyncScope();
        await using var scope2 = HostServices.CreateAsyncScope();
        var db1 = scope1.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var db2 = scope2.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await using var tx1 = await db1.Database.BeginTransactionAsync();
        await using var tx2 = await db2.Database.BeginTransactionAsync();
        (await scope1.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, Owner)).IsSuccess.Should().BeTrue();
        (await scope2.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, CoOwner)).IsSuccess.Should().BeTrue();
        var store1 = scope1.ServiceProvider.GetRequiredService<IFarmSetupStore>();
        var store2 = scope2.ServiceProvider.GetRequiredService<IFarmSetupStore>();
        var one = (await store1.GetMachineAsync(Tractor))!;
        var two = (await store2.GetMachineAsync(Tractor))!;
        one.Revision.Should().Be(1);
        two.Revision.Should().Be(1);
        var spec = new FarmMachineSpec("पहिला", "tractor", "owned", null, null, null, null, null, null);
        one.Change(spec, new UserId(Owner), DateTime.UtcNow).Should().BeTrue();
        two.Change(spec with { Name = "दुसरा" }, new UserId(CoOwner), DateTime.UtcNow).Should().BeTrue();

        (await store1.TrySaveAsync()).Should().Be(FarmSetupSave.Saved);
        await tx1.CommitAsync();
        (await store2.TrySaveAsync()).Should().Be(FarmSetupSave.ChangedElsewhere, "the revision moved under the second save");

        // Nothing of the second save was kept, its unit of work is clean, and its transaction is still usable (a mutation batch goes on).
        db2.ChangeTracker.Entries().Should().OnlyContain(e => e.State == EntityState.Unchanged || e.State == EntityState.Detached);
        (await store2.TrySaveAsync()).Should().Be(FarmSetupSave.Saved, "an empty save after the refusal succeeds");
        (await db2.Database.SqlQueryRaw<int>("SELECT 1 AS \"Value\"").ToListAsync()).Should().Equal(1);
        await tx2.CommitAsync();
        (await TextAsync("SELECT name || '|' || revision FROM ssf.farm_machines WHERE id = @id", ("id", Tractor))).Should().Be("पहिला|2");

        // And a NEW id two phones make at once: the second insert meets the first one's row and is answered the same way.
        var fresh = Guid.NewGuid();
        await using var scope3 = HostServices.CreateAsyncScope();
        await using var scope4 = HostServices.CreateAsyncScope();
        var db3 = scope3.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var db4 = scope4.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await using var tx3 = await db3.Database.BeginTransactionAsync();
        await using var tx4 = await db4.Database.BeginTransactionAsync();
        (await scope3.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, Owner)).IsSuccess.Should().BeTrue();
        (await scope4.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, CoOwner)).IsSuccess.Should().BeTrue();
        var store3 = scope3.ServiceProvider.GetRequiredService<IFarmSetupStore>();
        var store4 = scope4.ServiceProvider.GetRequiredService<IFarmSetupStore>();
        store3.Stage(FarmMachine.Create(fresh, new FarmId(FarmA), spec, new UserId(Owner), DateTime.UtcNow));
        store4.Stage(FarmMachine.Create(fresh, new FarmId(FarmA), spec with { Name = "दुसरा" }, new UserId(CoOwner), DateTime.UtcNow));
        (await store3.TrySaveAsync()).Should().Be(FarmSetupSave.Saved);
        await tx3.CommitAsync();
        (await store4.TrySaveAsync()).Should().Be(FarmSetupSave.ChangedElsewhere, "the id was taken first");
        await tx4.CommitAsync();
        (await TextAsync("SELECT name FROM ssf.farm_machines WHERE id = @id", ("id", fresh))).Should().Be("पहिला");
    }
}
