// spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 (founder D-70 option 2, register F124) - proved on a real
// Postgres as agrisync_app (E3 first), through the real host, routes and handlers: a person who covers only SOME plots sees
// NO day wages at all - not a crew's wage per person, not its total, not the labour page's day-wage figure, not a worker's
// earnings - while a seat that covers every plot (the control) still does. He keeps the job-card (उक्ते) money and the other
// money of his plots. The base farm's whole-farm records sit on plot A, so the मुकादम is given plot A alone: the records
// are HIS plot's, and what leaves him is only the day wage.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class DayWagesChosenPlotsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private async Task GiveMukadamWagesAsync()
    {
        // take हजेरी + see money + see wages: the seat that, on every plot, reads the owner's book and each day wage.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
    }

    private async Task NarrowMukadamToPlotAAsync()
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = new[] { PlotA } });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder chooses his plots: {text}");
    }

    private static JsonElement LogOf(JsonElement pull, Guid id) =>
        pull.GetProperty("dailyLogs").EnumerateArray().Single(l => l.GetProperty("id").GetGuid() == id);

    private static decimal? Number(JsonElement line, string name) =>
        line.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null;

    [Fact]
    public async Task MuOne_D70_a_chosen_plots_seat_reads_no_day_wage_on_a_record_and_an_every_plot_seat_still_does()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GiveMukadamWagesAsync();

        // The control: the same authorities on EVERY plot read the crew's wage per person and its total.
        var (everyBody, every) = await PullAsync(Mukadam);
        var all = LogOf(every, OwnerLog).GetProperty("labour")[0];
        Number(all, "wagePerPerson").Should().Be(OwnerWage, "a seat on every plot with see wages reads the day wage");
        Number(all, "totalCost").Should().Be(OwnerCrewTotal);
        everyBody.Should().Contain(JobRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "the control: a job card's rate");

        // The same person, now on plot A alone (where those records are): no day wage, said to be held back.
        await NarrowMukadamToPlotAAsync();
        var (narrowBody, narrow) = await PullAsync(Mukadam);
        var chosen = LogOf(narrow, OwnerLog).GetProperty("labour")[0];
        Number(chosen, "wagePerPerson").Should().BeNull("D-70 option 2: no day wage on chosen plots");
        Number(chosen, "totalCost").Should().BeNull("the crew total is the day wage times the crew");
        chosen.GetProperty("wageWithheld").GetBoolean().Should().BeTrue("said, never left reading 'not stated'");
        chosen.GetProperty("totalCostWithheld").GetBoolean().Should().BeTrue();
        foreach (var wage in new[] { OwnerWage, OwnerCrewTotal, WorkerWage, Worker2Wage })
        {
            narrowBody.Should().NotContain(wage.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "no day wage of anyone else's record reaches him anywhere in his pull");
        }

        // His OWN record is his own statement: it always comes back whole.
        Number(LogOf(narrow, MukadamLog).GetProperty("labour")[0], "wagePerPerson").Should().Be(MukadamWage);

        // He keeps the money of his plot: a cost on plot A and the job card's pay (see wages governs a card).
        narrowBody.Should().Contain(CostAmount.ToString(System.Globalization.CultureInfo.InvariantCulture), "other money of his plots");
        narrowBody.Should().Contain(JobRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "job-card money on his plot");
    }

    [Fact]
    public async Task MuOne_D70_the_labour_page_leaves_out_the_day_wage_figure_for_chosen_plots_alone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GiveMukadamWagesAsync();

        async Task<JsonElement> Home(Guid who)
        {
            var (status, body) = await GetAsync(who, $"/shramsafal/farms/{FarmA}/labour");
            status.Should().Be(HttpStatusCode.OK, body);
            var root = JsonDocument.Parse(body).RootElement.Clone();
            root.GetProperty("view").GetString().Should().Be("owner", $"{who} reads the book");
            return root.GetProperty("home");
        }

        (await Home(Owner)).GetProperty("rojandariStated").ValueKind.Should().Be(JsonValueKind.Number, "the owner: unchanged");
        (await Home(Mukadam)).GetProperty("rojandariStated").ValueKind.Should().Be(JsonValueKind.Number, "every plot with see wages: unchanged");

        await NarrowMukadamToPlotAAsync();
        (await Home(Mukadam)).GetProperty("rojandariStated").ValueKind.Should().Be(JsonValueKind.Null, "chosen plots: no day wages");
        (await Home(Owner)).GetProperty("rojandariStated").ValueKind.Should().Be(JsonValueKind.Number, "the owner is still unchanged");
    }

    [Fact]
    public async Task MuOne_D70_a_workers_earnings_are_not_shown_to_a_chosen_plots_seat()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GiveMukadamWagesAsync();

        Task<string?> ProfileAs() => AsFarmMemberAsync(FarmA, Mukadam, async sp =>
        {
            var result = await sp.GetRequiredService<GetWorkerProfileHandler>()
                .HandleAsync(new GetWorkerProfileQuery(new UserId(Worker), new UserId(Mukadam), FarmA));
            return result.IsSuccess ? null : result.Error.Code;
        });

        (await ProfileAs()).Should().BeNull("a seat on every plot with see wages reads a worker's earnings");
        await NarrowMukadamToPlotAAsync();
        (await ProfileAs()).Should().NotBeNull("chosen plots: a worker's earnings hold his day wages, so the page is refused (1.0.17 would draw a hidden figure as 0)");
    }

    // ── Fix round 1 (review HIGH-1): the same day wage as a crew's total stored as a `labour_misc` money entry ──

    private static readonly Guid OwnerMisc = Guid.Parse("3d030000-0000-4000-8000-0000000007a1");
    private static readonly Guid MukadamMisc = Guid.Parse("3d030000-0000-4000-8000-0000000007a2");
    private const decimal OwnerMiscAmount = 2468.13m;
    private const decimal MukadamMiscAmount = 1357.91m;

    private static Dictionary<string, object?> MiscPayload(Guid id, decimal amount)
    {
        var payload = CostPayload(id, FarmA, PlotA, CycleA, amount);
        payload["categoryId"] = "labour_misc";
        payload["description"] = "मजूर";
        return payload;
    }

    private static IEnumerable<Guid> CostIds(JsonElement pull) =>
        pull.GetProperty("costEntries").EnumerateArray().Select(c => c.GetProperty("id").GetGuid());

    [Fact]
    public async Task MuOne_D70_the_crews_labour_misc_money_entry_goes_with_the_day_wage_in_the_pull_the_labour_page_and_the_totals()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GiveMukadamWagesAsync();
        // A crew's recorded total is stored as a money entry; the owner records one, the मुकादम one of his own.
        await PushAppliedAsync(Owner, "add_cost_entry", "mu1-d70-misc-owner", MiscPayload(OwnerMisc, OwnerMiscAmount));
        await PushAppliedAsync(Mukadam, "add_cost_entry", "mu1-d70-misc-own", MiscPayload(MukadamMisc, MukadamMiscAmount));

        async Task<(decimal LabourPaid, decimal PlotTotal, decimal PlotSummary)> TotalsAsync(Guid who)
        {
            var (labourStatus, labour) = await GetAsync(who, $"/shramsafal/farms/{FarmA}/labour");
            labourStatus.Should().Be(HttpStatusCode.OK, labour);
            var paid = JsonDocument.Parse(labour).RootElement.GetProperty("dashboard").GetProperty("money").GetProperty("paid").GetDecimal();
            var (summaryStatus, summary) = await GetAsync(who, "/shramsafal/finance/summary?groupBy=plot");
            summaryStatus.Should().Be(HttpStatusCode.OK, summary);
            var group = JsonDocument.Parse(summary).RootElement.GetProperty("items").EnumerateArray()
                .Single(i => i.GetProperty("groupKey").GetString() == PlotA.ToString()).GetProperty("totalAmount").GetDecimal();
            var (plotStatus, plot) = await GetAsync(who, $"/shramsafal/finance/plot-summary?plotId={PlotA}");
            plotStatus.Should().Be(HttpStatusCode.OK, plot);
            return (paid, group, JsonDocument.Parse(plot).RootElement.GetProperty("totalCosts").GetDecimal());
        }

        // The control: a seat on every plot with see wages reads both entries, and they are in his totals.
        var (_, every) = await PullAsync(Mukadam);
        CostIds(every).Should().Contain([OwnerMisc, MukadamMisc, Cost]);
        var all = await TotalsAsync(Mukadam);
        all.LabourPaid.Should().Be(OwnerMiscAmount + MukadamMiscAmount, "दिलं counts the labour money paid out");

        // The same person on plot A alone: the owner's day-wage entry is gone from the pull, the labour page and both totals;
        // his own submission stays; job-card money and the other money of his plot (the fertiliser cost) stay.
        await NarrowMukadamToPlotAAsync();
        var (narrowBody, narrow) = await PullAsync(Mukadam);
        CostIds(narrow).Should().Contain([MukadamMisc, Cost]).And.NotContain(OwnerMisc);
        narrowBody.Should().NotContain(OwnerMiscAmount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "the crew's total is the day wage times the headcount, which he can see");
        var chosen = await TotalsAsync(Mukadam);
        chosen.LabourPaid.Should().Be(MukadamMiscAmount, "the labour page's दिलं leaves the owner's day-wage entry out");
        (all.PlotTotal - chosen.PlotTotal).Should().Be(OwnerMiscAmount, "the plot's total in the money summary");
        (all.PlotSummary - chosen.PlotSummary).Should().Be(OwnerMiscAmount, "and in the plot summary");

        // The owner is unchanged.
        CostIds((await PullAsync(Owner)).Root).Should().Contain([OwnerMisc, MukadamMisc]);
        (await TotalsAsync(Owner)).LabourPaid.Should().Be(OwnerMiscAmount + MukadamMiscAmount);
    }

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }
}
