// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — the REST doors that carry
// money apply the SAME read scope the download does: the finance summaries, the exports, the farm's audit
// trail, the job-card reads, the wage book (labour read-out) and the attachment reads. On a real Postgres as
// agrisync_app (E3 first), each person, through the real host.
//
// MU-3 fix 1 (F94): /finance/plot-summary, /export/*, /audit?farmId= and /farms/{id}/job-cards answered 500 to
// EVERY caller at the route on edee6667 (no tenant scope was opened; the plot-summary handler was not even
// registered). They now open the caller's farm scope first, and the money rule is proved THROUGH THE ROUTE.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RoleScopedReadDoorsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid[] NoMoneySeats = [CoOwner, Mukadam, Worker];

    [Fact]
    public async Task The_finance_summary_route_opens_only_for_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (ownerStatus, ownerBody) = await GetAsync("/shramsafal/finance/summary?groupBy=day", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain("9876.54", "the owner's summary counts his money");
        ownerBody.Should().NotContain("5555.67", "and never another farm's");

        foreach (var seat in NoMoneySeats.Append(Paused))
        {
            var (status, body) = await GetAsync("/shramsafal/finance/summary?groupBy=day", seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat} does not see money: no summary, never a ₹0");
            body.Should().NotContain("9876.54");
        }
    }

    [Fact]
    public async Task The_plot_summary_route_opens_only_for_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/finance/plot-summary?plotId={PlotA}";
        var (ownerStatus, ownerBody) = await GetAsync(url, Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain("9876.54", "the owner reads his plot's money");
        foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
        {
            var (status, body) = await GetAsync(url, seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat} does not see this farm's money: {body}");
            body.Should().NotContain("9876.54");
        }
    }

    [Fact]
    public async Task The_export_routes_carry_amounts_and_open_only_for_a_seat_that_sees_the_farms_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The production host's own startup line (Bootstrapper Program.cs): the PDF library's Community licence.
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
        var urls = new[]
        {
            $"/shramsafal/export/monthly-cost?farmId={FarmA}&year=2026&month=10",
            $"/shramsafal/export/verification?farmId={FarmA}&fromDate=2026-10-01&toDate=2026-10-31",
        };
        foreach (var url in urls)
        {
            var (ownerStatus, ownerBody) = await GetAsync(url, Owner);
            ownerStatus.Should().Be(HttpStatusCode.OK, $"the owner exports his farm's reports: {ownerBody}");
            foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
            {
                var (status, body) = await GetAsync(url, seat);
                status.Should().Be(HttpStatusCode.Forbidden, $"{seat} may not export amounts: {body}");
            }
        }
    }

    [Fact]
    public async Task The_farms_audit_trail_route_opens_only_for_a_seat_that_sees_money_and_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/audit?farmId={FarmA}";
        var (ownerStatus, ownerBody) = await GetAsync(url, Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        foreach (var seat in NoMoneySeats.Append(Paused).Append(OwnerB))
        {
            var (status, body) = await GetAsync(url, seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat}: the trail carries amounts and wages: {body}");
            body.Should().NotContain("9876.54");
        }
    }

    [Fact]
    public async Task The_farms_job_cards_route_sends_the_work_to_every_working_seat_and_the_pay_only_with_see_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/farms/{FarmA}/job-cards";
        var (ownerStatus, ownerBody) = await GetAsync(url, Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain("6129.37", "the owner sees the rate");

        foreach (var seat in new[] { CoOwner, Mukadam })
        {
            var (status, body) = await GetAsync(url, seat);
            status.Should().Be(HttpStatusCode.OK, $"{seat}: the work assignment is his to read (fix 1 F7): {body}");
            JsonDocument.Parse(body).RootElement.EnumerateArray().Select(j => j.GetProperty("id").GetGuid()).Should().Equal([JobCard]);
            body.Should().NotContain("6129.37", $"{seat}: a worker's pay is withheld by rule, never ₹0");
            var card = JsonDocument.Parse(body).RootElement[0];
            card.GetProperty("estimatedTotalAmount").ValueKind.Should().Be(JsonValueKind.Null);
            card.GetProperty("lineItems")[0].GetProperty("ratePerHourAmount").ValueKind.Should().Be(JsonValueKind.Null);
        }

        foreach (var seat in new[] { Worker, Paused, OwnerB })
        {
            var (status, body) = await GetAsync(url, seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat}: not the farm's work list: {body}");
        }
    }

    [Fact]
    public async Task The_wage_book_follows_see_wages_and_never_the_co_owner_label()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (ownerStatus, ownerBody) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        JsonDocument.Parse(ownerBody).RootElement.GetProperty("view").GetString().Should().Be("owner");

        var (coStatus, coBody) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", CoOwner);
        coStatus.Should().Be(HttpStatusCode.OK, coBody);
        var co = JsonDocument.Parse(coBody).RootElement;
        co.GetProperty("view").GetString().Should().Be("crew", "a सहमालक without see wages reads the crew register, no money");
        co.GetProperty("dashboard").GetProperty("money").ValueKind.Should().Be(JsonValueKind.Null, "withheld, never ₹0");
        foreach (var amount in new[] { "432.17", "3457.36", "211.19", "1689.52", "166.61" })
        {
            coBody.Should().NotContain(amount, "no wage reaches a seat without see wages");
        }
    }

    [Fact]
    public async Task An_attachment_is_read_where_its_parent_is_read()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A receipt is money.
        (await ListAsync(Cost, "CostEntry", Owner)).Should().Equal([Receipt]);
        (await ListAsync(Cost, "CostEntry", CoOwner)).Should().BeEmpty("a receipt is money");
        (await GetAsync($"/shramsafal/attachments/{Receipt}", CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/attachments/{Receipt}", Owner)).Status.Should().Be(HttpStatusCode.OK);

        // A record's photo goes where the record goes.
        (await ListAsync(OwnerLog, "DailyLog", CoOwner)).Should().Equal([OwnerLogPhoto]);
        (await ListAsync(OwnerLog, "DailyLog", Worker)).Should().BeEmpty("a कामगार reads his own records only");
        (await GetAsync($"/shramsafal/attachments/{OwnerLogPhoto}", Worker)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await ListAsync(WorkerLog, "DailyLog", Worker)).Should().Equal([WorkerLogPhoto], "his own record's photo is his");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }

    private async Task<Guid[]> ListAsync(Guid entityId, string entityType, Guid user)
    {
        var (status, body) = await GetAsync($"/shramsafal/attachments?entityId={entityId}&entityType={entityType}", user);
        status.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.EnumerateArray().Select(a => a.GetProperty("id").GetGuid()).ToArray();
    }
}
