// spec: facts-card-input-truth-2026-11-19 - lane FACTS slice B.
//
// Migration 20261119105639_AddInputUseFacts adds ssf.application_input_items.method / carrier_water_litres (what he said, copied from the
// record) and the DERIVED tables ssf.input_use_facts / ssf.input_use_ingredients (what the server worked out: library product, crop, day of
// the season, stage, ingredients). Proven here on a real Postgres as agrisync_app (doctrine E3 first in every fact: neither superuser nor
// BYPASSRLS), through the real host and the real push:
//   A  Save_CopiesWhatHeSaid_AndWorksOutTheDayStageAndIngredients: method and carrier water land on the item, his amount is untouched (P7),
//      and the derived row carries the crop, day zero and where it came from, the day, the stage, the library and facts versions (P8);
//   B  OneWord_NoAmountSaid_NothingIsInvented: no dose in, no dose out (P4), and the use is still derived;
//   C  UnknownProduct_IsKeptWithBlankFacts: no library product and no ingredients, never a guess;
//   D  NoSchedule_NoDayAndNoStage: the crop is known, a day is not (P4);
//   E  DeriveFails_TheRecordAndItsLedgerRowsAreStillSaved: with the derived table missing the day he saved is intact (P1);
//   F  AppRole_SelectInsertDelete_NeverUpdateOrTruncate and OtherFarm_CannotSeeRows: the grants and the farm isolation.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Inputs;

[Trait("Category", "RequiresPostgres")]
public sealed class InputUseFactsRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private static object[] Draft(string product, object? dose = null, string? unit = null, string method = "Spray", decimal? water = 600m)
    {
        var mixItem = new Dictionary<string, object?> { ["id"] = "m0", ["productName"] = product };
        if (dose is not null) mixItem["dose"] = dose;
        if (unit is not null) mixItem["unit"] = unit;
        var input = new Dictionary<string, object?> { ["id"] = "e1", ["type"] = "pesticide", ["method"] = method, ["mix"] = new[] { mixItem } };
        if (water is not null) input["computedWaterVolume"] = water;
        return [input];
    }

    /// <summary>A plot of farm A that follows the checked university schedule with day 0 = <paramref name="dayZero"/>.</summary>
    private async Task<(Guid Plot, Guid Cycle)> FollowingScheduleAsync(DateOnly dayZero)
    {
        var template = await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", dayZero);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot, reference_date)
            VALUES (gen_random_uuid(), @farm, @plot, @cycle, 'grapes', @template, 'v1', NOW(), 0, 'Outside', 'Checked', 1, @zero)
            """, ("farm", FarmA), ("plot", plot), ("cycle", cycle), ("template", template.Id), ("zero", dayZero));
        return (plot, cycle);
    }

    private async Task<Guid> SaveAsync(string requestId, Guid plot, Guid cycle, DateOnly on, object[] inputs)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, Owner, Guid.NewGuid(), 2, 100m, 200m, [], null);
        payload["plotId"] = plot;
        payload["cropCycleId"] = cycle;
        payload["logDate"] = on.ToString("yyyy-MM-dd");
        payload["manualDraft"] = new Dictionary<string, object?> { ["inputs"] = inputs };
        await PushAppliedAsync(Owner, "create_daily_log", requestId, payload);
        return logId;
    }

    private async Task<List<Dictionary<string, object?>>> SuperRowsAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        var rows = new List<Dictionary<string, object?>>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = await reader.IsDBNullAsync(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }

        return rows;
    }

    private Task<List<Dictionary<string, object?>>> ItemsOfAsync(Guid log) => SuperRowsAsync("""
        SELECT i.product_name, i.dose_amount, i.dose_unit, i.method, i.carrier_water_litres
        FROM ssf.application_input_items i
        JOIN ssf.farm_operations o ON o."Id" = i.operation_id
        WHERE o.source_daily_log_id = @log AND o.is_current_version
        """, ("log", log));

    private Task<List<Dictionary<string, object?>>> FactsOfAsync(Guid log) => SuperRowsAsync("""
        SELECT f.*
        FROM ssf.input_use_facts f
        JOIN ssf.farm_operations o ON o."Id" = f.operation_id
        WHERE o.source_daily_log_id = @log
        """, ("log", log));

    [Fact]
    public async Task Save_CopiesWhatHeSaid_AndWorksOutTheDayStageAndIngredients()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var zero = TodayIst().AddDays(-9);
        var (plot, cycle) = await FollowingScheduleAsync(zero);

        var log = await SaveAsync("facts-a", plot, cycle, TodayIst(), Draft("Karate", 250, "ml"));

        var item = (await ItemsOfAsync(log)).Should().ContainSingle().Subject;
        item["method"].Should().Be("Spray", "how he applied it is copied as the record states it");
        item["carrier_water_litres"].Should().Be(600m);
        item["dose_amount"].Should().Be(250m, "his amount is exactly as he said it (P7)");
        item["dose_unit"].Should().Be("ml");

        var fact = (await FactsOfAsync(log)).Should().ContainSingle().Subject;
        fact["product_said"].Should().Be("Karate");
        fact["library_product_id"].Should().NotBeNull("Karate is a library product");
        fact["crop_name"].Should().Be("Grapes");
        fact["day_zero_date"].Should().Be(zero);
        fact["day_zero_source"].Should().Be("schedule");
        fact["day_of_season"].Should().Be(9, "the use date minus day zero");
        fact["stage_name"].Should().Be("Post Pruning", "day 9 is inside the schedule's 0-12 stage");
        fact["facts_version"].Should().NotBeNull();
        fact["library_version"].Should().NotBeNull();

        var keys = (await SuperRowsAsync("SELECT ingredient_key FROM ssf.input_use_ingredients WHERE input_use_fact_id = @id", ("id", fact["Id"]!)))
            .Select(r => r["ingredient_key"]).ToList();
        keys.Should().Contain("lambdacyhalothrin", "Karate's ingredient is named on the use");
    }

    [Fact]
    public async Task OneWord_NoAmountSaid_NothingIsInvented()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));

        var log = await SaveAsync("facts-b", plot, cycle, TodayIst(), Draft("Karate", method: "Drench", water: null));

        var item = (await ItemsOfAsync(log)).Should().ContainSingle().Subject;
        item["dose_amount"].Should().BeNull("no amount said, none written (P4)");
        item["dose_unit"].Should().BeNull();
        item["method"].Should().Be("Drench");
        item["carrier_water_litres"].Should().BeNull("no water stated, none written");
        (await FactsOfAsync(log)).Should().ContainSingle("a word alone is still a use (P9)");
    }

    [Fact]
    public async Task UnknownProduct_IsKeptWithBlankFacts()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));

        var log = await SaveAsync("facts-c", plot, cycle, TodayIst(), Draft("कोणतंतरी औषध"));

        (await ItemsOfAsync(log)).Should().ContainSingle();
        var fact = (await FactsOfAsync(log)).Should().ContainSingle().Subject;
        fact["library_product_id"].Should().BeNull("a product the library does not hold is not guessed");
        fact["group_codes"].Should().BeNull();
        (await SuperRowsAsync("SELECT 1 FROM ssf.input_use_ingredients WHERE input_use_fact_id = @id", ("id", fact["Id"]!)))
            .Should().BeEmpty("no library product, no ingredients");
    }

    [Fact]
    public async Task NoSchedule_NoDayAndNoStage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-9));

        var log = await SaveAsync("facts-d", plot, cycle, TodayIst(), Draft("Karate"));

        var fact = (await FactsOfAsync(log)).Should().ContainSingle().Subject;
        fact["day_of_season"].Should().BeNull("no main schedule, no day (P4)");
        fact["stage_name"].Should().BeNull();
        fact["day_zero_date"].Should().BeNull();
    }

    [Fact]
    public async Task DeriveFails_TheRecordAndItsLedgerRowsAreStillSaved()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await ExecOnSuperuserAsync("ALTER TABLE ssf.input_use_facts RENAME TO input_use_facts_hidden");
        try
        {
            var log = await SaveAsync("facts-e", plot, cycle, TodayIst(), Draft("Karate", 250, "ml"));

            (await SuperRowsAsync("SELECT 1 FROM ssf.daily_logs WHERE \"Id\" = @log", ("log", log))).Should().ContainSingle("the day he saved is intact (P1)");
            var item = (await ItemsOfAsync(log)).Should().ContainSingle("the typed ledger row is intact").Subject;
            item["dose_amount"].Should().Be(250m);
        }
        finally
        {
            await ExecOnSuperuserAsync("ALTER TABLE ssf.input_use_facts_hidden RENAME TO input_use_facts");
        }
    }

    [Fact]
    public async Task AppRole_SelectInsertDelete_NeverUpdateOrTruncate()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        foreach (var table in new[] { "ssf.input_use_facts", "ssf.input_use_ingredients" })
        {
            foreach (var (privilege, expected) in new[] { ("SELECT", true), ("INSERT", true), ("DELETE", true), ("UPDATE", false), ("TRUNCATE", false) })
            {
                await using var cmd = db.CreateCommand();
                cmd.CommandText = $"SELECT has_table_privilege(current_user, '{table}', '{privilege}')";
                (await cmd.ExecuteScalarAsync()).Should().Be(expected, $"{table} {privilege}");
            }
        }
    }

    [Fact]
    public async Task OtherFarm_CannotSeeRows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await SaveAsync("facts-f", plot, cycle, TodayIst(), Draft("Karate"));

        (await CountAsAppAsync(FarmA, "ssf.input_use_facts")).Should().Be(1, "under its own farm's scope the row is there (else the proof is vacuous)");
        (await CountAsAppAsync(FarmA, "ssf.input_use_ingredients")).Should().BeGreaterThan(0);
        (await CountAsAppAsync(FarmB, "ssf.input_use_facts")).Should().Be(0, "farm B's scope sees none of farm A's uses");
        (await CountAsAppAsync(FarmB, "ssf.input_use_ingredients")).Should().Be(0);
        (await CountAsAppAsync(null, "ssf.input_use_facts")).Should().Be(0, "no scope sees nothing");
    }


    // ── C: the season ledger (read route, CSV, rebuild) ─────────────────────────────────────────────────────────────

    private async Task<System.Text.Json.JsonElement> LedgerAsync(Guid user, Guid farm, string query = "")
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{farm}/input-use{query}", user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"the ledger read must succeed for {user}: {(int)response.StatusCode} {body}");
        return System.Text.Json.JsonDocument.Parse(body).RootElement.Clone();
    }

    [Fact]
    public async Task Ledger_OwnerReadsWhatHeSaidAndWhatWasWorkedOut_WithTotalsOnlyWhereEveryUseStatesAnAmount()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await SaveAsync("ledger-1", plot, cycle, TodayIst(), Draft("Karate", 250, "ml"));
        await SaveAsync("ledger-2", plot, cycle, TodayIst(), Draft("Karate", 500, "ml"));
        await SaveAsync("ledger-3", plot, cycle, TodayIst(), Draft("कोणतंतरी औषध"));

        var ledger = await LedgerAsync(Owner, FarmA);

        var rows = ledger.GetProperty("rows").EnumerateArray().ToList();
        rows.Should().HaveCount(3);
        rows.Where(r => r.GetProperty("productSaid").GetString() == "Karate").Should().OnlyContain(r => r.GetProperty("dayOfSeason").GetInt32() == 9 && r.GetProperty("derived").GetBoolean());
        var karate = ledger.GetProperty("products").EnumerateArray().Single(p => p.GetProperty("product").GetString() == "Karate");
        karate.GetProperty("uses").GetInt32().Should().Be(2);
        karate.GetProperty("total").GetDecimal().Should().Be(750m, "both uses state an amount, in one unit");
        karate.GetProperty("unit").GetString().Should().Be("ml");
        var unknown = ledger.GetProperty("products").EnumerateArray().Single(p => p.GetProperty("product").GetString() == "कोणतंतरी औषध");
        unknown.GetProperty("total").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null, "an amount nobody stated is never summed (P4)");
        unknown.GetProperty("noTotalBecause").GetString().Should().NotBeNullOrEmpty();
        ledger.GetProperty("ingredients").EnumerateArray().Single(i => i.GetProperty("key").GetString() == "lambdacyhalothrin")
            .GetProperty("uses").GetInt32().Should().Be(2);
        ledger.GetProperty("notYetDerived").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task Csv_StartsWithAByteOrderMark_CarriesMarathi_AndHasOneLinePerUse()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await SaveAsync("csv-1", plot, cycle, TodayIst(), Draft("Karate", 250, "ml"));
        await SaveAsync("csv-2", plot, cycle, TodayIst(), Draft("=HYPERLINK(\"x\")"));

        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/input-use.csv", Owner);
        response.IsSuccessStatusCode.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("text/csv");
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes.Take(3).Should().Equal(new byte[] { 0xEF, 0xBB, 0xBF }, "Excel reads UTF-8 only with the mark");
        var text = System.Text.Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        text.Should().Contain("तारीख").And.Contain("Karate").And.Contain("lambda");
        text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Should().HaveCount(3, "one header and one line per use");
        text.Should().Contain("\"'=HYPERLINK", "a farmer's words are never run as a spreadsheet formula");
    }

    [Fact]
    public async Task Ledger_IsForTheOwnerOnly_AndAnotherFarmIsRefused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await SaveAsync("refused-1", plot, cycle, TodayIst(), Draft("Karate"));

        using (var worker = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/input-use", Worker))
            ((int)worker.StatusCode).Should().BeOneOf(new[] { 403, 404 }, "a worker seat has no season ledger");
        using (var stranger = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/input-use", OwnerB))
            ((int)stranger.StatusCode).Should().BeOneOf(new[] { 403, 404 }, "another farm's owner reads nothing of this farm");
        using (var rebuild = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/input-use/rebuild", Worker))
            ((int)rebuild.StatusCode).Should().BeOneOf(new[] { 403, 404 }, "a worker seat cannot rebuild");
    }

    [Fact]
    public async Task Rebuild_BringsBackWhatAFailedDerivationLost_AndRunningItAgainChangesNothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await FollowingScheduleAsync(TodayIst().AddDays(-9));
        await ExecOnSuperuserAsync("ALTER TABLE ssf.input_use_facts RENAME TO input_use_facts_hidden");
        Guid log;
        try
        {
            log = await SaveAsync("rebuild-1", plot, cycle, TodayIst(), Draft("Karate", 250, "ml"));
        }
        finally
        {
            await ExecOnSuperuserAsync("ALTER TABLE ssf.input_use_facts_hidden RENAME TO input_use_facts");
        }

        (await FactsOfAsync(log)).Should().BeEmpty("the derivation failed while the table was away");
        (await LedgerAsync(Owner, FarmA)).GetProperty("notYetDerived").GetInt32().Should().Be(1, "the ledger says one use is not worked out yet");

        using (var first = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/input-use/rebuild", Owner))
            first.IsSuccessStatusCode.Should().BeTrue();
        var afterFirst = await FactsOfAsync(log);
        afterFirst.Should().ContainSingle();
        afterFirst[0]["day_of_season"].Should().Be(9);

        using (var second = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/input-use/rebuild", Owner))
            second.IsSuccessStatusCode.Should().BeTrue();
        var afterSecond = await FactsOfAsync(log);
        afterSecond.Should().ContainSingle("a rebuild replaces, it never duplicates");
        (await SuperRowsAsync("SELECT count(*) AS n FROM ssf.input_use_ingredients WHERE farm_id = @farm", ("farm", FarmA)))[0]["n"]
            .Should().Be(1L, "Karate holds one ingredient, and a second rebuild left no second copy of it");
        (await ItemsOfAsync(log)).Single()["dose_amount"].Should().Be(250m, "what he said is never touched (P7)");
    }

    private async Task<long> CountAsAppAsync(Guid? farm, string table)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = $"SELECT set_config('agrisync.farm_id', '{(farm is { } f ? f.ToString() : string.Empty)}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"SELECT count(*) FROM {table}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }
}
