// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
//
// The product-purpose question on a real Postgres, as agrisync_app (doctrine E3 first in every fact: neither superuser nor
// BYPASSRLS), through the real host and the real write path:
//   A  TheAnswer_IsOneAppendOnlyRowPerProduct_AndTheMeterRises: the read says which products to ask; a chip answer lands as ONE
//      ssf.question_events row on that product slot (who, how, when, the product's name from the stored record); the same answer
//      again is the same row, a different one is 409; the stored farm day (dfes-6) moves PURPOSE from 0.5 to 1 and the /10 rises.
//   B  AnotherFarm_NeverAnswersOrReadsThisRecord: farm B's owner cannot answer or read farm A's record (403 on a farm he is not a
//      member of; 404 when he names farm A's record under his own farm, E4), and a member without the standing is refused (403).
//   C  TheRowIsAppendOnly: the app role can neither change nor remove the stored answer.
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
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

[Trait("Category", "RequiresPostgres")]
public sealed class ProductPurposeAnswersRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    // The farm-local day: the record's day is the day the server scores and recomputes (IST, never the UTC date).
    private static readonly string Today = FarmLocalDay.From(DateTime.UtcNow).ToString("yyyy-MM-dd");

    /// <summary>Two products: calcium nitrate with no purpose said (e1), Progibb with its purpose said (e2, reason Disease).</summary>
    private static object Content() => new
    {
        schema = 1,
        inputs = new object[]
        {
            new { id = "e1", method = "Spray", mix = new object[] { new { id = "m0", productName = "calcium nitrate" } } },
            new { id = "e2", method = "Spray", reason = "Disease", mix = new object[] { new { id = "m0", productName = "Progibb" } } },
        },
    };

    private async Task<Guid> RecordAsync(Guid speaker, string requestId)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, speaker, Guid.NewGuid(), 2, 100m, 200m, [], null);
        payload["logDate"] = Today;
        payload["content"] = Content();
        await PushAppliedAsync(speaker, "create_daily_log", requestId, payload);
        return logId;
    }

    private static Dictionary<string, object?> AnswerBody(
        Guid farm, Guid log, string response, string mode = "chip", string? code = "downy", string eventId = "e1", int slot = 0) => new()
        {
            ["farmId"] = farm,
            ["plotId"] = null,
            ["dailyLogId"] = log,
            ["questionKey"] = "product.purpose",
            ["crop"] = "grapes",
            ["anchorDateType"] = "log_date",
            ["triggerType"] = "Product",
            ["questionType"] = "product_purpose",
            ["lens"] = "Execution",
            ["depthLevel"] = 1,
            ["priority"] = 1,
            ["cooldown"] = 0,
            ["answerModes"] = "chip,voice",
            ["safetyClass"] = "informational",
            ["agronomistApproved"] = false,
            ["marathiApproved"] = true,
            ["bankVersion"] = "dfes-bank-test",
            ["questionEngineVersion"] = "dfes-qengine-test",
            ["shownAtUtc"] = DateTime.UtcNow,
            ["response"] = response,
            ["skipped"] = false,
            ["promptText"] = "हे कोणत्या रोगासाठी मारलं?",
            ["promptOrigin"] = "pattern",
            ["lookLineIds"] = Array.Empty<string>(),
            ["inputEventId"] = eventId,
            ["mixIndex"] = slot,
            ["answerMode"] = mode,
            ["answerCode"] = code,
        };

    private async Task<(HttpStatusCode Status, string Body)> PostAnswerAsync(Guid user, Dictionary<string, object?> body)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shramsafal/question-events", user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[POST question-events] as {user} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<(HttpStatusCode Status, JsonElement Root)> ReadAsync(Guid user, Guid farm, Guid log)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/question-events/product-purposes?farmId={farm}&dailyLogId={log}", user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[GET product-purposes] as {user} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, response.IsSuccessStatusCode ? JsonDocument.Parse(text).RootElement.Clone() : default);
    }

    private async Task<int?> FarmDayScoreAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/day-understanding?farmId={FarmA}&date={Today}", user);
        var text = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"day-understanding: {(int)response.StatusCode} {text}");
        var score = JsonDocument.Parse(text).RootElement.GetProperty("score");
        return score.ValueKind == JsonValueKind.Number ? score.GetInt32() : null;
    }

    private async Task<(string Version, LensInput Roster)> StoredDayAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT score_engine_version, components_json FROM ssf.daily_richness_aggregates WHERE farm_id = @id AND local_date = @day";
        cmd.Parameters.AddWithValue("id", FarmA);
        cmd.Parameters.AddWithValue("day", DateOnly.Parse(Today));
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue($"farm A has a stored day row for {Today}");
        return (reader.GetString(0), JsonSerializer.Deserialize<LensInput>(reader.GetString(1))!);
    }

    /// <summary>The /10's measure before rounding: the covered weight over the weight that counts.</summary>
    private static double Completeness(LensInput roster)
    {
        var parts = DayUnderstandingScore.ScoredParts(roster);
        return parts.Sum(d => d.Weight * d.Coverage * d.ConfidenceFactor) / parts.Sum(d => d.Weight);
    }

    private async Task<List<Dictionary<string, object?>>> StoredAnswersAsync(Guid log)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", question_key, response, answer_mode, answer_code, product_name, asked_user_id, question_kind, farm_id, plot_id
              FROM ssf.question_events WHERE daily_log_id = @log ORDER BY created_at_utc
            """;
        cmd.Parameters.AddWithValue("log", log);
        var rows = new List<Dictionary<string, object?>>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TheAnswer_IsOneAppendOnlyRowPerProduct_AndTheMeterRises()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync(Worker, "b4-a-log");

        // Before: the read asks about calcium nitrate only; the stored day owes PURPOSE at a half.
        var (status, before) = await ReadAsync(Worker, FarmA, log);
        status.Should().Be(HttpStatusCode.OK);
        before.GetProperty("mayAnswer").GetBoolean().Should().BeTrue("he is the record's speaker");
        var items = before.GetProperty("items").EnumerateArray().ToList();
        items.Select(i => (i.GetProperty("inputEventId").GetString(), i.GetProperty("mixIndex").GetInt32(),
                i.GetProperty("productName").GetString(), i.GetProperty("ask").GetBoolean()))
            .Should().Equal(("e1", 0, "calcium nitrate", true), ("e2", 0, "Progibb", false));
        items[1].GetProperty("statedReason").GetString().Should().Be("Disease");

        var (versionBefore, rosterBefore) = await StoredDayAsync();
        versionBefore.Should().Be("dfes-6");
        rosterBefore.Possible!.Single(d => d.Name == "PURPOSE").Coverage.Should().Be(0.5);
        var scoreBefore = await FarmDayScoreAsync(Owner);
        Output.WriteLine($"[EVIDENCE] before: PURPOSE 0.5, score {scoreBefore}");

        // He taps a chip.
        var (posted, body) = await PostAnswerAsync(Worker, AnswerBody(FarmA, log, "करपा"));
        posted.Should().Be(HttpStatusCode.OK, body);
        var id = JsonDocument.Parse(body).RootElement.GetProperty("id").GetGuid();

        var rows = await StoredAnswersAsync(log);
        var row = rows.Should().ContainSingle().Subject;
        row["Id"].Should().Be(id);
        row["question_key"].Should().Be("product.purpose:0:e1");
        row["response"].Should().Be("करपा");
        row["answer_mode"].Should().Be("chip");
        row["answer_code"].Should().Be("downy");
        row["product_name"].Should().Be("calcium nitrate");
        row["asked_user_id"].Should().Be(Worker);
        row["question_kind"].Should().Be("product_purpose");
        row["farm_id"].Should().Be(FarmA);
        row["plot_id"].Should().Be(PlotA);
        Output.WriteLine("[EVIDENCE] one row: product.purpose:0:e1, chip/downy, calcium nitrate, asked = the speaker");

        // The same answer again is the same row; a different one is refused, and nothing else is written.
        var (again, againBody) = await PostAnswerAsync(Worker, AnswerBody(FarmA, log, "करपा"));
        again.Should().Be(HttpStatusCode.OK);
        JsonDocument.Parse(againBody).RootElement.GetProperty("id").GetGuid().Should().Be(id);
        (await PostAnswerAsync(Worker, AnswerBody(FarmA, log, "भुरी", code: "powdery"))).Status.Should().Be(HttpStatusCode.Conflict);
        (await StoredAnswersAsync(log)).Should().ContainSingle();

        // After: the read shows the answer on the row and asks nothing more; the day's PURPOSE is full; the /10 rose.
        var (_, after) = await ReadAsync(Worker, FarmA, log);
        var first = after.GetProperty("items")[0];
        first.GetProperty("ask").GetBoolean().Should().BeFalse();
        first.GetProperty("answer").GetProperty("response").GetString().Should().Be("करपा");
        first.GetProperty("answer").GetProperty("answerMode").GetString().Should().Be("chip");
        first.GetProperty("answer").GetProperty("answeredByUserId").GetGuid().Should().Be(Worker);
        first.GetProperty("answer").GetProperty("counts").GetBoolean().Should().BeTrue();

        var (versionAfter, rosterAfter) = await StoredDayAsync();
        versionAfter.Should().Be("dfes-6");
        rosterAfter.Possible!.Single(d => d.Name == "PURPOSE").Coverage.Should().Be(1.0);
        var scoreAfter = await FarmDayScoreAsync(Owner);
        scoreAfter.Should().Be(DayUnderstandingScore.From(rosterAfter), "the meter is the stored day's /10");
        // Half of one part of ten is about half a point: the rounded /10 may or may not step, the measure under it always rises.
        Completeness(rosterAfter).Should().BeGreaterThan(Completeness(rosterBefore), "the score goes up on a real answer");
        scoreAfter.Should().BeGreaterThanOrEqualTo(scoreBefore!.Value);
        rosterAfter.Possible!.Where(d => d.Name != "PURPOSE").Select(d => (d.Name, d.Coverage))
            .Should().Equal(rosterBefore.Possible!.Where(d => d.Name != "PURPOSE").Select(d => (d.Name, d.Coverage)),
                "only the purpose part moved");
        Output.WriteLine(
            $"[EVIDENCE] after: PURPOSE 1.0, completeness {Completeness(rosterBefore):F4} -> {Completeness(rosterAfter):F4}, score {scoreBefore} -> {scoreAfter}");
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AnotherFarm_NeverAnswersOrReadsThisRecord()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync(Worker, "b4-b-log");

        (await PostAnswerAsync(OwnerB, AnswerBody(FarmA, log, "करपा"))).Status.Should().Be(HttpStatusCode.Forbidden,
            "farm B's owner is not a member of farm A");
        (await PostAnswerAsync(OwnerB, AnswerBody(FarmB, log, "करपा"))).Status.Should().Be(HttpStatusCode.NotFound,
            "under his own farm, farm A's record is not found (E4)");
        (await ReadAsync(OwnerB, FarmA, log)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await ReadAsync(OwnerB, FarmB, log)).Status.Should().Be(HttpStatusCode.NotFound);

        // A member of farm A who is neither the speaker nor a holder of the confirm-records authority is not asked.
        (await PostAnswerAsync(Worker2, AnswerBody(FarmA, log, "करपा"))).Status.Should().Be(HttpStatusCode.Forbidden);

        (await StoredAnswersAsync(log)).Should().BeEmpty();
        Output.WriteLine("[EVIDENCE] no row written by another farm or by a member without the standing");
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TheRowIsAppendOnly()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync(Worker, "b4-c-log");
        (await PostAnswerAsync(Owner, AnswerBody(FarmA, log, "डावणी साठी मारलं", mode: "voice", code: null))).Status
            .Should().Be(HttpStatusCode.OK, "the primary owner holds the confirm-records authority");

        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        foreach (var sql in new[]
                 {
                     "UPDATE ssf.question_events SET response = 'x' WHERE daily_log_id = @log",
                     "DELETE FROM ssf.question_events WHERE daily_log_id = @log",
                 })
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("log", log);
            var act = async () => await cmd.ExecuteNonQueryAsync();
            (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", "permission denied: {0}", sql);
        }

        var row = (await StoredAnswersAsync(log)).Should().ContainSingle().Subject;
        row["response"].Should().Be("डावणी साठी मारलं");
        row["answer_mode"].Should().Be("voice");
        row["asked_user_id"].Should().Be(Owner);
        Output.WriteLine("[EVIDENCE] UPDATE / DELETE as agrisync_app -> 42501; the voice answer is intact");
    }
}
