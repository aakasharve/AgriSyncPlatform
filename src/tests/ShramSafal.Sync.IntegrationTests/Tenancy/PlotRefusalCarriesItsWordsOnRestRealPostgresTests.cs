// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99, carried from the MU-4 third review (R3-L4).
//
// MU-4 fix pass 2 (N4) made a REST refusal by the plot rule carry its code and words on the job-card and test routes.
// The other REST doors that refuse by plot still answered a bare 403, so the phone showed its generic failure. Here every
// one of them, through its ROUTE (now that each opens the caller's farm scope), on a real Postgres as agrisync_app (E3
// first): a मुकादम whose seat covers plots P2 and P4 asks each door to write on P1; each answers 403 with
// ShramSafal.PlotScope.Forbidden and the rule's words.
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class PlotRefusalCarriesItsWordsOnRestRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid P2 = Guid.Parse("3d099000-0000-4000-8000-0000000000c2");
    private static readonly Guid P4 = Guid.Parse("3d099000-0000-4000-8000-0000000000c4");
    private static readonly Guid CycleP2 = Guid.Parse("3d099000-0000-4000-8000-0000000000d2");
    private static readonly Guid WarningOnP1 = Guid.Parse("3d099000-0000-4000-8000-0000000000f1");

    [Fact]
    public async Task Every_REST_door_that_refuses_by_plot_carries_the_rules_code_and_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var unplaced = await SeedNarrowedMukadamAsync();

        var doors = new Dictionary<string, (string Url, object Body)>
        {
            ["cost-entry"] = ("/shramsafal/finance/cost-entry", new
            {
                farmId = FarmA,
                plotId = PlotA,
                cropCycleId = CycleA,
                categoryId = "fertilizer",
                description = "खत",
                amount = 1234.56m,
                currencyCode = "INR",
                entryDate = WorkDay,
            }),
            ["allocate"] = ("/shramsafal/finance/allocate", new
            {
                costEntryId = unplaced,
                allocationBasis = "custom",
                allocations = new[] { new { plotId = PlotA, amount = 2000m }, new { plotId = P2, amount = 2242.42m } },
            }),
            ["rest-logs"] = ("/shramsafal/logs", new
            {
                farmId = FarmA,
                plotId = PlotA,
                cropCycleId = CycleA,
                logDate = WorkDay,
                clientRequestId = "f99-rest-log",
            }),
            ["crop-cycle"] = ("/shramsafal/cropcycles", new
            {
                farmId = FarmA,
                plotId = PlotA,
                cropName = "Grapes",
                stage = "Vegetative",
                startDate = "2027-01-01",
            }),
            ["schedule-adopt"] = ($"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/adopt", new
            {
                farmId = FarmA,
                scheduleTemplateId = Guid.NewGuid(),
            }),
            ["plan-add"] = ("/shramsafal/planned-activities", new
            {
                cropCycleId = CycleA,
                farmId = FarmA,
                activityName = "खुरपणी",
                stage = "Vegetative",
                plannedDate = "2026-11-05",
                reason = "गरज",
            }),
            ["plan-generate"] = ("/shramsafal/plan/generate", new
            {
                cropCycleId = CycleA,
                templateName = "नमुना",
                stage = "Vegetative",
                planStartDate = "2026-11-01",
                activities = new[] { new { activityName = "फवारणी", offsetDays = 1 } },
            }),
            ["warning"] = ($"/shramsafal/compliance/{WarningOnP1}/acknowledge", new { }),
        };

        var answers = new List<(string Door, HttpStatusCode Status, string? Code, string? Words)>();
        foreach (var (door, (url, body)) in doors)
        {
            using var response = await SendAsync(HttpMethod.Post, url, Mukadam, body);
            var text = await response.Content.ReadAsStringAsync();
            Output.WriteLine($"[R3-L4] {door} POST {url} -> {(int)response.StatusCode} {text}");
            JsonElement? answer = string.IsNullOrWhiteSpace(text) ? null : JsonDocument.Parse(text).RootElement.Clone();
            answers.Add((door, response.StatusCode,
                answer is { ValueKind: JsonValueKind.Object } a && a.TryGetProperty("error", out var code) ? code.GetString() : null,
                answer is { ValueKind: JsonValueKind.Object } b && b.TryGetProperty("message", out var words) ? words.GetString() : null));
        }

        // Every door is asked before anything is asserted, so a failure names each door that answered a bare 403.
        answers.Should().AllSatisfy(a =>
        {
            a.Status.Should().Be(HttpStatusCode.Forbidden, $"the {a.Door} door names P1, which is not one of his plots");
            a.Code.Should().Be(ShramSafalErrors.PlotScopeForbidden.Code, $"the {a.Door} door's refusal names the plot rule, never a bare 403");
            a.Words.Should().Be(ShramSafalErrors.PlotScopeForbidden.Description, $"the {a.Door} door's refusal carries the rule's words");
        });
    }

    /// <summary>
    /// Plots P2 and P4 on farm A; the मुकादम holds हजेरी, money, money review, confirm records and lab records, and the
    /// primary account holder narrows his seat to {P2, P4} (through the real route). Before the narrowing he records an
    /// expense of his own with no plot (the allocate door's subject); a warning stands on P1.
    /// </summary>
    private async Task<Guid> SeedNarrowedMukadamAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, 'प्लॉट-दोन', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, 'प्लॉट-चार', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleP2, @farm, @p2, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            INSERT INTO ssf.compliance_signals ("Id", farm_id, plot_id, crop_cycle_id, rule_code, severity, suggested_action,
                                                title_en, title_mr, description_en, description_mr, payload_json,
                                                first_seen_at_utc, last_seen_at_utc)
            VALUES (@warning, @farm, @p1, @cycleA, 'F99.TEST', 'Watch', 'AcknowledgeOnly', 'Check', 'तपासा', 'Check it', 'तपासा', '{}'::jsonb,
                    NOW(), NOW());
            """,
            ("p2", P2), ("p4", P4), ("farm", FarmA), ("cycleP2", CycleP2), ("warning", WarningOnP1), ("p1", PlotA), ("cycleA", CycleA));
        // lane L8b-1 (founder D-73): and "plan work", so the planning doors (schedule adopt, plan add, plan generate) refuse
        // him by the PLOT rule this test is about, not for want of the planning authority.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney,
            FarmAuthority.ConfirmRecords, FarmAuthority.LabRecords, FarmAuthority.PlanWork);

        var unplaced = Guid.NewGuid();
        var cost = CostPayload(unplaced, FarmA, P2, CycleP2, 4242.42m);
        cost.Remove("plotId");
        cost.Remove("cropCycleId");
        await PushAppliedAsync(Mukadam, "add_cost_entry", "f99-own-unplaced", cost);

        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = new[] { P2, P4 } });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return unplaced;
    }
}
