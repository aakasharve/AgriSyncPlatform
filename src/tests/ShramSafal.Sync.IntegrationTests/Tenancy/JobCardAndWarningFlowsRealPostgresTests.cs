// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100).
//
// The phone's job-card and warning screens called /job-cards/... and /compliance/... without the /shramsafal prefix, so
// these flows had never reached the server. Now they do, so here is their FIRST end-to-end run: on a real Postgres as
// agrisync_app (E3 first), through the real host, sending exactly what the phone's clients send (jobCardsClient.ts,
// complianceClient.ts: the same paths, bodies and the empty body of start, verify and acknowledge), as the seats that use
// them, with the MU-3 (money), MU-4 (plot scope) and PRV (record audience) rules asked at every step, and every step's
// effect read back from the database.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class JobCardAndWarningFlowsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid P2 = Guid.Parse("3d099200-0000-4000-8000-0000000000c2");
    private static readonly Guid P4 = Guid.Parse("3d099200-0000-4000-8000-0000000000c4");
    private static readonly Guid Warning = Guid.Parse("3d099200-0000-4000-8000-0000000000f1");
    private static readonly Guid WarningNamingOwnersRecord = Guid.Parse("3d099200-0000-4000-8000-0000000000f2");
    private const decimal Rate = 7171.17m;

    // ── Job card: create → assign → start → complete → verify → settle, then cancel ──────

    [Fact]
    public async Task The_job_card_flow_runs_end_to_end_as_the_phone_sends_it_and_every_rule_holds_on_every_step()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await NarrowMukadamToP2AndP4Async();

        // 1. Create (the owner). The phone's body: farm, plot, season, date, line items.
        var (created, createdBody) = await PhoneAsync(Owner, "POST", "/shramsafal/job-cards", NewCard(PlotA));
        created.Should().Be(HttpStatusCode.Created, createdBody);
        var card = Json(createdBody).GetProperty("jobCardId").GetGuid();
        (await CardStatusAsync(card)).Should().Be("Draft");
        // MU-4: a मुकादम on plots P2 and P4 may not create a card on P1, and is told the rule.
        await ShouldRefuseByPlotAsync(Mukadam, "POST", "/shramsafal/job-cards", NewCard(PlotA));
        // MU-3: the सहमालक whose money is switched off reads the card, never its rate (withheld, not ₹0).
        var (listed, listedBody) = await PhoneAsync(CoOwner, "GET", $"/shramsafal/farms/{FarmA}/job-cards", null);
        listed.Should().Be(HttpStatusCode.OK, listedBody);
        var seen = Json(listedBody).EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == card);
        seen.GetProperty("lineItems")[0].GetProperty("ratePerHourAmount").ValueKind.Should().Be(JsonValueKind.Null);
        listedBody.Should().NotContain(Rate.ToString(System.Globalization.CultureInfo.InvariantCulture));

        // 2. Assign (the owner gives it to the कामगार).
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/job-cards/{card}/assign", new { workerUserId = Worker });
        (await PhoneAsync(Owner, "POST", $"/shramsafal/job-cards/{card}/assign", new { workerUserId = Worker })).Status.Should().Be(HttpStatusCode.OK);
        (await CardStatusAsync(card)).Should().Be("Assigned");

        // 3. Start (the कामगार; the phone sends no body).
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/job-cards/{card}/start", null);
        var (started, startedBody) = await PhoneAsync(Worker, "POST", $"/shramsafal/job-cards/{card}/start", null);
        started.Should().Be(HttpStatusCode.OK, startedBody);
        (await CardStatusAsync(card)).Should().Be("InProgress");

        // 4. Complete (the कामगार, with his record of the day, which carries the card's work).
        (await PhoneAsync(Worker, "POST", $"/shramsafal/logs/{WorkerLog}/tasks", new { activityType = "spray", notes = "फवारणी" }))
            .Status.Should().Be(HttpStatusCode.OK);
        // PRV: a record whose audience leaves him out is not his to complete a card with.
        await PushAppliedAsync(Owner, "set_record_audience", $"f99-aud-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = OwnerLog,
            ["audience"] = "OnlyMe",
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        (await PhoneAsync(Worker, "POST", $"/shramsafal/job-cards/{card}/complete", new { dailyLogId = OwnerLog })).Status
            .Should().Be(HttpStatusCode.Forbidden, "the owner's record is kept from him (PRV)");
        (await CardStatusAsync(card)).Should().Be("InProgress");
        var (completed, completedBody) = await PhoneAsync(Worker, "POST", $"/shramsafal/job-cards/{card}/complete", new { dailyLogId = WorkerLog });
        completed.Should().Be(HttpStatusCode.OK, completedBody);
        (await CardStatusAsync(card)).Should().Be("Completed");

        // 5. Verify (the owner approves the day; the card is paid only on an approved record). Approving the linked record
        //    moves the card to VerifiedForPayout by itself (OnLogVerifiedAutoVerifyJobCard), so the separate
        //    verify-for-payout route, which no phone screen calls today, then answers "not in a valid state" (400). Its
        //    rules still answer first: off the plot (MU-4) and without money review (MU-3) are refused.
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/job-cards/{card}/verify-for-payout", null);
        (await PhoneAsync(CoOwner, "POST", $"/shramsafal/job-cards/{card}/verify-for-payout", null)).Status
            .Should().Be(HttpStatusCode.Forbidden, "the सहमालक holds no money review (MU-3)");
        await VerifyRecordAsync(WorkerLog);
        (await CardStatusAsync(card)).Should().Be("VerifiedForPayout", "approving the record verifies the card for payout");
        var (again, againBody) = await PhoneAsync(Owner, "POST", $"/shramsafal/job-cards/{card}/verify-for-payout", null);
        again.Should().Be(HttpStatusCode.BadRequest, againBody);
        Json(againBody).GetProperty("error").GetString().Should().Be("ShramSafal.JobCardInvalidState");

        // 6. Settle (the owner pays). The payout is a cost entry of this farm, linked to the card.
        object Payout() => new { actualPayoutAmount = 812.5m, actualPayoutCurrencyCode = "INR", settlementNote = "रोख" };
        (await PhoneAsync(CoOwner, "POST", $"/shramsafal/job-cards/{card}/settle", Payout())).Status.Should().Be(HttpStatusCode.Forbidden);
        var (settled, settledBody) = await PhoneAsync(Owner, "POST", $"/shramsafal/job-cards/{card}/settle", Payout());
        settled.Should().Be(HttpStatusCode.OK, settledBody);
        (await CardStatusAsync(card)).Should().Be("PaidOut");
        (await ScalarAsync("SELECT amount::text FROM ssf.cost_entries WHERE job_card_id = @id AND farm_id = @farm", ("id", card), ("farm", FarmA)))
            .Should().Be("812.50", "the payout is kept on the server as the farm's labour cost (P10)");

        // 7. Cancel (a second card): off-plot refused with the rule's words; the owner cancels; a paid card cannot be.
        var (second, secondBody) = await PhoneAsync(Owner, "POST", "/shramsafal/job-cards", NewCard(PlotA));
        var secondCard = Json(secondBody).GetProperty("jobCardId").GetGuid();
        second.Should().Be(HttpStatusCode.Created);
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/job-cards/{secondCard}/cancel", new { reason = "नको" });
        (await PhoneAsync(Owner, "POST", $"/shramsafal/job-cards/{secondCard}/cancel", new { reason = "पाऊस" })).Status.Should().Be(HttpStatusCode.OK);
        (await CardStatusAsync(secondCard)).Should().Be("Cancelled");
        (await PhoneAsync(Owner, "POST", $"/shramsafal/job-cards/{card}/cancel", new { reason = "चूक" })).Status.Should().Be(HttpStatusCode.BadRequest);
        (await CardStatusAsync(card)).Should().Be("PaidOut");

        // Another farmer: every step on this farm's card answers exactly as a made-up card.
        var madeUp = await PhoneAsync(OwnerB, "POST", $"/shramsafal/job-cards/{Guid.NewGuid()}/start", null);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        foreach (var step in new[] { "start", "verify-for-payout" })
        {
            var foreign = await PhoneAsync(OwnerB, "POST", $"/shramsafal/job-cards/{card}/{step}", null);
            foreign.Status.Should().Be(HttpStatusCode.NotFound, step);
            foreign.Body.Should().Be(madeUp.Body, "no hint that another farm's card exists (E4)");
        }
    }

    // ── Warnings: list → acknowledge → resolve ──────────────────────────────────────────

    [Fact]
    public async Task The_warning_flow_runs_end_to_end_as_the_phone_sends_it_and_every_rule_holds_on_every_step()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedWarningsAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.ConfirmRecords);

        // 1. List (the owner reads the farm's open warnings).
        var (listed, listedBody) = await PhoneAsync(Owner, "GET", $"/shramsafal/farms/{FarmA}/compliance", null);
        listed.Should().Be(HttpStatusCode.OK, listedBody);
        IdsIn(listedBody).Should().BeEquivalentTo([Warning, WarningNamingOwnersRecord]);
        // MU-3: a कामगार without confirm records is not sent the farm's warnings, and may not handle one.
        (await PhoneAsync(Worker, "GET", $"/shramsafal/farms/{FarmA}/compliance", null)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PhoneAsync(Worker, "POST", $"/shramsafal/compliance/{Warning}/acknowledge", null)).Status.Should().Be(HttpStatusCode.Forbidden);
        // PRV: a warning naming a record kept from the मुकादम is neither sent to him nor his to handle.
        await PushAppliedAsync(Owner, "set_record_audience", $"f99-aud-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = OwnerLog,
            ["audience"] = "OnlyMe",
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        var (mukadamList, mukadamListBody) = await PhoneAsync(Mukadam, "GET", $"/shramsafal/farms/{FarmA}/compliance", null);
        mukadamList.Should().Be(HttpStatusCode.OK, mukadamListBody);
        IdsIn(mukadamListBody).Should().BeEquivalentTo([Warning]);
        (await PhoneAsync(Mukadam, "POST", $"/shramsafal/compliance/{WarningNamingOwnersRecord}/acknowledge", null)).Status
            .Should().Be(HttpStatusCode.Forbidden);
        (await AcknowledgedByAsync(WarningNamingOwnersRecord)).Should().BeNull();

        // 2. Acknowledge (the मुकादम who confirms records; the phone sends no body).
        var (acknowledged, acknowledgedBody) = await PhoneAsync(Mukadam, "POST", $"/shramsafal/compliance/{Warning}/acknowledge", null);
        acknowledged.Should().Be(HttpStatusCode.OK, acknowledgedBody);
        (await AcknowledgedByAsync(Warning)).Should().Be(Mukadam.ToString());

        // 3. Resolve (the owner, with a note).
        var (resolved, resolvedBody) = await PhoneAsync(Owner, "POST", $"/shramsafal/compliance/{Warning}/resolve", new { note = "फवारणी केली" });
        resolved.Should().Be(HttpStatusCode.OK, resolvedBody);
        (await ScalarAsync("SELECT resolution_note FROM ssf.compliance_signals WHERE \"Id\" = @id", ("id", Warning))).Should().Be("फवारणी केली");
        IdsIn((await PhoneAsync(Owner, "GET", $"/shramsafal/farms/{FarmA}/compliance", null)).Body)
            .Should().NotContain(Warning, "a resolved warning leaves the open list");

        // Another farmer: answered exactly as a made-up warning.
        var madeUp = await PhoneAsync(OwnerB, "POST", $"/shramsafal/compliance/{Guid.NewGuid()}/acknowledge", null);
        var foreign = await PhoneAsync(OwnerB, "POST", $"/shramsafal/compliance/{WarningNamingOwnersRecord}/acknowledge", null);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        foreign.Status.Should().Be(HttpStatusCode.NotFound);
        foreign.Body.Should().Be(madeUp.Body);
    }

    [Fact]
    public async Task A_warning_on_a_plot_outside_his_plots_is_neither_listed_to_him_nor_his_to_handle()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedWarningsAsync();
        await NarrowMukadamToP2AndP4Async();

        var (listed, listedBody) = await PhoneAsync(Mukadam, "GET", $"/shramsafal/farms/{FarmA}/compliance", null);
        listed.Should().Be(HttpStatusCode.OK, listedBody);
        IdsIn(listedBody).Should().BeEmpty("both warnings are on P1 (MU-4)");
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/compliance/{Warning}/acknowledge", null);
        await ShouldRefuseByPlotAsync(Mukadam, "POST", $"/shramsafal/compliance/{Warning}/resolve", new { note = "नाही" });
        (await AcknowledgedByAsync(Warning)).Should().BeNull();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private static object NewCard(Guid plot) => new
    {
        farmId = FarmA,
        plotId = plot,
        cropCycleId = CycleA,
        plannedDate = "2026-11-03",
        lineItems = new[] { new { activityType = "spray", expectedHours = 4, ratePerHourAmount = Rate, ratePerHourCurrencyCode = "INR" } },
    };

    /// <summary>
    /// A request exactly as the phone's fetch makes it: JSON headers on every call (and X-App-Version, as jobCardsClient
    /// sends), the body when there is one, and NO body at all where the phone sends none (start, verify, acknowledge).
    /// </summary>
    private async Task<(HttpStatusCode Status, string Body)> PhoneAsync(Guid user, string method, string url, object? body)
    {
        using var response = await SendAsync(new HttpMethod(method), url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[FLOW] {user} {method} {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task ShouldRefuseByPlotAsync(Guid user, string method, string url, object? body)
    {
        var (status, text) = await PhoneAsync(user, method, url, body);
        status.Should().Be(HttpStatusCode.Forbidden, $"{url}: P1 is not one of his plots");
        var answer = Json(text);
        answer.GetProperty("error").GetString().Should().Be(ShramSafalErrors.PlotScopeForbidden.Code, url);
        answer.GetProperty("message").GetString().Should().Be(ShramSafalErrors.PlotScopeForbidden.Description, url);
    }

    /// <summary>The owner approves the record through the route the phone uses: Draft → Confirmed → Verified.</summary>
    private async Task VerifyRecordAsync(Guid log)
    {
        var (state, stateBody) = await PhoneAsync(Owner, "GET", $"/shramsafal/logs/{log}/transitions", null);
        state.Should().Be(HttpStatusCode.OK, stateBody);
        if (Json(stateBody).GetProperty("currentStatus").GetString() == "Draft")
        {
            (await PhoneAsync(Owner, "POST", $"/shramsafal/logs/{log}/verify", new { status = "Confirmed" })).Status.Should().Be(HttpStatusCode.OK);
        }

        var (verified, verifiedBody) = await PhoneAsync(Owner, "POST", $"/shramsafal/logs/{log}/verify", new { status = "Verified" });
        verified.Should().Be(HttpStatusCode.OK, verifiedBody);
    }

    /// <summary>Plots P2 and P4 on farm A; the मुकादम holds हजेरी, money, money review and confirm records, on {P2, P4} only.</summary>
    private async Task NarrowMukadamToP2AndP4Async()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, 'प्लॉट-दोन', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, 'प्लॉट-चार', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            """, ("p2", P2), ("p4", P4), ("farm", FarmA));
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney,
            FarmAuthority.ConfirmRecords);
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = new[] { P2, P4 } });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    /// <summary>Two open warnings on P1; the second names the owner's record (the compliance engine writes these, not a phone).</summary>
    private Task SeedWarningsAsync() => ExecOnSuperuserAsync("""
        INSERT INTO ssf.compliance_signals ("Id", farm_id, plot_id, crop_cycle_id, rule_code, severity, suggested_action,
                                            title_en, title_mr, description_en, description_mr, payload_json,
                                            first_seen_at_utc, last_seen_at_utc)
        VALUES (@w1, @farm, @p1, @cycle, 'F99.FLOW.ONE', 'Watch', 'AcknowledgeOnly', 'Spray missed', 'फवारणी राहिली',
                'Spray missed', 'फवारणी राहिली', '{}'::jsonb, NOW(), NOW()),
               (@w2, @farm, @p1, @cycle, 'F99.FLOW.TWO', 'Watch', 'AcknowledgeOnly', 'Check the record', 'नोंद तपासा',
                'Check the record', 'नोंद तपासा', jsonb_build_object('dailyLogId', @ownerLog::text), NOW(), NOW());
        """, ("w1", Warning), ("w2", WarningNamingOwnersRecord), ("farm", FarmA), ("p1", PlotA), ("cycle", CycleA), ("ownerLog", OwnerLog));

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private static List<Guid> IdsIn(string body) =>
        JsonDocument.Parse(body).RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();

    private Task<string?> CardStatusAsync(Guid card) => ScalarAsync("SELECT status FROM ssf.job_cards WHERE id = @id", ("id", card));

    private Task<string?> AcknowledgedByAsync(Guid warning) =>
        ScalarAsync("SELECT acknowledged_by_user_id::text FROM ssf.compliance_signals WHERE \"Id\" = @id", ("id", warning));

    private async Task<string?> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return (await cmd.ExecuteScalarAsync()) is { } scalar and not DBNull ? Convert.ToString(scalar, System.Globalization.CultureInfo.InvariantCulture) : null;
    }
}
