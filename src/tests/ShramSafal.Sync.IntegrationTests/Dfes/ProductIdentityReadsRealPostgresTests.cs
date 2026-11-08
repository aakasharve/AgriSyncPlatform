// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT3 (Tasks 2 and 3a; founders D-93, D-94, D-95).
//
// Two reads that now stand on the product answers, proven on a real Postgres as agrisync_app (doctrine E3 first in every fact:
// neither superuser nor BYPASSRLS), through the real host:
//   A  PlotUnderstanding_OtherFarmsRowsNeverAppear: GET /shramsafal/day-understanding/plots lists only the caller's farm's plots,
//      scores a plot from its OWN records and answers only, and refuses (403) a farm the caller is not a member of - with rows of
//      two farms present;
//   B  ReviewItemProducts_ComeFromTheLatestContentAndAnswers: the owner's approval queue (GET /shramsafal/farms/{farm}/labour)
//      names each product of the record's latest stored content, the library's match, the speaker's answer and the check apart,
//      and the unchecked count - and farm B's owner never sees farm A's record or its products;
//   C  ThePlotScoreRisesWithTheCheck_AndTheDayStaysOnItsOwnEngine: a checker's yes raises the plot's /10 and the stored farm-day
//      row is stamped dfes-5 with the product part in its roster.
// The merge owner runs this class (it needs the throwaway cluster the other RealPostgres suites use). It could not be run where
// it was written.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

[Trait("Category", "RequiresPostgres")]
public sealed class ProductIdentityReadsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string CalciumNitrate = "p-calcium-nitrate";

    private static readonly string Today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

    private static object Content() => new
    {
        schema = 1,
        inputs = new object[]
        {
            new
            {
                id = "e1",
                method = "Spray",
                mix = new object[]
                {
                    new { id = "m0", productName = "calcium nitrate" },
                    new { id = "m1", productName = "प्रेम गोल्ड" },
                },
            },
        },
    };

    private async Task<Guid> RecordInFarmAAsync(string requestId)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, Worker, Guid.NewGuid(), 2, 100m, 200m, [], null);
        payload["logDate"] = Today;
        payload["content"] = Content();
        await PushAppliedAsync(Worker, "create_daily_log", requestId, payload);
        return logId;
    }

    private async Task<Guid> RecordInFarmBAsync(string requestId)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, OwnerB, Guid.NewGuid(), 2, 100m, 200m, [], null, FarmB);
        payload["plotId"] = PlotB;
        payload["cropCycleId"] = CycleB;
        payload["logDate"] = Today;
        payload["content"] = Content();
        await PushAppliedAsync(OwnerB, "create_daily_log", requestId, payload);
        return logId;
    }

    private static Dictionary<string, object?> Answer(Guid log, Guid farm, string verdict = "confirmed", int slot = 0, string? product = CalciumNitrate)
    {
        var payload = new Dictionary<string, object?>
        {
            ["assertionId"] = Guid.NewGuid(),
            ["farmId"] = farm,
            ["dailyLogId"] = log,
            ["inputEventId"] = "e1",
            ["mixIndex"] = slot,
            ["verdict"] = verdict,
            ["catalogVersion"] = "inputs-2.4",
        };
        if (product is not null)
        {
            payload["catalogProductId"] = product;
        }

        return payload;
    }

    private void Keep(string name, string body) => Output.WriteLine($"[EVIDENCE] {name}: {body.Length} bytes");

    private async Task<long> ScalarLongAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>The stored roster of the farm's day (what the recompute wrote), read as the superuser.</summary>
    private async Task<LensInput> StoredRosterAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT components_json FROM ssf.daily_richness_aggregates WHERE farm_id = @id AND local_date = @day";
        cmd.Parameters.AddWithValue("id", farm);
        cmd.Parameters.AddWithValue("day", DateOnly.Parse(Today));
        var json = (string?)await cmd.ExecuteScalarAsync();
        json.Should().NotBeNull($"farm {farm} has a stored day row for {Today}");
        return JsonSerializer.Deserialize<LensInput>(json!)!;
    }

    private async Task<JsonElement> GetJsonAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"GET {url} as {user}: {(int)response.StatusCode} {body}");
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private async Task<HttpStatusCode> StatusOfAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        return response.StatusCode;
    }

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PlotUnderstanding_OtherFarmsRowsNeverAppear()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ConfirmRecords);
        var logA = await RecordInFarmAAsync("it3-a-log-a");
        await PushAppliedAsync(Mukadam, "assert_input_identity", "it3-a-answer-a", Answer(logA, FarmA));

        // Farm A's answer BEFORE any row of farm B exists.
        var aloneRoot = await GetJsonAsync($"/shramsafal/day-understanding/plots?farmId={FarmA}&date={Today}", Owner);
        var aloneA = aloneRoot.EnumerateArray().Single(p => p.GetProperty("plotId").GetGuid() == PlotA);

        var logB = await RecordInFarmBAsync("it3-a-log-b");
        await PushAppliedAsync(OwnerB, "assert_input_identity", "it3-a-answer-b", Answer(logB, FarmB));

        var asOwnerA = await GetJsonAsync($"/shramsafal/day-understanding/plots?farmId={FarmA}&date={Today}", Owner);
        var asOwnerB = await GetJsonAsync($"/shramsafal/day-understanding/plots?farmId={FarmB}&date={Today}", OwnerB);
        Keep("plots-as-owner-a", asOwnerA.GetRawText());

        var plotsA = asOwnerA.EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid()).ToList();
        var plotsB = asOwnerB.EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid()).ToList();
        plotsA.Should().Contain(PlotA).And.NotContain(PlotB, "farm B's plots never appear in farm A's answer");
        plotsB.Should().Contain(PlotB).And.NotContain(PlotA);

        var plotA = asOwnerA.EnumerateArray().Single(p => p.GetProperty("plotId").GetGuid() == PlotA);
        plotA.GetProperty("score0to10").ValueKind.Should().Be(JsonValueKind.Number, "plot A has a record today");
        plotA.GetProperty("score0to10").GetInt32().Should().Be(
            aloneA.GetProperty("score0to10").GetInt32(), "farm B's records and answers do not move farm A's score");
        plotA.GetProperty("understood").GetRawText().Should().Be(aloneA.GetProperty("understood").GetRawText());
        plotA.GetProperty("nextHint").GetRawText().Should().Be(aloneA.GetProperty("nextHint").GetRawText());
        // And it is the score of farm A's own stored day (one record, one plot).
        plotA.GetProperty("score0to10").GetInt32().Should().Be(DayUnderstandingScore.From(await StoredRosterAsync(FarmA)));

        // A member of one farm cannot read the other's.
        (await StatusOfAsync($"/shramsafal/day-understanding/plots?farmId={FarmB}&date={Today}", Owner)).Should().Be(HttpStatusCode.Forbidden);
        (await StatusOfAsync($"/shramsafal/day-understanding/plots?farmId={FarmA}&date={Today}", OwnerB)).Should().Be(HttpStatusCode.Forbidden);
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ReviewItemProducts_ComeFromTheLatestContentAndAnswers()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ConfirmRecords);
        var log = await RecordInFarmAAsync("it3-b-log");
        var logB = await RecordInFarmBAsync("it3-b-log-b");

        var before = await GetJsonAsync($"/shramsafal/farms/{FarmA}/labour", Owner);
        var card = before.GetProperty("review").EnumerateArray().Single(r => r.GetProperty("id").GetString() == log.ToString());
        card.GetProperty("products").GetArrayLength().Should().Be(2, "a spray-only record is no longer a blank card");
        card.GetProperty("uncheckedProductCount").GetInt32().Should().Be(2);
        var first = card.GetProperty("products")[0];
        first.GetProperty("spokenName").GetString().Should().Be("calcium nitrate");
        first.GetProperty("match").GetProperty("state").GetString().Should().Be("found");
        first.GetProperty("match").GetProperty("productId").GetString().Should().Be(CalciumNitrate);
        card.GetProperty("products")[1].GetProperty("match").GetProperty("state").GetString().Should().Be("notFound");

        // The speaker answers (his, not the check); the holder of the confirm-records authority gives the check.
        await PushAppliedAsync(Worker, "assert_input_identity", "it3-b-speaker", Answer(log, FarmA));
        await PushAppliedAsync(Mukadam, "assert_input_identity", "it3-b-check", Answer(log, FarmA, "rejected", 0, product: null));

        var after = await GetJsonAsync($"/shramsafal/farms/{FarmA}/labour", Owner);
        var afterCard = after.GetProperty("review").EnumerateArray().Single(r => r.GetProperty("id").GetString() == log.ToString());
        var product = afterCard.GetProperty("products")[0];
        product.GetProperty("speakerAnswer").GetProperty("verdict").GetString().Should().Be("confirmed");
        product.GetProperty("speakerAnswer").GetProperty("assertedByUserId").GetGuid().Should().Be(Worker);
        product.GetProperty("check").GetProperty("verdict").GetString().Should().Be("rejected");
        product.GetProperty("check").GetProperty("assertedByUserId").GetGuid().Should().Be(Mukadam);
        afterCard.GetProperty("uncheckedProductCount").GetInt32().Should().Be(1, "the checked product is no longer unchecked");

        // Another farm's owner never sees this record, its card or its products - and farm B's own card is farm B's.
        var asOwnerB = await GetJsonAsync($"/shramsafal/farms/{FarmB}/labour", OwnerB);
        var cardsB = asOwnerB.GetProperty("review").EnumerateArray().Select(r => r.GetProperty("id").GetString()).ToList();
        cardsB.Should().NotContain(log.ToString());
        (await StatusOfAsync($"/shramsafal/farms/{FarmA}/labour", OwnerB)).Should().Be(HttpStatusCode.Forbidden);
        logB.Should().NotBe(log);
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ThePlotScoreRisesWithTheCheck_AndTheDayStaysOnItsOwnEngine()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ConfirmRecords);
        var log = await RecordInFarmAAsync("it3-c-log");

        async Task<(int? Score, JsonElement Row)> PlotAsync()
        {
            var root = await GetJsonAsync($"/shramsafal/day-understanding/plots?farmId={FarmA}&date={Today}", Owner);
            var row = root.EnumerateArray().Single(p => p.GetProperty("plotId").GetGuid() == PlotA);
            var score = row.GetProperty("score0to10");
            return (score.ValueKind == JsonValueKind.Number ? score.GetInt32() : null, row);
        }

        double ProductCoverage(LensInput roster) => roster.Possible!.Single(d => d.Name == "PRODUCT_ID").Coverage;

        // Before any answer: calcium nitrate is found (half), the other product is unknown (zero): mean 0.25. The plot's score is
        // exactly the /10 of the stored roster (one record on one plot, so the plot's day IS the farm day).
        var beforeRoster = await StoredRosterAsync(FarmA);
        var (beforeScore, _) = await PlotAsync();
        ProductCoverage(beforeRoster).Should().BeApproximately(0.25, 1e-9);
        beforeScore.Should().Be(DayUnderstandingScore.From(beforeRoster));

        // The manager's yes on the found product: full for it, still zero for the unknown one: mean 0.5.
        await PushAppliedAsync(Mukadam, "assert_input_identity", "it3-c-check", Answer(log, FarmA));
        var afterRoster = await StoredRosterAsync(FarmA);
        var (afterScore, afterRow) = await PlotAsync();

        ProductCoverage(afterRoster).Should().BeApproximately(0.5, 1e-9, "the checker's yes took the found product from half to full");
        afterScore.Should().Be(DayUnderstandingScore.From(afterRoster), "the plot's number is exactly the stored day's /10");
        // Everything else in the roster is unchanged, so the /10 moved only by the product part (never down).
        afterRoster.Possible!.Where(d => d.Name != "PRODUCT_ID").Select(d => (d.Name, d.Coverage))
            .Should().Equal(beforeRoster.Possible!.Where(d => d.Name != "PRODUCT_ID").Select(d => (d.Name, d.Coverage)));
        afterScore.Should().BeGreaterThanOrEqualTo(beforeScore!.Value);
        afterRow.GetProperty("understood").EnumerateArray().Select(u => u.GetProperty("en").GetString())
            .Should().NotContain("Which product was used is understood",
                "calcium nitrate was checked, but the other product is unknown: the part is half understood, not whole");

        // The stored farm-day row is on the current engine and holds the product part.
        (await ScalarLongAsync(
            "SELECT COUNT(*) FROM ssf.daily_richness_aggregates WHERE farm_id = @id AND score_engine_version = 'dfes-5' "
            + "AND components_json LIKE '%PRODUCT_ID%'", FarmA)).Should().BeGreaterThan(0);
    }
}
