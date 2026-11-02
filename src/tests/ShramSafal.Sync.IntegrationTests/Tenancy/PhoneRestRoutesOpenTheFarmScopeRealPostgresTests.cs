// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 (register F99, carried from the MU-4 third review).
//
// The REST routes the current phone calls that answered 500 to EVERY caller because they never opened the caller's farm
// scope: a test's collect and report (features/tests/data/testsClient.ts) and a schedule's adopt
// (infrastructure/api/resources/ScheduleResource.ts). The only HTTP test of them ran on EF InMemory, which has no tenant
// interceptor, so it proved nothing for Postgres. Here, on a real Postgres as agrisync_app (E3 first), through the real host:
//   - a member does the real thing, it answers 200, and the row is really changed;
//   - another farm's record is answered exactly as a made-up id, in both directions (E4: his farm with their record, their
//     farm with his record), and nothing of it changes.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class PhoneRestRoutesOpenTheFarmScopeRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid FarmBTest = Guid.Parse("3d099000-0000-4000-8000-000000000057");
    private static readonly Guid GrapesTemplate = Guid.Parse("3d099000-0000-4000-8000-0000000000e1");

    // ── Tests: collect and report ───────────────────────────────────────────────────────

    [Fact]
    public async Task A_member_collects_and_reports_his_farms_test_and_it_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (collected, collectedBody) = await PostAsync(Owner, $"/shramsafal/test-instances/{TestRecord}/collect", null);
        collected.Should().Be(HttpStatusCode.OK, collectedBody);
        Json(collectedBody).GetProperty("status").GetString().Should().Be("Collected");
        (await TestStatusAsync(TestRecord)).Should().Be(1, "collected is kept on the server (P10)");

        var (reported, reportedBody) = await PostAsync(Owner, $"/shramsafal/test-instances/{TestRecord}/report", new
        {
            results = new[] { new { parameterCode = "pH", parameterValue = "6.4", unit = "", referenceRangeLow = 6.0m, referenceRangeHigh = 7.5m } },
            attachmentIds = new[] { FarmPhoto },
            clientCommandId = "f99-report",
        });
        reported.Should().Be(HttpStatusCode.OK, reportedBody);
        var answer = Json(reportedBody);
        answer.GetProperty("testInstanceId").GetGuid().Should().Be(TestRecord);
        answer.GetProperty("status").GetString().Should().Be("Reported");
        (await TestStatusAsync(TestRecord)).Should().Be(2, "the result is kept on the server (P10)");
    }

    [Fact]
    public async Task Another_farms_test_is_answered_as_a_made_up_one_both_ways_and_is_not_touched()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmBTestAsync();

        foreach (var route in new[] { "collect", "report", "waive" })
        {
            object body = route switch
            {
                "report" => new { results = new[] { new { parameterCode = "pH", parameterValue = "6.4", unit = "" } }, attachmentIds = new[] { FarmPhoto } },
                "waive" => new { reason = "f99" },
                _ => new { },
            };

            var madeUp = await PostAsync(Owner, $"/shramsafal/test-instances/{Guid.NewGuid()}/{route}", body);
            madeUp.Status.Should().Be(HttpStatusCode.NotFound, madeUp.Body);
            var code = Json(madeUp.Body).GetProperty("error").GetString();
            code.Should().Be("ShramSafal.TestInstanceNotFound");

            // His farm's caller, their farm's test — and their farm's caller, his farm's test: no hint either exists.
            foreach (var (caller, test) in new[] { (Owner, FarmBTest), (OwnerB, TestRecord) })
            {
                var (status, answer) = await PostAsync(caller, $"/shramsafal/test-instances/{test}/{route}", body);
                status.Should().Be(HttpStatusCode.NotFound, $"{caller} {route} {test}: {answer}");
                Json(answer).GetProperty("error").GetString().Should().Be(code, "answered exactly as a made-up id");
            }
        }

        (await TestStatusAsync(FarmBTest)).Should().Be(0, "nothing of another farm's test changed");
        (await TestStatusAsync(TestRecord)).Should().Be(0, "nothing of his farm's test changed by another farmer");
    }

    // ── Schedules: adopt ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_member_adopts_a_schedule_on_his_plot_and_it_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedGrapesTemplateAsync();

        var (status, body) = await PostAsync(Owner, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/adopt",
            new { farmId = FarmA, scheduleTemplateId = GrapesTemplate, clientCommandId = "f99-adopt" });
        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("scheduleTemplateId").GetGuid().Should().Be(GrapesTemplate);
        (await SubscriptionsAsync()).Should().ContainSingle("the adoption is kept on the server (P10)").Which.Should().Be((FarmA, PlotA, CycleA));
    }

    [Fact]
    public async Task Another_farms_plot_or_farm_is_refused_both_ways_and_nothing_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedGrapesTemplateAsync();
        object Adopt(Guid farm) => new { farmId = farm, scheduleTemplateId = GrapesTemplate };

        // A farm he is not on: refused, its scope never opened (made up or real alike).
        (await PostAsync(OwnerB, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/adopt", Adopt(FarmA))).Status
            .Should().Be(HttpStatusCode.Forbidden, "his farm id is not hers");
        (await PostAsync(Owner, $"/shramsafal/plots/{PlotB}/cycles/{CycleB}/schedule/adopt", Adopt(FarmB))).Status
            .Should().Be(HttpStatusCode.Forbidden, "her farm id is not his");
        (await PostAsync(Owner, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/adopt", Adopt(Guid.NewGuid()))).Status
            .Should().Be(HttpStatusCode.Forbidden, "a made-up farm is refused the same way");

        // His own farm with another farm's plot (the foreign child): not found, as a made-up plot is.
        var madeUpPlot = await PostAsync(Owner, $"/shramsafal/plots/{Guid.NewGuid()}/cycles/{CycleA}/schedule/adopt", Adopt(FarmA));
        madeUpPlot.Status.Should().Be(HttpStatusCode.NotFound, madeUpPlot.Body);
        foreach (var (caller, farm, plot, cycle) in new[] { (Owner, FarmA, PlotB, CycleB), (OwnerB, FarmB, PlotA, CycleA) })
        {
            var (status, body) = await PostAsync(caller, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/adopt", Adopt(farm));
            status.Should().Be(HttpStatusCode.NotFound, body);
            Json(body).GetProperty("error").GetString().Should().Be(Json(madeUpPlot.Body).GetProperty("error").GetString());
        }

        (await SubscriptionsAsync()).Should().BeEmpty("nothing was adopted anywhere");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object? body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99] {user} POST {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    /// <summary>A test on farm B (no farmer write path makes one: the seed inserts it, as the farm's own test is).</summary>
    private Task SeedFarmBTestAsync() => ExecOnSuperuserAsync("""
        INSERT INTO ssf.test_instances (id, test_protocol_id, protocol_kind, crop_cycle_id, farm_id, plot_id, stage_name,
                                        planned_due_date, created_at_utc, modified_at_utc, status)
        VALUES (@test, @protocol, 0, @cycleB, @farmB, @plotB, 'Vegetative', DATE '2026-10-01', NOW(), NOW(), 0);
        """, ("test", FarmBTest), ("protocol", Protocol), ("cycleB", CycleB), ("farmB", FarmB), ("plotB", PlotB));

    /// <summary>A published grapes schedule (the adoptable model; no farmer write path makes one).</summary>
    private Task SeedGrapesTemplateAsync() => ExecOnSuperuserAsync("""
        INSERT INTO ssf.crop_schedule_templates (id, template_key, crop_key, region_code, name, version_tag, is_published, created_at_utc)
        VALUES (@id, 'f99-grapes', 'grapes', NULL, 'द्राक्ष वेळापत्रक', 'v1', TRUE, NOW());
        """, ("id", GrapesTemplate));

    private async Task<int> TestStatusAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.test_instances WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<(Guid Farm, Guid Plot, Guid Cycle)[]> SubscriptionsAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT farm_id, plot_id, crop_cycle_id FROM ssf.schedule_subscriptions ORDER BY adopted_at_utc";
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new System.Collections.Generic.List<(Guid, Guid, Guid)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2)));
        }

        return rows.ToArray();
    }
}
